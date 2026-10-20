import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import {
  attachments,
  entries,
  items,
  statuses,
  users,
  type Attachment,
  type ItemType,
  type StatusCategory,
  type User,
} from '../db/schema';
import { duplicateRedirect } from '../items/duplicates';
import { visibleInPortal } from './portal-visibility';

const OPEN: StatusCategory[] = ['new', 'in_progress', 'waiting'];
const CLOSED: StatusCategory[] = ['done', 'rejected'];

/** Status, wie ihn der Melder sieht: vereinfacht nach Kategorie, ohne interne Statusnamen. */
export function portalStatus(type: ItemType | null, category: StatusCategory | null): { key: string; label: string } {
  if (!type || !category) return { key: 'received', label: 'Eingegangen' };
  switch (category) {
    case 'new':
      return { key: 'received', label: 'Eingegangen' };
    case 'in_progress':
      return { key: 'in_progress', label: 'In Bearbeitung' };
    case 'waiting':
      return { key: 'waiting', label: 'Wartet auf Ihre Rückmeldung' };
    case 'done':
      return { key: 'done', label: 'Erledigt' };
    case 'rejected':
      return { key: 'rejected', label: 'Abgelehnt' };
  }
}

/** Interne Anhang-Adressen in HTML aus Mails auf die Portal-Adressen umschreiben. */
function portalHtml(html: string | null): string | null {
  return html ? html.replace(/\/api\/attachments\//g, '/api/portal/attachments/') : null;
}

const toAttachment = (a: Attachment) => ({
  id: a.id,
  filename: a.filename,
  contentType: a.contentType,
  size: a.size,
  inline: !!a.contentId,
});

/** Lesender Zugriff des Melders auf seine eigenen Vorgänge. */
@Injectable()
export class PortalService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(user: User, state: 'open' | 'closed') {
    const condition =
      state === 'open'
        ? or(isNull(items.type), inArray(statuses.category, OPEN))
        : inArray(statuses.category, CLOSED);
    const rows = await this.db
      .select({
        number: items.number,
        title: items.title,
        type: items.type,
        category: statuses.category,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
        closedAt: items.closedAt,
      })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .where(and(eq(items.reporterId, user.id), eq(items.discarded, false), condition))
      .orderBy(state === 'open' ? desc(items.updatedAt) : desc(items.closedAt))
      .limit(200);
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      status: portalStatus(r.type, r.category),
    }));
  }

  async detail(user: User, number: number) {
    const [row] = await this.db
      .select({ item: items, category: statuses.category })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .where(and(eq(items.number, number), eq(items.reporterId, user.id), eq(items.discarded, false)))
      .limit(1);
    if (!row) throw new NotFoundException('Vorgang nicht gefunden');
    const item = row.item;

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
    // Umgeleitetes Duplikat: Hinweis auf das Original (öffnen kann es der Melder nur, wenn er auch dort Melder ist)
    const original = await duplicateRedirect(this.db, item);

    return {
      number: item.number,
      title: item.title,
      duplicateOf: original
        ? { number: original.number, title: original.title, accessible: original.reporterId === user.id }
        : null,
      description: item.description,
      descriptionHtml: portalHtml(item.descriptionHtml),
      /** Im Testbetrieb aus einer simulierten Mail entstanden */
      simulated: item.simulated,
      createdAt: item.createdAt,
      closedAt: item.closedAt,
      status: portalStatus(item.type, row.category),
      attachments: files.filter((a) => !a.entryId).map(toAttachment),
      entries: visible.map(({ entry, author }) => ({
        id: entry.id,
        kind: entry.kind === 'reply' ? ('reply' as const) : ('rejected' as const),
        // Eigene Nachrichten als «Sie», Antworten der IT ohne Namen des Bearbeiters
        author:
          author?.id === user.id ? 'Sie' : author && (author.role === 'admin' || author.role === 'it') ? 'IT' : (author?.name ?? 'IT'),
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
   * Anhang, sofern er zu einem eigenen Vorgang gehört und öffentlich ist: Meldung, öffentliche Antwort oder Begründung
   * einer Ablehnung, über die der Melder informiert wurde (Bilder im Text).
   */
  async attachment(user: User, attachmentId: string): Promise<Attachment> {
    const [row] = await this.db
      .select({ att: attachments, entryKind: entries.kind, entryMeta: entries.meta })
      .from(attachments)
      .innerJoin(items, eq(items.id, attachments.itemId))
      .leftJoin(entries, eq(entries.id, attachments.entryId))
      .where(and(eq(attachments.id, attachmentId), eq(items.reporterId, user.id), eq(items.discarded, false)))
      .limit(1);
    if (!row || !visibleInPortal(row.att.entryId, row.entryKind, row.entryMeta)) throw new NotFoundException('Anhang nicht gefunden');
    return row.att;
  }
}
