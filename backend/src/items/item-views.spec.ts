import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { filterCondition, sortOrder, viewQuery, type View } from './item-views';

const dialect = new PgDialect();
const where = (view: View) => {
  const condition = viewQuery(view).where;
  return condition ? dialect.sqlToQuery(condition) : null;
};

const IN_REJECT =
  /exists \(select 1 from "status_targets" where \("status_targets"\."type" = "items"\."type" and "status_targets"\."target" = \$\d+ and "status_targets"\."status_id" = "items"\."status_id"\)\)/;

describe('viewQuery', () => {
  it('Störungen offen bzw. gelöst nach «abgeschlossen»', () => {
    expect(where('incidents')!.sql).toContain('"statuses"."closed" = $');
    expect(where('incidents')!.params).toEqual(['incident', false]);
    expect(where('incidents-closed')!.params).toEqual(['incident', true]);
  });

  it('Board: ohne Ablehnen-Status, abgeschlossene nur der letzten 14 Tage', () => {
    const board = where('board')!;
    expect(board.sql).toMatch(new RegExp(`not ${IN_REJECT.source}`));
    expect(board.sql).toContain("interval '14 days'");
    expect(board.params).toEqual(['task', 'reject', false, true]);
  });

  it('Aufgaben erledigt ohne, abgelehnt nur mit dem Ablehnen-Status', () => {
    const done = where('tasks-done')!;
    expect(done.sql).toMatch(new RegExp(`not ${IN_REJECT.source}`));
    expect(done.params).toEqual(['task', true, 'reject']);
    const rejected = where('tasks-rejected')!;
    expect(rejected.sql).toMatch(IN_REJECT);
    expect(rejected.sql).not.toContain('not exists');
    expect(rejected.params).toEqual(['task', 'reject']);
  });

  it('Suche ohne Filter nach Status', () => {
    expect(where('search')).toBeNull();
  });
});

describe('Filter und Sortierung der Listen', () => {
  const toSql = (condition: ReturnType<typeof filterCondition>) => (condition ? dialect.sqlToQuery(condition) : null);

  it('ohne Filter keine Bedingung, sonst je Merkmal; «none» = ohne Angabe', () => {
    expect(filterCondition({})).toBeUndefined();
    const all = toSql(filterCondition({ priority: 'high', assignee: 'u1', status: 's1', channel: 'c1' }))!;
    expect(all.params).toEqual(['high', 'u1', 's1', 'c1']);
    const none = toSql(filterCondition({ assignee: 'none', channel: 'none' }))!;
    expect(none.sql).toBe('("items"."assignee_id" is null and "items"."channel_id" is null)');
  });

  it('nach der Spalte, Leere zuletzt, bei Gleichstand die neueren zuerst', () => {
    const order = sortOrder('assignee', 'desc').map((part) => dialect.sqlToQuery(part).sql);
    expect(order).toEqual(['lower("assignee"."name") desc nulls last', '"items"."number" desc']);
    expect(dialect.sqlToQuery(sortOrder('priority', 'asc')[0]!).sql).toBe('"items"."priority" asc nulls last');
  });
});
