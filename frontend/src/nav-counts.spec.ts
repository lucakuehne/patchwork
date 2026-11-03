import { describe, expect, it } from 'vitest';
import { countSegments, segmentsText } from './nav-counts';
import type { Status, StatusTargetsByType } from './types';

const status = (id: string, type: Status['type'], position: number, closed = false): Status => ({
  id,
  type,
  key: id,
  label: id,
  closed,
  position,
  color: 'gray',
  diagramX: null,
  diagramY: null,
});

const statuses = [
  status('Wartet', 'incident', 2),
  status('Neu', 'incident', 0),
  status('In Arbeit', 'incident', 1),
  status('Gelöst', 'incident', 3, true),
  status('Backlog', 'task', 0),
  status('Geplant', 'task', 1),
  status('Erledigt', 'task', 2, true),
];
const targets: StatusTargetsByType = { incident: { start: 'Neu' }, task: { start: 'Backlog' } };

describe('Zähler je Status im Menü', () => {
  it('offene Status in der Reihenfolge des Boards, ohne Vorgänge mit 0', () => {
    const segments = countSegments('incident', statuses, targets, { Neu: 2, 'In Arbeit': 7, Gelöst: 50 });
    expect(segments.map((s) => [s.label, s.count])).toEqual([
      ['Neu', 2],
      ['In Arbeit', 7],
      ['Wartet', 0],
    ]);
    expect(segmentsText(segments)).toBe('Neu 2, In Arbeit 7, Wartet 0');
  });

  it('Aufgaben ohne den Start-Status (Backlog)', () => {
    const segments = countSegments('task', statuses, targets, { Backlog: 14, Geplant: 5 });
    expect(segments.map((s) => [s.label, s.count])).toEqual([['Geplant', 5]]);
  });
});
