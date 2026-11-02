import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, notExists, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { attachments, entries, items, links, participants, statuses, users, type Item } from '../db/schema';
import { byKey, itemRef, type ItemKey } from './item-ref';
import { referenceMeta } from './references';
import { replaceImages } from './inline-images';
import { NotificationsService } from '../mail/notifications.service';
import { areaCondition, areaOf, type Area } from '../settings/areas';
import { StatusesService } from '../statuses/statuses.service';
import { ItemsService, statusMeta, TYPE_LABELS } from './items.service';

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

/** Höchstens so viele Vorschläge zum Zusammenführen */
const MERGE_CANDIDATES = 10;

/** Reihenfolge von Kennungen: zuerst der Präfix, dann die Nummer */
const compareKeys = (a: ItemKey, b: ItemKey) => a.prefix.localeCompare(b.prefix) || a.number - b.number;

@Injectable()
export class LinksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly statuses: StatusesService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Verknüpfungen eines Vorgangs mit den Angaben zum jeweils anderen Vorgang. Liegt dieser ausserhalb von «areas»
   * (Bereiche je Rolle, null = alle), bleibt nur seine Nummer («hidden»).
   */
  async forItem(itemId: string, areas: Area[] | null = null) {
    const rows = await this.db
      .select({
        link: links,
        other: { id: otherItem.id, prefix: otherItem.prefix, number: otherItem.number, title: otherItem.title, type: otherItem.type },
        status: { label: statuses.label, closed: statuses.closed, color: statuses.color },
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
      .map((r) => {
        const hidden = !!areas && !areas.includes(areaOf(r.other.type));
        return {
          id: r.link.id,
          role: roleOf(r.link, itemId),
          createdAt: r.link.createdAt,
          other: hidden
            ? { id: r.other.id, prefix: r.other.prefix, number: r.other.number, title: '', type: null, status: null, hidden: true }
            : { ...r.other, status: r.status?.label ? r.status : null, hidden: false },
        };
      })
      .sort((a, b) => LINK_ROLES.indexOf(a.role) - LINK_ROLES.indexOf(b.role) || compareKeys(a.other, b.other));
  }

  async add(actorId: string, key: ItemKey, role: LinkRole, otherKey: ItemKey): Promise<void> {
    if (itemRef(key) === itemRef(otherKey)) throw new BadRequestException('Ein Vorgang kann nicht mit sich selbst verknüpft werden');
    const pending: (() => Promise<void>)[] = [];
    await this.db.transaction(async (tx) => {
      // Immer in derselben Reihenfolge sperren (Präfix, dann Nummer), damit sich gleichzeitige Verknüpfungen nicht blockieren
      const [low, high] = compareKeys(key, otherKey) < 0 ? [key, otherKey] : [otherKey, key];
      const first = await this.lockByKey(tx, low);
      const second = await this.lockByKey(tx, high);
      const self = low === key ? first : second;
      const other = low === key ? second : first;
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
        // Seit 02.11.2026 nur bei gleichem Melder (Doppelmeldung); verschiedene Melder behalten ihre eigenen Vorgänge
        if (duplicate.reporterId !== original.reporterId) {
          throw new BadRequestException(
            '«Duplikat von» geht nur bei gleichem Melder. Vorgänge verschiedener Melder bitte mit «Bezieht sich auf» verknüpfen.',
          );
        }
        await this.assertOpenOriginal(tx, original);
        if (!duplicate.discarded && !duplicate.type && !original.type) {
          throw new BadRequestException(
            `Beide Vorgänge liegen im Eingang. Bitte zuerst ${itemRef(original)} (das Original) als Störung oder Aufgabe einordnen.`,
          );
        }
      }

      await tx.insert(links).values({ ...stored, createdById: actorId });
      await this.logBoth(tx, actorId, 'linkAdded', self, other, role);
      if (duplicate && original) pending.push(...(await this.redirectDuplicate(tx, actorId, duplicate, original)));
    });
    for (const job of pending) await job();
  }

  /**
   * Führt ein Duplikat (gleicher Melder) ins Original über:
   * - Meldung, Nachrichten und Notizen werden ins Original übernommen (siehe mergeInto)
   * - Beteiligte (CC) des Duplikats werden beim Original Beteiligte
   * - ein offenes Duplikat wird geschlossen (Status «Automatisch schliessen in» seines Typs, ohne Typ der des Originals)
   * Der Melder erhält statt der Erledigt-Mail einen Hinweis auf das Original.
   * Verworfene Duplikate werden nur verknüpft. Bis 02.11.2026 gab es «Duplikat von» auch bei anderem Melder (Umleitung:
   * der Melder wurde beim Original Beteiligter); solche Verknüpfungen bleiben bestehen.
   */
  private async redirectDuplicate(tx: Tx, actorId: string, duplicate: Item, original: Item) {
    if (duplicate.discarded) return [];
    const current = duplicate.statusId ? await this.statuses.get(duplicate.statusId, tx) : undefined;

    await this.mergeInto(tx, duplicate, original);

    // Beteiligte des Duplikats erhalten künftig die Mails des Originals
    const cc = await tx.select({ userId: participants.userId }).from(participants).where(eq(participants.itemId, duplicate.id));
    const people = [...new Set(cc.map((p) => p.userId))].filter((id) => id !== original.reporterId);
    for (const userId of people) {
      const inserted = await tx.insert(participants).values({ itemId: original.id, userId }).onConflictDoNothing().returning();
      if (inserted.length === 0) continue;
      const [person] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      await this.items.addEntry(tx, original.id, actorId, 'change', '', {
        field: 'participantAdded',
        to: person?.name ?? '',
        ...referenceMeta('viaDuplicate', duplicate),
      });
    }

    if (!current?.closed) {
      const type = duplicate.type ?? original.type!;
      const target = await this.statuses.targetStatus(type, 'close', tx);
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
        ...statusMeta(current, target),
        ...referenceMeta('duplicateOf', original),
        merged: true,
      });
    }

    return [() => this.notifications.duplicateMerged(original, duplicate, actorId)];
  }

  /**
   * Zusammenführen (seit 02.11.2026 wie in HelpSpot alles): Die Meldung des Duplikats erscheint im Original als Nachricht
   * des Melders, dazu alle öffentlichen Nachrichten und internen Notizen, jeweils mit Anhängen und zu ihrer ursprünglichen
   * Zeit. Änderungen (Status, Zuständig usw.) bleiben im Duplikat. Ohne Wiederöffnen und ohne Mails; die Kopien tragen
   * «source: merge» (die ursprüngliche Herkunft in «mergedSource»), damit Regeln sie nicht als neue Antworten sehen.
   */
  private async mergeInto(tx: Tx, duplicate: Item, original: Item) {
    const from = { ...referenceMeta('mergedFrom', duplicate), mergedTitle: duplicate.title };
    const files = await tx.select().from(attachments).where(eq(attachments.itemId, duplicate.id)).orderBy(asc(attachments.createdAt));
    const messages = await tx
      .select()
      .from(entries)
      .where(and(eq(entries.itemId, duplicate.id), inArray(entries.kind, ['reply', 'note'])))
      .orderBy(asc(entries.createdAt));

    // Kopie je Eintrag des Duplikats; «null» steht für die Meldung (Anhänge ohne Eintrag)
    const copies = new Map<string | null, { id: string; body: string }>();
    if (duplicate.description.trim() || files.some((f) => !f.entryId)) {
      const [copy] = await tx
        .insert(entries)
        .values({
          itemId: original.id,
          authorId: duplicate.reporterId,
          kind: 'reply',
          body: duplicate.description,
          bodyHtml: duplicate.descriptionHtml,
          meta: { source: 'merge', ...from },
          createdAt: duplicate.createdAt,
        })
        .returning({ id: entries.id, body: entries.body });
      copies.set(null, copy!);
    }
    for (const e of messages) {
      const source = e.meta?.source;
      const [copy] = await tx
        .insert(entries)
        .values({
          itemId: original.id,
          authorId: e.authorId,
          kind: e.kind,
          body: e.body,
          bodyHtml: e.bodyHtml,
          meta: { ...e.meta, source: 'merge', ...(source && source !== 'merge' ? { mergedSource: source } : {}), ...from },
          mailMessageId: e.mailMessageId,
          createdAt: e.createdAt,
          editedAt: e.editedAt,
          originalCreatedAt: e.originalCreatedAt,
          timeChangedAt: e.timeChangedAt,
          timeChangedById: e.timeChangedById,
          recordedById: e.recordedById,
        })
        .returning({ id: entries.id, body: entries.body });
      copies.set(e.id, copy!);
    }

    // Anhänge (dieselbe Datei) zur jeweiligen Kopie; Anhänge von Änderungen (z.B. Begründung einer Ablehnung) bleiben
    const kept = files.filter((f) => copies.has(f.entryId));
    if (kept.length === 0) return;
    const inserted = await tx
      .insert(attachments)
      .values(
        kept.map((f) => ({
          itemId: original.id,
          entryId: copies.get(f.entryId)!.id,
          filename: f.filename,
          contentType: f.contentType,
          size: f.size,
          storageKey: f.storageKey,
          contentId: f.contentId,
        })),
      )
      .returning({ id: attachments.id });
    // Bilder im Text zeigen auf die Kopien im Original
    const copyOf = new Map(kept.map((f, i) => [f.id, inserted[i]!.id]));
    for (const copy of copies.values()) {
      const body = replaceImages(copy.body, (ref) =>
        ref.kind === 'attachment' && copyOf.has(ref.id) ? `![${ref.alt}](attachment:${copyOf.get(ref.id)})` : null,
      );
      if (body !== copy.body) await tx.update(entries).set({ body }).where(eq(entries.id, copy.id));
    }
  }

  /**
   * Vorschläge zum Zusammenführen: offene Vorgänge desselben Melders, ohne verworfene und ohne solche, die schon
   * Duplikat sind, neueste zuerst. Nur Vorgänge in «areas» (Bereiche je Rolle, null = alle).
   */
  async mergeCandidates(key: ItemKey, areas: Area[] | null) {
    const [self] = await this.db.select().from(items).where(byKey(key)).limit(1);
    if (!self) throw new NotFoundException(`Vorgang ${itemRef(key)} nicht gefunden`);
    const isDuplicate = this.db
      .select({ id: links.id })
      .from(links)
      .where(and(eq(links.kind, 'duplicate'), eq(links.fromId, items.id)));
    const rows = await this.db
      .select({
        id: items.id,
        prefix: items.prefix,
        number: items.number,
        title: items.title,
        type: items.type,
        createdAt: items.createdAt,
        status: { label: statuses.label, closed: statuses.closed, color: statuses.color },
      })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .where(
        and(
          eq(items.reporterId, self.reporterId),
          ne(items.id, self.id),
          eq(items.discarded, false),
          or(isNull(items.statusId), eq(statuses.closed, false)),
          notExists(isDuplicate),
          areas ? areaCondition(areas) : undefined,
        ),
      )
      .orderBy(desc(items.createdAt))
      .limit(MERGE_CANDIDATES);
    return rows.map((r) => ({ ...r, status: r.status?.label ? r.status : null }));
  }

  async remove(actorId: string, key: ItemKey, linkId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const self = await this.lockByKey(tx, key);
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
    const ref = `${itemRef(original)} «${original.title}»`;
    if (original.discarded) throw new BadRequestException(`${ref} ist verworfen und kann nicht Original eines Duplikats sein`);
    if (!original.statusId) return;
    const status = await this.statuses.get(original.statusId, tx);
    if (status.closed) {
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
      ...referenceMeta('other', other),
      otherTitle: other.title,
    });
    await this.items.addEntry(tx, other.id, actorId, 'change', '', {
      field,
      role: mirror[roleFromSelf],
      roleLabel: LINK_ROLE_LABELS[mirror[roleFromSelf]],
      ...referenceMeta('other', self),
      otherTitle: self.title,
    });
    await tx.update(items).set({ updatedAt: now }).where(or(eq(items.id, self.id), eq(items.id, other.id)));
  }

  private async lockByKey(tx: Tx, key: ItemKey): Promise<Item> {
    const [item] = await tx.select().from(items).where(byKey(key)).for('update').limit(1);
    if (!item) throw new NotFoundException(`Vorgang ${itemRef(key)} nicht gefunden`);
    return item;
  }
}
