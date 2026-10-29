import { and, desc, asc, eq, gte, ilike, isNull, not, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  checklistItems,
  checklists,
  entries,
  items,
  statuses,
  statusTargets,
  users,
  type StatusTargetKind,
} from '../db/schema';
import { byKey, parseItemRef } from './item-ref';

export const VIEWS = [
  'inbox',
  'incidents',
  'incidents-closed',
  'incidents-board',
  'board',
  'tasks',
  'tasks-done',
  'tasks-rejected',
  'search',
] as const;
export type View = (typeof VIEWS)[number];

export const reporterUser = alias(users, 'reporter');
export const assigneeUser = alias(users, 'assignee');

/** Spalten für Listenansichten. */
export const summaryColumns = {
  id: items.id,
  prefix: items.prefix,
  number: items.number,
  type: items.type,
  title: items.title,
  priority: items.priority,
  source: items.source,
  channelId: items.channelId,
  discarded: items.discarded,
  boardPosition: items.boardPosition,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
  closedAt: items.closedAt,
  status: { id: statuses.id, label: statuses.label, closed: statuses.closed, color: statuses.color },
  reporter: {
    id: reporterUser.id,
    name: reporterUser.name,
    firstName: reporterUser.firstName,
    lastName: reporterUser.lastName,
    email: reporterUser.email,
    role: reporterUser.role,
  },
  assigneeId: items.assigneeId,
  assigneeName: assigneeUser.name,
  assigneeFirstName: assigneeUser.firstName,
  assigneeLastName: assigneeUser.lastName,
  suggestedType: items.suggestedType,
  dueDate: items.dueDate,
  /** Anfang der Beschreibung für die Vorschau auf der Board-Karte */
  descriptionPreview: sql<string>`left(${items.description}, 400)`,
  /** Kommentare: öffentliche Antworten und interne Notizen, ohne automatische (z.B. Abwesenheitsnotizen) */
  commentCount: sql<number>`(select count(*)::int from ${entries} e where e.item_id = ${items.id} and e.kind in ('reply', 'note') and coalesce((e.meta->>'automated')::boolean, false) = false)`,
  checklistTotal: sql<number>`(select count(*)::int from ${checklistItems} ci join ${checklists} c on c.id = ci.checklist_id where c.item_id = ${items.id})`,
  checklistDone: sql<number>`(select count(*)::int from ${checklistItems} ci join ${checklists} c on c.id = ci.checklist_id where c.item_id = ${items.id} and ci.done)`,
};

/** Abgeschlossene Spalten des Boards zeigen nur so viele Tage zurück. */
const BOARD_CLOSED_DAYS = 14;

/** Status offen bzw. abgeschlossen (die Ansichten verbinden statuses mit dem Status des Vorgangs). */
const OPEN = eq(statuses.closed, false);
const CLOSED = eq(statuses.closed, true);

/** Steht der Vorgang im Ziel-Status «target» seines Typs, z.B. im Ablehnen-Status? */
function inTarget(target: StatusTargetKind): SQL {
  const matches = and(
    eq(statusTargets.type, items.type),
    eq(statusTargets.target, target),
    eq(statusTargets.statusId, items.statusId),
  );
  return sql`exists (select 1 from ${statusTargets} where ${matches})`;
}

/** Volltext-Bedingung: Nummer, Titel/Beschreibung oder Timeline. */
export function searchCondition(query: string): SQL | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const conditions: SQL[] = [];

  // «PW-123» bzw. «HS-17223» genau diesen Vorgang, eine Zahl allein jeden Präfix
  if (/^\d{1,9}$/.test(q)) conditions.push(eq(items.number, Number(q)));
  else {
    const key = parseItemRef(q);
    if (key) conditions.push(byKey(key));
  }

  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 10);
  if (tokens.length > 0) {
    const tsQuery = tokens.map((t) => `${t}:*`).join(' & ');
    conditions.push(sql`${items.search} @@ to_tsquery('german', ${tsQuery})`);
    conditions.push(
      sql`exists (select 1 from ${entries} where ${entries.itemId} = ${items.id} and ${entries.search} @@ to_tsquery('german', ${tsQuery}))`,
    );
  }
  conditions.push(ilike(items.title, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  return or(...conditions);
}

/** Filter und Sortierung je Ansicht. */
/** Board eines Typs: alle Status ausser dem Ablehnen-Status, abgeschlossene nur mit den Vorgängen der letzten Tage */
function boardCondition(type: 'incident' | 'task'): SQL | undefined {
  return and(
    eq(items.type, type),
    not(inTarget('reject')),
    or(OPEN, and(CLOSED, gte(items.closedAt, sql`now() - ${sql.raw(`interval '${BOARD_CLOSED_DAYS} days'`)}`))),
  );
}

export function viewQuery(view: View): { where: SQL | undefined; orderBy: SQL[] } {
  switch (view) {
    case 'inbox':
      return {
        where: and(isNull(items.type), eq(items.discarded, false)),
        orderBy: [desc(items.createdAt)],
      };
    case 'incidents':
      return {
        where: and(eq(items.type, 'incident'), OPEN),
        // Enum-Reihenfolge: high, normal, low
        orderBy: [asc(items.priority), asc(items.createdAt)],
      };
    case 'incidents-closed':
      return {
        where: and(eq(items.type, 'incident'), CLOSED),
        orderBy: [desc(items.closedAt)],
      };
    case 'board':
      // Spalten sind die Status ausser dem Ablehnen-Status; abgeschlossene nur mit den letzten Tagen
      return {
        where: boardCondition('task'),
        orderBy: [asc(items.boardPosition), asc(items.createdAt)],
      };
    case 'incidents-board':
      // Wie das Board der Aufgaben, Karten aber «dringend zuerst» wie die Liste (keine Reihenfolge von Hand)
      return {
        where: boardCondition('incident'),
        orderBy: [asc(items.priority), asc(items.createdAt)],
      };
    case 'tasks':
      // Offene Aufgaben als Liste: in der Reihenfolge der Spalten, innerhalb eines Status wie auf dem Board
      return {
        where: and(eq(items.type, 'task'), OPEN),
        orderBy: [asc(statuses.position), asc(items.boardPosition), asc(items.createdAt)],
      };
    case 'tasks-done':
      return {
        where: and(eq(items.type, 'task'), CLOSED, not(inTarget('reject'))),
        orderBy: [desc(items.closedAt)],
      };
    case 'tasks-rejected':
      return {
        where: and(eq(items.type, 'task'), inTarget('reject')),
        orderBy: [desc(items.closedAt)],
      };
    case 'search':
      return { where: undefined, orderBy: [desc(items.updatedAt)] };
  }
}

/** Filter der Listen (Entscheid vom 26.10.2026): Priorität, Zuständig, Status, Meldeweg; «none» = ohne Angabe */
export interface ListFilters {
  priority?: 'high' | 'normal' | 'low';
  assignee?: string;
  status?: string;
  channel?: string;
}

export function filterCondition(filters: ListFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.priority) parts.push(eq(items.priority, filters.priority));
  if (filters.assignee) parts.push(filters.assignee === 'none' ? isNull(items.assigneeId) : eq(items.assigneeId, filters.assignee));
  if (filters.status) parts.push(eq(items.statusId, filters.status));
  if (filters.channel) parts.push(filters.channel === 'none' ? isNull(items.channelId) : eq(items.channelId, filters.channel));
  return parts.length ? and(...parts) : undefined;
}

/** Sortierbare Spalten der Listen; ohne Angabe gilt die Reihenfolge der Ansicht */
export const SORT_FIELDS = ['number', 'title', 'status', 'priority', 'channel', 'reporter', 'assignee', 'created', 'closed'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

/** Reihenfolge für eine Spalte; Leere (z.B. ohne Zuständigen) zuletzt, bei Gleichstand die neueren Vorgänge zuerst */
export function sortOrder(field: SortField, dir: 'asc' | 'desc'): SQL[] {
  const by = (column: SQL | AnyColumn) => sql`${column} ${sql.raw(dir)} nulls last`;
  const key: Record<SortField, SQL> = {
    // Nach Präfix, dann Nummer (PW-… und HS-… getrennt)
    number: sql`${items.prefix} ${sql.raw(dir)}, ${items.number} ${sql.raw(dir)}`,
    title: by(sql`lower(${items.title})`),
    status: by(statuses.position),
    // Reihenfolge der Aufzählung: hoch, normal, niedrig
    priority: by(sql`${items.priority}`),
    channel: by(sql`(select lower(label) from channels c where c.id = ${items.channelId})`),
    reporter: by(sql`lower(${reporterUser.name})`),
    assignee: by(sql`lower(${assigneeUser.name})`),
    created: by(items.createdAt),
    closed: by(items.closedAt),
  };
  return [key[field], desc(items.number)];
}

/** Boards: Reihenfolge der Ansicht (von Hand bzw. «dringend zuerst»), keine Sortierung per Spaltenkopf */
export const BOARD_VIEWS: readonly View[] = ['board', 'incidents-board'];
/** Ganz geladen (Board, offene Listen, Eingang); abgeschlossene Listen und Suche seitenweise */
export const UNPAGED_VIEWS: readonly View[] = ['inbox', 'incidents', 'incidents-board', 'board', 'tasks'];
