import { and, desc, asc, eq, gte, ilike, isNull, not, or, sql, type SQL } from 'drizzle-orm';
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

export const VIEWS = [
  'inbox',
  'incidents',
  'incidents-closed',
  'board',
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
  reporter: { id: reporterUser.id, name: reporterUser.name, email: reporterUser.email, role: reporterUser.role },
  assigneeId: items.assigneeId,
  assigneeName: assigneeUser.name,
  suggestedType: items.suggestedType,
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

  const numberMatch = q.match(/^(?:pw-?)?(\d{1,9})$/i);
  if (numberMatch) conditions.push(eq(items.number, Number(numberMatch[1])));

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
        where: and(
          eq(items.type, 'task'),
          not(inTarget('reject')),
          or(
            OPEN,
            and(CLOSED, gte(items.closedAt, sql`now() - ${sql.raw(`interval '${BOARD_CLOSED_DAYS} days'`)}`)),
          ),
        ),
        orderBy: [asc(items.boardPosition), asc(items.createdAt)],
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
