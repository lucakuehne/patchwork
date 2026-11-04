import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { attachments, entries, items, participants, statuses, users, type Attachment, type User } from '../db/schema';
import { duplicateRedirect } from '../items/duplicates';
import { byKey, HELPSPOT_PREFIX, type ItemKey } from '../items/item-ref';
import { StatusesService } from '../statuses/statuses.service';
import { portalStatus } from './portal-status';
import { viewableInPortal, visibleInPortal } from './portal-visibility';

/** Interne Anhang-Adressen in HTML aus Mails auf die Portal-Adressen umschreiben. */
function portalHtml(html: string | null): string | null {
  return html ? html.replace(/\/api\/attachments\//g, '/api/portal/attachments/') : null;
}

/** Spalten der Listen im Portal */
const summaryColumns = {
  prefix: items.prefix,
  number: items.number,
  title: items.title,
  status: { id: statuses.id, type: statuses.type, label: statuses.label, color: statuses.color, closed: statuses.closed },
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
  closedAt: items.closedAt,
};

const toAttachment = (a: Attachment) => ({
  id: a.id,
  filename: a.filename,
  contentType: a.contentType,
  size: a.size,
  inline: !!a.contentId,
});

/** Zugriff des Melders auf seine eigenen Vorgänge und der Beteiligten auf die, an denen sie beteiligt sind. */
@Injectable()
export class PortalService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statuses: StatusesService,
  ) {}

  /**
   * Eigene Meldungen. Offen = im Eingang (ohne Status) oder in einem offenen Status; abgeschlossen = in einem
   * abgeschlossenen Status.
   */
  async list(user: User, state: 'open' | 'closed') {
    const condition = state === 'open' ? or(isNull(items.statusId), eq(statuses.closed, false)) : eq(statuses.closed, true);
    const [rows, targets] = await Promise.all([
      this.db
        .select(summaryColumns)
        .from(items)
        .leftJoin(statuses, eq(statuses.id, items.statusId))
        .where(and(eq(items.reporterId, user.id), eq(items.discarded, false), ne(items.prefix, HELPSPOT_PREFIX), condition))
        .orderBy(state === 'open' ? desc(items.updatedAt) : desc(items.closedAt))
        .limit(200),
      this.statuses.targets(),
    ]);
    return rows.map(({ status, ...r }) => ({ ...r, status: portalStatus(status, targets) }));
  }

  /** Meldungen anderer, an denen man beteiligt ist (Entscheid vom 04.11.2026): offene zuerst, dann abgeschlossene. */
  async participating(user: User) {
    const [rows, targets] = await Promise.all([
      this.db
        .select({ ...summaryColumns, reporter: users.name })
        .from(items)
        .innerJoin(participants, and(eq(participants.itemId, items.id), eq(participants.userId, user.id)))
        .leftJoin(statuses, eq(statuses.id, items.statusId))
        .leftJoin(users, eq(users.id, items.reporterId))
        .where(and(sql`${items.reporterId} is distinct from ${user.id}`, eq(items.discarded, false), ne(items.prefix, HELPSPOT_PREFIX)))
        .orderBy(sql`coalesce(${statuses.closed}, false)`, desc(items.updatedAt))
        .limit(200),
      this.statuses.targets(),
    ]);
    return rows.map(({ status, ...r }) => ({ ...r, status: portalStatus(status, targets) }));
  }

  /** Sieht die Person den Vorgang im Portal (als Melder oder Beteiligter)? */
  async canView(user: User, itemId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), viewableInPortal(user.id)))
      .limit(1);
    return !!row;
  }

  async detail(user: User, key: ItemKey) {
    const [row] = await this.db
      .select({ item: items, status: statuses })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .where(and(byKey(key), viewableInPortal(user.id)))
      .limit(1);
    if (!row) throw new NotFoundException('Meldung nicht gefunden');
    const item = row.item;
    const [reporter] = item.reporterId
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, item.reporterId)).limit(1)
      : [];
    const people = await this.db
      .select({ id: users.id, name: users.name })
      .from(participants)
      .innerJoin(users, eq(users.id, participants.userId))
      .where(eq(participants.itemId, item.id))
      .orderBy(asc(users.name));

    // Sichtbar: öffentliche Antworten und eine Ablehnung, bei der der Melder informiert wurde
    const entryRows = await this.db
      .select({ entry: entries, author: users })
      .from(entries)
      .leftJoin(users, eq(users.id, entries.authorId))
      .where(and(eq(entries.itemId, item.id), inArray(entries.kind, ['reply', 'status'])))
      .orderBy(asc(entries.createdAt));
    // Automatische Mails (Abwesenheitsnotizen u.ä.) sind keine echten Nachrichten und bleiben im Portal unsichtbar
    const visible = entryRows.filter(
      ({ entry }) =>
        (entry.kind === 'reply' && !entry.meta?.automated) ||
        (entry.kind === 'status' && entry.meta?.rejected && entry.meta?.notified),
    );
    const files = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.itemId, item.id))
      .orderBy(asc(attachments.createdAt));
    // Umgeleitetes Duplikat (abgeschlossen): Hinweis auf das Original statt des Antwortfelds (öffnen kann man es nur,
    // wenn man auch dort Melder oder Beteiligter ist)
    const [original, targets] = await Promise.all([duplicateRedirect(this.db, item), this.statuses.targets()]);

    return {
      prefix: item.prefix,
      number: item.number,
      title: item.title,
      duplicateOf: original
        ? { prefix: original.prefix, number: original.number, title: original.title, accessible: await this.canView(user, original.id) }
        : null,
      /** Beteiligt statt Melder: «Meldung von …» statt «Deine Meldung» */
      participating: item.reporterId !== user.id,
      reporter: reporter?.name ?? null,
      /** Wer beteiligt ist, sehen Melder und Beteiligte (Entscheid vom 04.11.2026) */
      participants: people.map((p) => ({ name: p.name, own: p.id === user.id })),
      description: item.description,
      descriptionHtml: portalHtml(item.descriptionHtml),
      /** Im Testbetrieb aus einer simulierten Mail entstanden */
      simulated: item.simulated,
      createdAt: item.createdAt,
      closedAt: item.closedAt,
      status: portalStatus(row.status, targets),
      attachments: files.filter((a) => !a.entryId).map(toAttachment),
      entries: visible.map(({ entry, author }) => ({
        id: entry.id,
        kind: entry.kind === 'reply' ? ('reply' as const) : ('rejected' as const),
        // Eigene Nachrichten als «Du», Antworten mit dem Namen des Bearbeiters (Entscheid vom 04.11.2026); null bei einer
        // Ablehnung (ohne Namen) und ohne Person, das Portal zeigt dann «IT»
        author: author?.id === user.id ? 'Du' : entry.kind === 'reply' && author ? author.name : null,
        own: author?.id === user.id,
        simulated: !!entry.meta?.simulated,
        body: entry.body,
        bodyHtml: portalHtml(entry.bodyHtml),
        createdAt: entry.createdAt,
        attachments: files.filter((a) => a.entryId === entry.id).map(toAttachment),
      })),
    };
  }

  /**
   * Anhang, sofern er zu einem Vorgang gehört, den die Person im Portal sieht, und öffentlich ist: Meldung, öffentliche
   * Antwort oder Begründung einer Ablehnung, über die der Melder informiert wurde (Bilder im Text).
   */
  async attachment(user: User, attachmentId: string): Promise<Attachment> {
    const [row] = await this.db
      .select({ att: attachments, entryKind: entries.kind, entryMeta: entries.meta })
      .from(attachments)
      .innerJoin(items, eq(items.id, attachments.itemId))
      .leftJoin(entries, eq(entries.id, attachments.entryId))
      .where(and(eq(attachments.id, attachmentId), viewableInPortal(user.id)))
      .limit(1);
    if (!row || !visibleInPortal(row.att.entryId, row.entryKind, row.entryMeta)) throw new NotFoundException('Anhang nicht gefunden');
    return row.att;
  }
}
