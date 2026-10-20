import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { attachments, entries, items, links, participants, statuses, users, type Item } from '../db/schema';
import { itemRef } from '../mail/mail-content';
import { replaceImages } from './inline-images';
import { NotificationsService } from '../mail/notifications.service';
import { firstOfCategory, isClosedCategory } from '../statuses/status-rules';
import { StatusesService } from '../statuses/statuses.service';
import { ItemsService, TYPE_LABELS } from './items.service';

/** Art einer Verknüpfung aus Sicht des aktuellen Vorgangs. */
export const LINK_ROLES = ['relates', 'fixes', 'fixedBy', 'duplicateOf', 'hasDuplicate'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

export const LINK_ROLE_LABELS: Record<LinkRole, string> = {
  relates: 'Bezieht sich auf',
  fixes: 'Behebt',
  fixedBy: 'Wird behoben durch',
  duplicateOf: 'Duplikat von',
  hasDuplicate: 'Hat Duplikat',
};

/** Speicherform (from, to, kind) zu einer Rolle aus Sicht von «self». */
export function toStoredLink(role: LinkRole, self: string, other: string) {
  switch (role) {
    case 'relates':
      return { fromId: self, toId: other, kind: 'relates' as const };
    case 'fixes':
      return { fromId: self, toId: other, kind: 'fixes' as const };
    case 'fixedBy':
      return { fromId: other, toId: self, kind: 'fixes' as const };
    case 'duplicateOf':
      return { fromId: self, toId: other, kind: 'duplicate' as const };
    case 'hasDuplicate':
      return { fromId: other, toId: self, kind: 'duplicate' as const };
  }
}

/** Rolle einer gespeicherten Verknüpfung aus Sicht von «self». */
export function roleOf(link: { fromId: string; kind: 'relates' | 'fixes' | 'duplicate' }, self: string): LinkRole {
  const outgoing = link.fromId === self;
  switch (link.kind) {
    case 'relates':
      return 'relates';
    case 'fixes':
      return outgoing ? 'fixes' : 'fixedBy';
    case 'duplicate':
      return outgoing ? 'duplicateOf' : 'hasDuplicate';
  }
}

const otherItem = alias(items, 'other');

@Injectable()
export class LinksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly statuses: StatusesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Verknüpfungen eines Vorgangs mit den Angaben zum jeweils anderen Vorgang. */
  async forItem(itemId: string) {
    const rows = await this.db
      .select({
        link: links,
        other: { id: otherItem.id, number: otherItem.number, title: otherItem.title, type: otherItem.type },
        status: { label: statuses.label, category: statuses.category },
      })
      .from(links)
      .innerJoin(
        otherItem,
        or(
          and(eq(links.fromId, itemId), eq(otherItem.id, links.toId)),
          and(eq(links.toId, itemId), eq(otherItem.id, links.fromId)),
        ),
      )
      .leftJoin(statuses, eq(statuses.id, otherItem.statusId))
      .where(or(eq(links.fromId, itemId), eq(links.toId, itemId)));
    return rows
      .map((r) => ({
        id: r.link.id,
        role: roleOf(r.link, itemId),
        createdAt: r.link.createdAt,
        other: { ...r.other, status: r.status?.label ? r.status : null },
      }))
      .sort((a, b) => LINK_ROLES.indexOf(a.role) - LINK_ROLES.indexOf(b.role) || a.other.number - b.other.number);
  }

  async add(actorId: string, number: number, role: LinkRole, otherNumber: number): Promise<void> {
    if (number === otherNumber) throw new BadRequestException('Ein Vorgang kann nicht mit sich selbst verknüpft werden');
    const pending: (() => Promise<void>)[] = [];
    await this.db.transaction(async (tx) => {
      // Immer in aufsteigender Nummernfolge sperren, damit sich gleichzeitige Verknüpfungen nicht blockieren
      const first = await this.lockByNumber(tx, Math.min(number, otherNumber));
      const second = await this.lockByNumber(tx, Math.max(number, otherNumber));
      const self = first.number === number ? first : second;
      const other = first.number === number ? second : first;
      const stored = toStoredLink(role, self.id, other.id);

      const existing = await tx
        .select()
        .from(links)
        .where(
          or(
            and(eq(links.fromId, self.id), eq(links.toId, other.id)),
            and(eq(links.fromId, other.id), eq(links.toId, self.id)),
          ),
        );
      if (existing.length > 0) throw new ConflictException('Die beiden Vorgänge sind bereits verknüpft');

      let duplicate: Item | null = null;
      let original: Item | null = null;
      if (stored.kind === 'duplicate') {
        await this.assertDuplicateAllowed(tx, stored.fromId, stored.toId);
        duplicate = stored.fromId === self.id ? self : other;
        original = stored.fromId === self.id ? other : self;
        await this.assertOpenOriginal(tx, original);
        if (!duplicate.discarded && !duplicate.type && !original.type) {
          throw new BadRequestException('Bitte zuerst dem Original einen Typ zuweisen');
        }
      }

      await tx.insert(links).values({ ...stored, createdById: actorId });
      await this.logBoth(tx, actorId, 'linkAdded', self, other, role);
      if (duplicate && original) pending.push(...(await this.redirectDuplicate(tx, actorId, duplicate, original)));
    });
    for (const job of pending) await job();
  }

  /**
   * Leitet ein Duplikat zum Original um:
   * - gleicher Melder: Meldung (Text und Anhänge) wird ins Original übernommen (zusammenführen)
   * - anderer Melder: Melder wird beim Original Beteiligter
   * - Beteiligte (CC) des Duplikats werden ebenfalls beim Original Beteiligte
   * - ein offenes Duplikat wird geschlossen (erster Status der Kategorie «Erledigt»)
   * Der Melder erhält statt der Erledigt-Mail einen Hinweis auf das Original.
   * Verworfene Duplikate werden nur verknüpft.
   */
  private async redirectDuplicate(tx: Tx, actorId: string, duplicate: Item, original: Item) {
    if (duplicate.discarded) return [];
    const all = await this.statuses.list(tx);
    const current = duplicate.statusId ? all.find((s) => s.id === duplicate.statusId) : undefined;
    const merged = duplicate.reporterId === original.reporterId;

    if (merged) {
      // Meldung des Duplikats als Nachricht des Melders ins Original übernehmen (ohne Wiederöffnen und ohne Mails)
      const files = await tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.itemId, duplicate.id), isNull(attachments.entryId)));
      if (duplicate.description.trim() || files.length > 0) {
        const entry = await this.items.addEntry(
          tx,
          original.id,
          duplicate.reporterId,
          'reply',
          duplicate.description,
          { source: 'merge', mergedFrom: duplicate.number, mergedTitle: duplicate.title },
          { bodyHtml: duplicate.descriptionHtml },
        );
        if (files.length > 0) {
          const copies = await tx
            .insert(attachments)
            .values(
              files.map((f) => ({
                itemId: original.id,
                entryId: entry.id,
                filename: f.filename,
                contentType: f.contentType,
                size: f.size,
                storageKey: f.storageKey,
                contentId: f.contentId,
              })),
            )
            .returning({ id: attachments.id });
          // Bilder im Text zeigen auf die Kopien im Original
          const copyOf = new Map(files.map((f, i) => [f.id, copies[i]!.id]));
          const body = replaceImages(entry.body, (ref) =>
            ref.kind === 'attachment' && copyOf.has(ref.id) ? `![${ref.alt}](attachment:${copyOf.get(ref.id)})` : null,
          );
          if (body !== entry.body) await tx.update(entries).set({ body }).where(eq(entries.id, entry.id));
        }
      }
    }

    // Melder (falls nicht derselbe) und Beteiligte des Duplikats erhalten künftig die Mails des Originals
    const cc = await tx.select({ userId: participants.userId }).from(participants).where(eq(participants.itemId, duplicate.id));
    const people = [...new Set([duplicate.reporterId, ...cc.map((p) => p.userId)])].filter((id) => id !== original.reporterId);
    for (const userId of people) {
      const inserted = await tx.insert(participants).values({ itemId: original.id, userId }).onConflictDoNothing().returning();
      if (inserted.length === 0) continue;
      const [person] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      await this.items.addEntry(tx, original.id, actorId, 'change', '', {
        field: 'participantAdded',
        to: person?.name ?? '',
        viaDuplicate: duplicate.number,
      });
    }

    if (!current || !isClosedCategory(current.category)) {
      const type = duplicate.type ?? original.type!;
      const target = firstOfCategory(all, type, 'done');
      if (!target) throw new BadRequestException('Für diesen Typ ist kein Status der Kategorie «Erledigt» definiert');
      if (!duplicate.type) {
        await this.items.addEntry(tx, duplicate.id, actorId, 'type', '', {
          from: null,
          to: TYPE_LABELS[type],
          fromStatus: null,
          toStatus: target.label,
        });
      }
      await tx
        .update(items)
        .set({
          type,
          statusId: target.id,
          suggestedType: null,
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(items.id, duplicate.id));
      await this.items.addEntry(tx, duplicate.id, actorId, 'status', '', {
        from: current?.label ?? null,
        to: target.label,
        toCategory: target.category,
        duplicateOf: original.number,
        merged,
      });
    }

    return [() => this.notifications.duplicateRedirected(original, duplicate, merged, actorId)];
  }

  async remove(actorId: string, number: number, linkId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const self = await this.lockByNumber(tx, number);
      const [link] = await tx
        .select()
        .from(links)
        .where(and(eq(links.id, linkId), or(eq(links.fromId, self.id), eq(links.toId, self.id))))
        .limit(1);
      if (!link) throw new NotFoundException('Verknüpfung nicht gefunden');
      const otherId = link.fromId === self.id ? link.toId : link.fromId;
      const [other] = await tx.select().from(items).where(eq(items.id, otherId)).for('update').limit(1);
      await tx.delete(links).where(eq(links.id, link.id));
      if (other) await this.logBoth(tx, actorId, 'linkRemoved', self, other, roleOf(link, self.id));
    });
  }

  /**
   * Ein Vorgang kann nur Duplikat eines Vorgangs sein, der selbst kein Duplikat ist,
   * und ein Vorgang mit Duplikaten kann nicht selbst Duplikat werden (keine Ketten).
   */
  private async assertDuplicateAllowed(tx: Tx, duplicateId: string, originalId: string) {
    const rows = await tx
      .select()
      .from(links)
      .where(
        and(
          eq(links.kind, 'duplicate'),
          or(eq(links.fromId, duplicateId), eq(links.toId, duplicateId), eq(links.fromId, originalId)),
        ),
      );
    if (rows.some((l) => l.fromId === duplicateId)) {
      throw new BadRequestException('Dieser Vorgang ist bereits als Duplikat eines anderen Vorgangs markiert');
    }
    if (rows.some((l) => l.toId === duplicateId)) {
      throw new BadRequestException('Ein Vorgang mit eigenen Duplikaten kann nicht selbst Duplikat sein');
    }
    if (rows.some((l) => l.fromId === originalId)) {
      throw new BadRequestException('Der gewählte Vorgang ist selbst ein Duplikat. Bitte mit dem Original verknüpfen.');
    }
  }

  /**
   * Umgeleitet wird nur zu einem offenen Original: Bei einem abgeschlossenen hiesse
   * «wird dort weiterbearbeitet» nichts mehr, und der Melder bekäme keine Updates.
   */
  private async assertOpenOriginal(tx: Tx, original: Item) {
    const ref = `${itemRef(original.number)} «${original.title}»`;
    if (original.discarded) throw new BadRequestException(`${ref} ist verworfen und kann nicht Original eines Duplikats sein`);
    if (!original.statusId) return;
    const status = (await this.statuses.list(tx)).find((s) => s.id === original.statusId);
    if (status && isClosedCategory(status.category)) {
      throw new BadRequestException(
        `${ref} ist bereits abgeschlossen. Bitte das Original zuerst wieder öffnen oder «Bezieht sich auf» verwenden.`,
      );
    }
  }

  /** Timeline-Einträge in beiden Vorgängen, jeweils aus deren Sicht. */
  private async logBoth(
    tx: Tx,
    actorId: string,
    field: 'linkAdded' | 'linkRemoved',
    self: Item,
    other: Item,
    roleFromSelf: LinkRole,
  ) {
    const mirror: Record<LinkRole, LinkRole> = {
      relates: 'relates',
      fixes: 'fixedBy',
      fixedBy: 'fixes',
      duplicateOf: 'hasDuplicate',
      hasDuplicate: 'duplicateOf',
    };
    const now = new Date();
    await this.items.addEntry(tx, self.id, actorId, 'change', '', {
      field,
      role: roleFromSelf,
      roleLabel: LINK_ROLE_LABELS[roleFromSelf],
      otherNumber: other.number,
      otherTitle: other.title,
    });
    await this.items.addEntry(tx, other.id, actorId, 'change', '', {
      field,
      role: mirror[roleFromSelf],
      roleLabel: LINK_ROLE_LABELS[mirror[roleFromSelf]],
      otherNumber: self.number,
      otherTitle: self.title,
    });
    await tx.update(items).set({ updatedAt: now }).where(or(eq(items.id, self.id), eq(items.id, other.id)));
  }

  private async lockByNumber(tx: Tx, number: number): Promise<Item> {
    const [item] = await tx.select().from(items).where(eq(items.number, number)).for('update').limit(1);
    if (!item) throw new NotFoundException(`Vorgang PW-${number} nicht gefunden`);
    return item;
  }
}
