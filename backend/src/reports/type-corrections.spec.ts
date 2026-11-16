import { describe, expect, it } from 'vitest';
import { typeCorrections, typeFromRuleChanges, type TypeEvent } from './type-corrections';

const LABELS = { incident: 'Störung', task: 'Aufgabe' } as const;
const at = (day: number, hour = 8) => new Date(Date.UTC(2026, 10, day, hour));
const items = new Map([
  ['a', { prefix: 'PW', number: 1, title: 'Drucker' }],
  ['b', { prefix: 'PW', number: 2, title: 'Zugang' }],
  ['c', { prefix: 'PW', number: 3, title: 'Monitor' }],
]);
const period = { from: at(10, 0), to: at(17, 0) };

describe('Typ korrigiert', () => {
  it('zählt Zuweisungen im Zeitraum und ihre spätere Korrektur je Person', () => {
    const events: TypeEvent[] = [
      // Ivan weist zu, Ada korrigiert zwei Stunden später
      { itemId: 'a', at: at(11), by: 'Ivan IT', to: 'incident', from: null },
      { itemId: 'a', at: at(11, 10), by: 'Ada Admin', to: 'task', from: 'incident' },
      // Regel weist zu, bleibt
      { itemId: 'b', at: at(12), by: 'Regel «Zugang»', to: 'task', from: null },
      // Ivan weist zu, Korrektur erst nach dem Zeitraum
      { itemId: 'c', at: at(16), by: 'Ivan IT', to: 'task', from: null },
      { itemId: 'c', at: at(20), by: 'Ada Admin', to: 'incident', from: 'task' },
    ];
    const r = typeCorrections(events, items, period);
    expect([r.assigned, r.corrected]).toEqual([4, 2]);
    expect(r.byPerson).toEqual([
      { name: 'Ivan IT', assigned: 2, corrected: 2 },
      { name: 'Ada Admin', assigned: 1, corrected: 0 },
      { name: 'Regel «Zugang»', assigned: 1, corrected: 0 },
    ]);
    expect(r.cases.map((c) => [c.number, c.from, c.to, c.assignedBy, c.correctedBy])).toEqual([
      [3, 'task', 'incident', 'Ivan IT', 'Ada Admin'],
      [1, 'incident', 'task', 'Ivan IT', 'Ada Admin'],
    ]);
    expect(r.casesTotal).toBe(2);
  });

  it('Zuweisungen vor dem Zeitraum zählen nicht, ihre Korrektur ist aber selbst eine Zuweisung', () => {
    const r = typeCorrections(
      [
        { itemId: 'a', at: at(5), by: 'Ivan IT', to: 'incident', from: null },
        { itemId: 'a', at: at(11), by: 'Ada Admin', to: 'task', from: 'incident' },
      ],
      items,
      period,
    );
    expect([r.assigned, r.corrected]).toEqual([1, 0]);
    expect(r.byPerson).toEqual([{ name: 'Ada Admin', assigned: 1, corrected: 0 }]);
  });

  it('liest den Typ aus dem Eintrag einer Regel', () => {
    expect(typeFromRuleChanges(['den Typ «Aufgabe» gesetzt (Status «Backlog»)', 'die Priorität «Hoch» gesetzt'], LABELS)).toBe('task');
    expect(typeFromRuleChanges(['die Priorität «Hoch» gesetzt'], LABELS)).toBeNull();
    expect(typeFromRuleChanges(undefined, LABELS)).toBeNull();
  });
});
