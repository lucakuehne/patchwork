import { describe, expect, it } from 'vitest';
import { csvCell, sortAssignees } from './reports.service';

describe('sortAssignees', () => {
  it('ordnet Personen nach ihrer Summe über alle Typen, «niemand» bei Gleichstand zuerst, Typen beieinander', () => {
    const rows = [
      { id: 'b', name: 'Bea', type: 'task', count: 1 },
      { id: null, name: null, type: 'incident', count: 3 },
      { id: 'a', name: 'Ivan', type: 'incident', count: 2 },
      { id: 'a', name: 'Ivan', type: 'task', count: 2 },
      { id: 'b', name: 'Bea', type: 'incident', count: 3 },
    ];
    expect(sortAssignees(rows).map((r) => `${r.name ?? 'niemand'}:${r.type}`)).toEqual([
      'Bea:incident',
      'Bea:task',
      'Ivan:incident',
      'Ivan:task',
      'niemand:incident',
    ]);
    const tie = [
      { id: 'a', name: 'Ada', type: null, count: 2 },
      { id: null, name: null, type: null, count: 2 },
    ];
    expect(sortAssignees(tie).map((r) => r.name)).toEqual([null, 'Ada']);
  });
});

describe('csvCell', () => {
  it('setzt Anführungszeichen bei Trennzeichen und entschärft Formeln', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('Text')).toBe('Text');
  });
});
