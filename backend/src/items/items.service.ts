import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, max, ne, or, sql } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import {
  attachments,
  checklistItems,
  checklists,
  entries,
  items,
  links,
  mailboxes,
  mailMessages,
  mutes,
  outgoingMails,
  participants,
  statuses,
  uploads,
  users,
  type Attachment,
  type Entry,
  type Item,
  type ItemType,
  type Priority,
  type Status,
  type User,
} from '../db/schema';
import { ChannelsService } from '../channels/channels.service';
import { templateByKey, TIMELINE_TEMPLATES } from '../mail/mail-templates';
import { MailboxesService } from '../mail/mailboxes.service';
import { NotificationsService } from '../mail/notifications.service';
import { visibleInPortal } from '../portal/portal-visibility';
import { isCompleting, reopensOnReply } from '../statuses/status-rules';
import { StatusesService } from '../statuses/statuses.service';
import { StorageService } from '../storage/storage.service';
import { toPublicUser, UsersService } from '../users/users.service';
import { duplicateRedirect } from './duplicates';
import { imageRefs, replaceImages, TEXT_IMAGE_TYPES } from './inline-images';
import { noteEditRefusal } from './note-rules';
import { closedAtAfter, moveTarget, newItemStatus, typeChangeStatus } from './status-change';
import type { RuleRun } from '../rules/rules.service';
import { assigneeUser, reporterUser, searchCondition, summaryColumns, viewQuery, type View } from './item-views';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
export const TYPE_LABELS: Record<ItemType, string> = { incident: 'Störung', task: 'Aufgabe' };

/** Multer liefert Dateinamen als latin1. Umlaute wiederherstellen, wenn der Name gültiges UTF-8 ist. */
export function decodeFilename(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

type Pending = (() => Promise<void>)[];

@Injectable()
export class ItemsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statuses: StatusesService,
    private readonly channels: ChannelsService,
    private readonly users: UsersService,
    private readonly mailboxes: MailboxesService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- Lesen

  async list(view: View, opts: { userId: string; mine: boolean; q: string; limit: number; offset: number }) {
    const { where, orderBy } = viewQuery(view);
    const search = searchCondition(opts.q);
    if (view === 'search' && !search) return { items: [], total: 0 };
    const condition = and(where, search, opts.mine ? eq(items.assigneeId, opts.userId) : undefined);

    const paged = view !== 'board' && view !== 'incidents' && view !== 'inbox';
    const base = this.db
      .select(summaryColumns)
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .innerJoin(reporterUser, eq(reporterUser.id, items.reporterId))
      .leftJoin(assigneeUser, eq(assigneeUser.id, items.assigneeId))
      .where(condition)
      .orderBy(...orderBy);
    const rows = paged ? await base.limit(opts.limit).offset(opts.offset) : await base;

    let total = rows.length;
    if (paged) {
      const [count] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .leftJoin(statuses, eq(statuses.id, items.statusId))
        .where(condition);
      total = count?.count ?? 0;
    }
    return { items: rows.map((r) => this.toSummary(r)), total };
  }

  /** Anzahl offener Vorgänge je Tab (Status nicht abgeschlossen). */
  async counts() {
    const [row] = await this.db
      .select({
        inbox: sql<number>`count(*) filter (where ${items.type} is null and not ${items.discarded})::int`,
        incidents: sql<number>`count(*) filter (where ${items.type} = 'incident' and not ${statuses.closed})::int`,
        tasks: sql<number>`count(*) filter (where ${items.type} = 'task' and not ${statuses.closed})::int`,
      })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId));
    return row ?? { inbox: 0, incidents: 0, tasks: 0 };
  }

  async detail(number: number, viewer: User) {
    const item = await this.byNumber(number);
    const [status, reporter, creator, assignee, mailbox, channel] = await Promise.all([
      item.statusId ? this.statuses.get(item.statusId) : null,
      this.users.getById(item.reporterId),
      this.users.getById(item.creatorId),
      item.assigneeId ? this.users.getById(item.assigneeId) : null,
      item.mailboxId
        ? this.db
            .select({ id: mailboxes.id, name: mailboxes.name, address: mailboxes.address })
            .from(mailboxes)
            .where(eq(mailboxes.id, item.mailboxId))
            .then((r) => r[0] ?? null)
        : null,
      item.channelId ? this.channels.get(item.channelId) : null,
    ]);

    const [participantRows, entryRows, attachmentRows, muteRows, mailRows, outgoingRows] = await Promise.all([
      this.db
        .select({ user: users })
        .from(participants)
        .innerJoin(users, eq(users.id, participants.userId))
        .where(eq(participants.itemId, item.id))
        .orderBy(asc(users.name)),
      this.db
        .select({ entry: entries, author: users })
        .from(entries)
        .leftJoin(users, eq(users.id, entries.authorId))
        .where(eq(entries.itemId, item.id))
        .orderBy(asc(entries.createdAt)),
      this.db.select().from(attachments).where(eq(attachments.itemId, item.id)).orderBy(asc(attachments.createdAt)),
      this.db
        .select()
        .from(mutes)
        .where(and(eq(mutes.itemId, item.id), eq(mutes.userId, viewer.id))),
      this.db
        .select({ messageId: mailMessages.messageId, entryId: mailMessages.entryId })
        .from(mailMessages)
        .where(and(eq(mailMessages.itemId, item.id), eq(mailMessages.direction, 'in'), isNotNull(mailMessages.storageKey)))
        .orderBy(asc(mailMessages.createdAt)),
      // Versendete Mails: öffentliche Antworten und die automatischen Mails an Melder und Beteiligte, auch solche unter
      // einem anderen Vorgang, die diesen betreffen (Duplikat-Hinweis läuft unter dem Original)
      this.db
        .select({
          id: outgoingMails.id,
          itemId: outgoingMails.itemId,
          entryId: outgoingMails.entryId,
          template: outgoingMails.template,
          status: outgoingMails.status,
          to: outgoingMails.to,
          cc: outgoingMails.cc,
          deliveredTo: outgoingMails.deliveredTo,
          error: outgoingMails.error,
          createdAt: outgoingMails.createdAt,
        })
        .from(outgoingMails)
        .where(
          or(
            and(
              eq(outgoingMails.itemId, item.id),
              or(isNotNull(outgoingMails.entryId), inArray(outgoingMails.template, TIMELINE_TEMPLATES)),
            ),
            and(eq(outgoingMails.relatedItemId, item.id), inArray(outgoingMails.template, TIMELINE_TEMPLATES)),
          ),
        )
        .orderBy(asc(outgoingMails.createdAt)),
    ]);
    const replyMails = outgoingRows.filter((r) => r.entryId && r.itemId === item.id);
    const mailByEntry = new Map(replyMails.map((r) => [r.entryId!, r.id]));
    // Versand der öffentlichen Antworten, nur Abweichungen: nicht oder teilweise versendet, Fehler, noch unterwegs
    const deliveryByEntry = new Map(
      replyMails
        .filter((r) => r.status !== 'sent')
        .map((r) => [
          r.entryId!,
          {
            status: r.status,
            deliveredTo: r.deliveredTo,
            withheld: [...r.to, ...r.cc].filter((a) => !r.deliveredTo.includes(a)),
            error: r.error,
          },
        ]),
    );
    const timelineMails = outgoingRows.filter((r) => !r.entryId && r.template);
    const recipientNames = await this.namesByEmail(timelineMails.flatMap((r) => [...r.to, ...r.cc]));
    const recipient = (email: string) => ({ email, name: recipientNames.get(email) ?? null });

    const toAttachment = (a: (typeof attachmentRows)[number]) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      inline: !!a.contentId,
    });
    const originalByEntry = new Map(mailRows.filter((m) => m.entryId).map((m) => [m.entryId!, m.messageId]));
    const originalOfItem = item.source === 'mail' ? (mailRows.find((m) => !m.entryId)?.messageId ?? null) : null;

    return {
      id: item.id,
      number: item.number,
      type: item.type,
      title: item.title,
      description: item.description,
      descriptionHtml: item.descriptionHtml,
      priority: item.priority,
      source: item.source,
      channel: channel && { id: channel.id, label: channel.label, icon: channel.icon },
      suggestedType: item.suggestedType,
      simulated: item.simulated,
      discarded: item.discarded,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      closedAt: item.closedAt,
      status: status && { id: status.id, label: status.label, closed: status.closed, color: status.color },
      reporter: toPublicUser(reporter),
      creator: toPublicUser(creator),
      assignee: assignee && toPublicUser(assignee),
      mailbox,
      muted: muteRows.length > 0,
      originalMessageId: originalOfItem,
      participants: participantRows.map((r) => toPublicUser(r.user)),
      attachments: attachmentRows.filter((a) => !a.entryId).map(toAttachment),
      entries: entryRows.map(({ entry, author }) => ({
        id: entry.id,
        kind: entry.kind,
        body: entry.body,
        bodyHtml: entry.bodyHtml,
        meta: entry.meta,
        createdAt: entry.createdAt,
        editedAt: entry.editedAt,
        author: author && toPublicUser(author),
        originalMessageId: originalByEntry.get(entry.id) ?? null,
        delivery: deliveryByEntry.get(entry.id) ?? null,
        /** Die versendete Mail einer öffentlichen Antwort */
        mailId: mailByEntry.get(entry.id) ?? null,
        attachments: attachmentRows.filter((a) => a.entryId === entry.id).map(toAttachment),
      })),
      mails: timelineMails.map((r) => ({
        id: r.id,
        template: r.template!,
        label: templateByKey(r.template!)?.label ?? r.template!,
        createdAt: r.createdAt,
        status: r.status,
        to: r.to.map(recipient),
        cc: r.cc.map(recipient),
        deliveredTo: r.deliveredTo,
        error: r.error,
      })),
    };
  }

  /** Namen der Benutzer zu Mail-Adressen (für die Empfänger im Verlauf). */
  private async namesByEmail(emails: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(emails)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.email, unique));
    return new Map(rows.map((r) => [r.email, r.name]));
  }

  async byNumber(number: number, tx: Tx = this.db): Promise<Item> {
    const [item] = await tx.select().from(items).where(eq(items.number, number)).limit(1);
    if (!item) throw new NotFoundException('Vorgang nicht gefunden');
    return item;
  }

  // ---------------------------------------------------------------- Erfassen

  /** Intern erfasster Vorgang: Typ ist gewählt und landet direkt im richtigen Tab. */
  async createInternal(
    actor: User,
    input: {
      type: ItemType;
      title: string;
      description: string;
      priority: Priority;
      reporterId?: string | null;
      assigneeId?: string | null;
      statusId?: string | null;
      /** Meldeweg, beim internen Erfassen Pflicht */
      channelId: string;
    },
    files: UploadedFile[],
  ): Promise<Item> {
    const pending: Pending = [];
    const item = await this.db.transaction(async (tx) => {
      await this.channels.get(input.channelId, tx);
      const [all, targets] = await Promise.all([this.statuses.list(tx), this.statuses.targets(tx)]);
      // Ohne Wahl «Neuer Vorgang erhält», der Ablehnen-Status ist nicht wählbar
      const status = newItemStatus(all, targets[input.type], input.type, input.statusId);

      const reporterId = input.reporterId ?? actor.id;
      await this.users.getById(reporterId, tx);
      if (input.assigneeId) await this.assertStaff(input.assigneeId, tx);
      const mailbox = await this.mailboxes.getDefault(tx);

      const [created] = await tx
        .insert(items)
        .values({
          type: input.type,
          statusId: status.id,
          title: input.title.trim(),
          description: input.description,
          priority: input.priority,
          creatorId: actor.id,
          reporterId,
          assigneeId: input.assigneeId ?? null,
          mailboxId: mailbox?.id ?? null,
          source: 'internal',
          channelId: input.channelId,
          closedAt: status.closed ? new Date() : null,
          boardPosition: await this.endOfColumn(tx, status.id),
        })
        .returning();
      await this.saveFiles(tx, created!.id, null, files);
      await this.claimDescriptionImages(tx, actor, created!);

      if (reporterId !== actor.id) pending.push(() => this.notifications.confirmation(created!));
      if (created!.assigneeId) pending.push(() => this.notifications.assigned(created!, actor.id));
      return created!;
    });
    await this.flush(pending);
    return item;
  }

  // ---------------------------------------------------------------- Bearbeiten

  async update(
    actor: User,
    number: number,
    patch: {
      title?: string;
      description?: string;
      priority?: Priority;
      assigneeId?: string | null;
      reporterId?: string;
      mailboxId?: string | null;
      channelId?: string;
    },
  ): Promise<void> {
    const pending: Pending = [];
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      const changes: Partial<typeof items.$inferInsert> = {};
      const log: Record<string, unknown>[] = [];

      if (patch.title !== undefined && patch.title.trim() !== item.title) {
        changes.title = patch.title.trim();
        log.push({ field: 'title', from: item.title, to: changes.title });
      }
      if (patch.description !== undefined && patch.description !== item.description) {
        changes.description = await this.claimImages(tx, actor, item.id, null, patch.description);
        // Nach dem Bearbeiten gilt der Markdown-Text, nicht mehr das HTML der Mail
        changes.descriptionHtml = null;
        log.push({ field: 'description' });
      }
      if (patch.priority !== undefined && patch.priority !== item.priority) {
        changes.priority = patch.priority;
        log.push({ field: 'priority', from: PRIORITY_LABELS[item.priority], to: PRIORITY_LABELS[patch.priority] });
      }
      if (patch.channelId !== undefined && patch.channelId !== item.channelId) {
        const before = item.channelId ? await this.channels.get(item.channelId, tx) : null;
        const after = await this.channels.get(patch.channelId, tx);
        changes.channelId = patch.channelId;
        log.push({ field: 'channel', from: before?.label ?? null, to: after.label });
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== item.assigneeId) {
        const before = item.assigneeId ? await this.users.getById(item.assigneeId, tx) : null;
        const after = patch.assigneeId ? await this.assertStaff(patch.assigneeId, tx) : null;
        changes.assigneeId = patch.assigneeId;
        log.push({ field: 'assignee', from: before?.name ?? null, to: after?.name ?? null });
      }
      if (patch.reporterId !== undefined && patch.reporterId !== item.reporterId) {
        const before = await this.users.getById(item.reporterId, tx);
        const after = await this.users.getById(patch.reporterId, tx);
        changes.reporterId = patch.reporterId;
        log.push({ field: 'reporter', from: before.name, to: after.name });
        // Der neue Melder ist nicht zusätzlich Beteiligter
        await tx
          .delete(participants)
          .where(and(eq(participants.itemId, item.id), eq(participants.userId, patch.reporterId)));
      }
      if (patch.mailboxId !== undefined && patch.mailboxId !== item.mailboxId) {
        // Ohne Antwort-Postfach gilt das Standard-Postfach: im Verlauf das tatsächliche Postfach nennen
        const before = item.mailboxId
          ? await this.mailboxes.get(item.mailboxId, tx).catch(() => null)
          : await this.mailboxes.getDefault(tx);
        const after = patch.mailboxId ? await this.mailboxes.get(patch.mailboxId, tx) : await this.mailboxes.getDefault(tx);
        changes.mailboxId = patch.mailboxId;
        if (before?.id !== after?.id) log.push({ field: 'mailbox', from: before?.address ?? null, to: after?.address ?? null });
      }

      if (Object.keys(changes).length === 0) return;
      const [updated] = await tx
        .update(items)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(items.id, item.id))
        .returning();
      for (const meta of log) await this.addEntry(tx, item.id, actor.id, 'change', '', meta);
      if (changes.assigneeId) pending.push(() => this.notifications.assigned(updated!, actor.id));
    });
    await this.flush(pending);
  }

  /**
   * Typ zuweisen (aus dem Eingang) oder umklassieren. Verlauf, Kommentare und Anhänge bleiben erhalten.
   * Status im neuen Typ: der gewählte («statusId») oder der Vorschlag nach der Rolle des bisherigen Status, aus dem
   * Eingang «Neuer Vorgang erhält». Als automatischer Wechsel prüft der Typwechsel den Ablauf nicht.
   */
  async setType(actor: User, number: number, type: ItemType, statusId?: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (item.type === type && !item.discarded) return;
      const [all, targets] = await Promise.all([this.statuses.list(tx), this.statuses.targets(tx)]);
      const current = item.statusId ? all.find((s) => s.id === item.statusId) : undefined;
      const target = typeChangeStatus(all, targets, current, type, statusId);

      await tx
        .update(items)
        .set({
          type,
          statusId: target.id,
          suggestedType: null,
          discarded: false,
          closedAt: closedAtAfter(item.closedAt, current, target),
          boardPosition: await this.endOfColumn(tx, target.id),
          updatedAt: new Date(),
        })
        .where(eq(items.id, item.id));
      // Checklisten gibt es nur bei Aufgaben: Sie bleiben gespeichert und werden bei Störungen ausgeblendet
      const [hasChecklists] = await tx.select({ id: checklists.id }).from(checklists).where(eq(checklists.itemId, item.id)).limit(1);
      await this.addEntry(tx, item.id, actor.id, 'type', '', {
        from: item.type ? TYPE_LABELS[item.type] : null,
        to: TYPE_LABELS[type],
        fromStatus: current?.label ?? null,
        toStatus: target.label,
        ...(hasChecklists ? { checklists: type === 'task' ? 'shown' : 'hidden' } : {}),
      });
    });
  }

  async setStatus(actor: User, number: number, statusId: string, force = false): Promise<void> {
    await this.move(actor, number, statusId, null, null, force);
  }

  /**
   * Status setzen und optional auf dem Board zwischen zwei Karten einordnen.
   * In den Ablehnen-Status geht es nur über reject(), weil es eine Begründung braucht.
   * Ein Wechsel, der den Vorgang erledigt (in einen abgeschlossenen Status ausser dem Ablehnen-Status, siehe
   * isCompleting), schickt die Mail «Erledigt» und meldet sich bei «Behebt»; hat eine Aufgabe offene
   * Checklisten-Punkte, verlangt er eine Bestätigung (force).
   */
  async move(
    actor: User,
    number: number,
    statusId: string,
    beforeId: string | null,
    afterId: string | null,
    force = false,
  ): Promise<void> {
    const pending: Pending = [];
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (!item.type) throw new BadRequestException('Bitte zuerst einen Typ zuweisen');
      const [all, targets] = await Promise.all([this.statuses.list(tx), this.statuses.targets(tx)]);
      const target = moveTarget(all, targets[item.type], item.type, statusId);
      const current = all.find((s) => s.id === item.statusId);
      const completing = target.id !== item.statusId && isCompleting(targets[item.type], current, target);
      // Wechsel von Hand nur gemäss Ablauf, falls er für den Typ eingeschränkt ist
      if (target.id !== item.statusId) await this.statuses.assertTransition(item.type, current, target, tx);

      if (completing && item.type === 'task' && !force) {
        const open = await this.openChecklistItems(tx, item.id);
        if (open > 0) {
          throw new ConflictException({
            statusCode: 409,
            code: 'OPEN_CHECKLIST',
            open,
            message: `${open === 1 ? 'Ein Punkt' : `${open} Punkte`} der Checklisten ${open === 1 ? 'ist' : 'sind'} noch offen.`,
          });
        }
      }

      const changes: Partial<typeof items.$inferInsert> = { updatedAt: new Date() };
      if (beforeId || afterId) {
        changes.boardPosition = await this.positionBetween(tx, target.id, item.id, beforeId, afterId);
      } else if (target.id !== item.statusId) {
        changes.boardPosition = await this.endOfColumn(tx, target.id);
      }
      if (target.id !== item.statusId) {
        changes.statusId = target.id;
        changes.closedAt = closedAtAfter(item.closedAt, current, target);
      }
      const [updated] = await tx.update(items).set(changes).where(eq(items.id, item.id)).returning();

      if (target.id !== item.statusId) {
        await this.addEntry(tx, item.id, actor.id, 'status', '', { from: current?.label ?? null, to: target.label });
        if (completing) {
          pending.push(() => this.notifications.done(updated!, actor.id, target.label));
          pending.push(...(await this.onFixingItemCompleted(tx, updated!, actor)));
        }
      }
    });
    await this.flush(pending);
  }

  /**
   * Ein Vorgang, der andere «behebt», wurde erledigt: Eintrag in deren Timelines
   * und Mail an deren Zuständige. Kein automatisches Schliessen.
   */
  private async onFixingItemCompleted(tx: Tx, fixing: Item, actor: User): Promise<Pending> {
    const fixed = await tx
      .select({ item: items })
      .from(links)
      .innerJoin(items, eq(items.id, links.toId))
      .where(and(eq(links.fromId, fixing.id), eq(links.kind, 'fixes')));
    const pending: Pending = [];
    for (const { item } of fixed) {
      await this.addEntry(tx, item.id, actor.id, 'change', '', {
        field: 'fixCompleted',
        otherNumber: fixing.number,
        otherTitle: fixing.title,
      });
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, item.id));
      pending.push(() => this.notifications.fixCompleted(item, fixing, actor.id));
    }
    return pending;
  }

  private async openChecklistItems(tx: Tx, itemId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(checklistItems)
      .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
      .where(and(eq(checklists.itemId, itemId), eq(checklistItems.done, false)));
    return row?.count ?? 0;
  }

  /**
   * Ablehnen mit Begründung: in den Status «Ablehnen führt in» des Typs. Ohne dieses Ziel, aus dem Ablehnen-Status
   * selbst und bei eingeschränktem Ablauf ohne Pfeil in den Ablehnen-Status nicht möglich (siehe rejectTarget).
   */
  async reject(actor: User, number: number, reason: string, notify: boolean): Promise<void> {
    const pending: Pending = [];
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (!item.type) throw new BadRequestException('Bitte zuerst einen Typ zuweisen');
      const current = item.statusId ? await this.statuses.get(item.statusId, tx) : undefined;
      const target = await this.statuses.rejectTarget(item.type, current, tx);

      const [updated] = await tx
        .update(items)
        .set({ statusId: target.id, closedAt: closedAtAfter(item.closedAt, current, target), updatedAt: new Date() })
        .where(eq(items.id, item.id))
        .returning();
      const entry = await this.addEntry(tx, item.id, actor.id, 'status', reason, {
        from: current?.label ?? null,
        to: target.label,
        rejected: true,
        notified: notify,
      });
      const text = await this.claimEntryImages(tx, actor, entry);
      if (notify) pending.push(() => this.notifications.rejected(updated!, actor.id, text));
    });
    await this.flush(pending);
  }

  /** Vorgang im Eingang verwerfen (Spam, Newsletter) bzw. wiederherstellen. */
  async setDiscarded(actor: User, number: number, discarded: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (item.type) throw new BadRequestException('Nur Vorgänge ohne Typ können verworfen werden');
      if (item.discarded === discarded) return;
      await tx
        .update(items)
        .set({ discarded, closedAt: discarded ? new Date() : null, updatedAt: new Date() })
        .where(eq(items.id, item.id));
      await this.addEntry(tx, item.id, actor.id, 'change', '', { field: discarded ? 'discarded' : 'restored' });
    });
  }

  /** Öffentliche Antwort (geht per Mail an Melder und Beteiligte) oder interne Notiz. */
  async comment(actor: User, number: number, kind: 'reply' | 'note', body: string, files: UploadedFile[]): Promise<void> {
    if (!body.trim() && files.length === 0) throw new BadRequestException('Der Text ist leer');
    const pending: Pending = [];
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (kind === 'reply' && !(await this.mailboxes.forSending(item.mailboxId, tx))) {
        const hasRecipients =
          item.reporterId !== actor.id ||
          (await tx.select().from(participants).where(eq(participants.itemId, item.id)).limit(1)).length > 0;
        if (hasRecipients) throw new BadRequestException('Es ist kein aktives Postfach für den Versand eingerichtet');
      }
      const entry = await this.addEntry(tx, item.id, actor.id, kind, body, null);
      const text = await this.claimEntryImages(tx, actor, entry);
      const saved = await this.saveFiles(tx, item.id, entry.id, files);
      const [updated] = await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, item.id)).returning();
      if (kind === 'reply') {
        pending.push(() =>
          this.notifications.publicReply(
            updated!,
            actor.id,
            text,
            entry.id,
            saved.map((a) => a.id),
          ),
        );
      }
    });
    await this.flush(pending);
  }

  /** Eigene interne Notiz kurz nach dem Erfassen korrigieren (siehe note-rules). */
  async editNote(actor: User, entryId: string, body: string): Promise<void> {
    if (!body.trim()) throw new BadRequestException('Der Text ist leer');
    await this.db.transaction(async (tx) => {
      const [entry] = await tx.select().from(entries).where(eq(entries.id, entryId)).for('update').limit(1);
      if (!entry) throw new NotFoundException('Eintrag nicht gefunden');
      const refusal = noteEditRefusal(entry, actor.id, new Date());
      if (refusal?.reason === 'expired') throw new BadRequestException(refusal.message);
      if (refusal) throw new ForbiddenException(refusal.message);
      if (entry.body === body) return;
      const text = await this.claimImages(tx, actor, entry.itemId, entry.id, body);
      await tx.update(entries).set({ body: text, editedAt: new Date() }).where(eq(entries.id, entry.id));
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, entry.itemId));
    });
  }

  async addParticipant(actor: User, number: number, email: string, name?: string): Promise<void> {
    const own = await this.mailboxes.ownAddresses();
    if (own.has(email.toLowerCase())) throw new BadRequestException('Eigene Postfächer können nicht beteiligt werden');
    // Vor- und Nachname einer neuen Person aus dem AD, vor der Transaktion (Abfrage übers Netz)
    const directory = await this.users.directoryNames([email]);
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      const user = await this.users.findOrCreateContact(email, name, tx, directory);
      if (user.id === item.reporterId) throw new BadRequestException('Diese Person ist bereits Melder');
      const inserted = await tx
        .insert(participants)
        .values({ itemId: item.id, userId: user.id })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        await this.addEntry(tx, item.id, actor.id, 'change', '', { field: 'participantAdded', to: user.name });
      }
    });
  }

  async removeParticipant(actor: User, number: number, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      const removed = await tx
        .delete(participants)
        .where(and(eq(participants.itemId, item.id), eq(participants.userId, userId)))
        .returning();
      if (removed.length > 0) {
        const user = await this.users.getById(userId, tx);
        await this.addEntry(tx, item.id, actor.id, 'change', '', { field: 'participantRemoved', from: user.name });
      }
    });
  }

  async setMuted(actor: User, number: number, muted: boolean): Promise<void> {
    const item = await this.byNumber(number);
    if (muted) await this.db.insert(mutes).values({ userId: actor.id, itemId: item.id }).onConflictDoNothing();
    else await this.db.delete(mutes).where(and(eq(mutes.userId, actor.id), eq(mutes.itemId, item.id)));
  }

  // ---------------------------------------------------------------- Portal

  /** Neue Meldung aus dem Portal: landet im Eingang mit dem Typ-Vorschlag des Melders. */
  async createFromPortal(
    reporter: User,
    input: { suggestedType: ItemType; title: string; description: string },
    files: UploadedFile[],
    rules?: RuleRun,
  ): Promise<Item> {
    const item = await this.db.transaction(async (tx) => {
      const mailbox = await this.mailboxes.getDefault(tx);
      const [created] = await tx
        .insert(items)
        .values({
          title: input.title.trim(),
          description: input.description,
          suggestedType: input.suggestedType,
          creatorId: reporter.id,
          reporterId: reporter.id,
          mailboxId: mailbox?.id ?? null,
          source: 'portal',
          channelId: await this.channels.idByKey('portal', tx),
        })
        .returning();
      await this.saveFiles(tx, created!.id, null, files);
      await this.claimDescriptionImages(tx, reporter, created!);
      await rules?.apply(tx, created!);
      return created!;
    });
    await rules?.afterCommit();
    if (!rules?.suppressConfirmation && !rules?.discarded) await this.notifications.confirmation(item);
    return item;
  }

  /**
   * Antwort des Melders im Portal. Wirkt wie eine Antwort per Mail: holt den Vorgang aus dem Wartet-Status bzw.
   * aus einem abgeschlossenen Status (ausser dem Ablehnen-Status) zurück und informiert den Zuständigen.
   */
  async portalReply(reporter: User, number: number, body: string, files: UploadedFile[], rules?: RuleRun): Promise<void> {
    if (!body.trim() && files.length === 0) throw new BadRequestException('Der Text ist leer');
    let updated: Item | undefined;
    let text = body;
    await this.db.transaction(async (tx) => {
      const item = await this.lock(tx, number);
      if (item.reporterId !== reporter.id || item.discarded) throw new NotFoundException('Vorgang nicht gefunden');
      const duplicateOf = await duplicateRedirect(tx, item);
      if (duplicateOf) {
        throw new BadRequestException(
          `Dieser Vorgang wird unter PW-${duplicateOf.number} weiterbearbeitet. Bitte antworten Sie auf die zugehörige Mail.`,
        );
      }
      const entry = await this.addEntry(tx, item.id, reporter.id, 'reply', body, { source: 'portal' });
      text = await this.claimEntryImages(tx, reporter, entry);
      await this.saveFiles(tx, item.id, entry.id, files);
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, item.id));
      await this.reopenAfterReply(tx, item, 'portal');
      await rules?.apply(tx, item);
      updated = item;
    });
    await rules?.afterCommit();
    if (updated) await this.notifications.inboundReply(updated, reporter, text);
  }

  // ---------------------------------------------------------------- Mail-Eingang

  /**
   * Antwort des Melders oder eines Beteiligten: Aus dem Wartet-Status oder einem abgeschlossenen Status (ausser dem
   * Ablehnen-Status) geht der Vorgang in den Status «Antwort des Melders führt in» seines Typs.
   */
  async reopenAfterReply(tx: Tx, item: Item, via: 'mail' | 'portal' = 'mail'): Promise<Status | null> {
    if (!item.type || !item.statusId) return null;
    const [current, targets] = await Promise.all([this.statuses.get(item.statusId, tx), this.statuses.targets(tx)]);
    if (!reopensOnReply(targets[item.type], current)) return null;
    const target = await this.statuses.targetStatus(item.type, 'reply', tx);
    if (target.id === current.id) return null;
    await tx
      .update(items)
      .set({
        statusId: target.id,
        closedAt: null,
        boardPosition: await this.endOfColumn(tx, target.id),
        updatedAt: new Date(),
      })
      .where(eq(items.id, item.id));
    await this.addEntry(tx, item.id, null, 'status', '', { from: current.label, to: target.label, reason: 'reply', via });
    return target;
  }

  // ---------------------------------------------------------------- Hilfsfunktionen

  async addEntry(
    tx: Tx,
    itemId: string,
    authorId: string | null,
    kind: Entry['kind'],
    body: string,
    meta: Record<string, unknown> | null,
    extra: { bodyHtml?: string | null; mailMessageId?: string | null } = {},
  ): Promise<Entry> {
    const [entry] = await tx
      .insert(entries)
      .values({
        itemId,
        authorId,
        kind,
        body,
        meta,
        bodyHtml: extra.bodyHtml ?? null,
        mailMessageId: extra.mailMessageId ?? null,
      })
      .returning();
    return entry!;
  }

  /** Bilder im Text eines neuen Eintrags übernehmen; liefert den gespeicherten Text. */
  private async claimEntryImages(tx: Tx, actor: User, entry: Entry): Promise<string> {
    const text = await this.claimImages(tx, actor, entry.itemId, entry.id, entry.body);
    if (text !== entry.body) await tx.update(entries).set({ body: text }).where(eq(entries.id, entry.id));
    return text;
  }

  /** Bilder in der Beschreibung eines neuen Vorgangs übernehmen. */
  private async claimDescriptionImages(tx: Tx, actor: User, item: Item): Promise<void> {
    const text = await this.claimImages(tx, actor, item.id, null, item.description);
    if (text !== item.description) {
      await tx.update(items).set({ description: text }).where(eq(items.id, item.id));
      item.description = text;
    }
  }

  /**
   * Bilder im Text gehören zu dem Eintrag bzw. der Beschreibung, in deren Text sie stehen. Frisch hochgeladene
   * («upload:») werden zu eingebetteten Anhängen («attachment:»). Aus einem anderen Eintrag oder Vorgang kopierte Bilder
   * werden übernommen (dieselbe Datei), damit Mail und Portal sie zeigen. Fremde, abgelaufene oder für die Person nicht
   * sichtbare Bilder fallen weg, nur ihr Name bleibt stehen.
   */
  async claimImages(tx: Tx, actor: User, itemId: string, entryId: string | null, markdown: string): Promise<string> {
    const refs = imageRefs(markdown);
    if (refs.length === 0) return markdown;
    const ids = (kind: 'upload' | 'attachment') => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
    // Bilder, die neu zu diesem Text gehören, je Referenz «upload:<id>» bzw. «attachment:<id>»
    const sources = new Map<string, { filename: string; contentType: string; size: number; storageKey: string }>();
    const kept = new Set<string>();

    const uploadIds = ids('upload');
    if (uploadIds.length > 0) {
      const rows = await tx
        .select()
        .from(uploads)
        .where(and(inArray(uploads.id, uploadIds), eq(uploads.userId, actor.id)));
      for (const upload of rows) sources.set(`upload:${upload.id}`, upload);
      if (rows.length > 0) await tx.delete(uploads).where(inArray(uploads.id, rows.map((r) => r.id)));
    }

    const attachmentIds = ids('attachment');
    if (attachmentIds.length > 0) {
      const rows = await tx
        .select({ att: attachments, item: items, entryKind: entries.kind, entryMeta: entries.meta })
        .from(attachments)
        .innerJoin(items, eq(items.id, attachments.itemId))
        .leftJoin(entries, eq(entries.id, attachments.entryId))
        .where(inArray(attachments.id, attachmentIds));
      for (const { att, item, entryKind, entryMeta } of rows) {
        if (att.itemId === itemId && att.entryId === entryId) kept.add(att.id);
        else if (TEXT_IMAGE_TYPES.has(att.contentType) && this.canSeeAttachment(actor, item, att, entryKind, entryMeta)) {
          sources.set(`attachment:${att.id}`, att);
        }
      }
    }

    const claimed = new Map<string, string>();
    for (const [ref, file] of sources) {
      const [attachment] = await tx
        .insert(attachments)
        .values({
          itemId,
          entryId,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          storageKey: file.storageKey,
          // Content-ID für das Einbetten in Mails; markiert den Anhang zugleich als Bild im Text
          contentId: `${randomUUID()}@patchwork`,
        })
        .returning();
      claimed.set(ref, attachment!.id);
    }
    return replaceImages(markdown, (ref) => {
      if (ref.kind === 'attachment' && kept.has(ref.id)) return null;
      const id = claimed.get(`${ref.kind}:${ref.id}`);
      return id ? `![${ref.alt}](attachment:${id})` : ref.alt;
    });
  }

  /** IT sieht alle Anhänge, ein Melder nur die öffentlichen seiner eigenen Vorgänge (wie im Portal). */
  private canSeeAttachment(
    actor: User,
    item: Item,
    att: Attachment,
    entryKind: Entry['kind'] | null,
    entryMeta: Entry['meta'] | null,
  ): boolean {
    if (actor.role === 'admin' || actor.role === 'it') return true;
    return item.reporterId === actor.id && !item.discarded && visibleInPortal(att.entryId, entryKind, entryMeta);
  }

  async saveFiles(tx: Tx, itemId: string, entryId: string | null, files: UploadedFile[]) {
    const saved = [];
    for (const file of files) {
      const storageKey = await this.storage.save(file.buffer);
      const [row] = await tx
        .insert(attachments)
        .values({
          itemId,
          entryId,
          filename: decodeFilename(file.originalname).slice(0, 255) || 'datei',
          contentType: file.mimetype || 'application/octet-stream',
          size: file.size,
          storageKey,
        })
        .returning();
      saved.push(row!);
    }
    return saved;
  }

  /** Sperrt den Vorgang für die Dauer der Transaktion. */
  private async lock(tx: Tx, number: number): Promise<Item> {
    const [item] = await tx.select().from(items).where(eq(items.number, number)).for('update').limit(1);
    if (!item) throw new NotFoundException('Vorgang nicht gefunden');
    return item;
  }

  private async assertStaff(userId: string, tx: Tx): Promise<User> {
    const user = await this.users.getById(userId, tx);
    if (!user.active || (user.role !== 'admin' && user.role !== 'it')) {
      throw new BadRequestException('Zuständig können nur aktive IT-Benutzer sein');
    }
    return user;
  }

  /** Position am Ende einer Board-Spalte (auch für Regeln). */
  async endOfColumn(tx: Tx, statusId: string): Promise<number> {
    const [row] = await tx
      .select({ max: max(items.boardPosition) })
      .from(items)
      .where(eq(items.statusId, statusId));
    return (row?.max ?? 0) + 1;
  }

  /** Position zwischen zwei Karten. Bei zu kleinem Abstand wird die Spalte neu durchnummeriert. */
  private async positionBetween(
    tx: Tx,
    statusId: string,
    itemId: string,
    beforeId: string | null,
    afterId: string | null,
    renumbered = false,
  ): Promise<number> {
    const neighbours = await tx
      .select({ id: items.id, pos: items.boardPosition })
      .from(items)
      .where(inArray(items.id, [beforeId, afterId].filter((x): x is string => !!x)));
    const before = neighbours.find((n) => n.id === beforeId)?.pos;
    const after = neighbours.find((n) => n.id === afterId)?.pos;

    if (before !== undefined && after !== undefined) {
      if (after - before > 1e-6) return (before + after) / 2;
      if (renumbered) return before + 1e-7;
      await this.renumber(tx, statusId, itemId);
      return this.positionBetween(tx, statusId, itemId, beforeId, afterId, true);
    }
    if (before !== undefined) return before + 1;
    if (after !== undefined) return after - 1;
    return this.endOfColumn(tx, statusId);
  }

  private async renumber(tx: Tx, statusId: string, exceptId: string) {
    const column = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.statusId, statusId), ne(items.id, exceptId)))
      .orderBy(asc(items.boardPosition), asc(items.createdAt));
    for (const [index, row] of column.entries()) {
      await tx.update(items).set({ boardPosition: index + 1 }).where(eq(items.id, row.id));
    }
  }

  private async flush(pending: Pending) {
    for (const job of pending) await job();
  }

  private toSummary(r: {
    id: string;
    number: number;
    type: ItemType | null;
    title: string;
    priority: Priority;
    source: Item['source'];
    channelId: string | null;
    discarded: boolean;
    boardPosition: number;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
    status: { id: string | null; label: string | null; closed: boolean | null; color: string | null } | null;
    reporter: { id: string; name: string; firstName: string; lastName: string; email: string; role: User['role'] };
    assigneeId: string | null;
    assigneeName: string | null;
    assigneeFirstName: string | null;
    assigneeLastName: string | null;
    suggestedType: ItemType | null;
    checklistTotal: number;
    checklistDone: number;
  }) {
    return {
      id: r.id,
      number: r.number,
      type: r.type,
      title: r.title,
      priority: r.priority,
      source: r.source,
      channelId: r.channelId,
      discarded: r.discarded,
      boardPosition: r.boardPosition,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      status: r.status?.id ? r.status : null,
      reporter: r.reporter,
      assignee: r.assigneeId
        ? {
            id: r.assigneeId,
            name: r.assigneeName ?? '',
            firstName: r.assigneeFirstName ?? '',
            lastName: r.assigneeLastName ?? '',
          }
        : null,
      suggestedType: r.suggestedType,
      // Checklisten gibt es nur bei Aufgaben
      checklist: r.type === 'task' && r.checklistTotal > 0 ? { done: r.checklistDone, total: r.checklistTotal } : null,
    };
  }
}
