import { describe, expect, it } from 'vitest';
import { diagramPosition, edgePath, transitionAllowed } from './status-flow';
import type { Status } from './types';

const status = (id: string, category: Status['category'], position: number, x: number | null = null, y: number | null = null): Status => ({
  id,
  type: 'task',
  key: id,
  label: id,
  category,
  position,
  color: 'gray',
  diagramX: x,
  diagramY: y,
});

describe('transitionAllowed', () => {
  it('erlaubt ohne Einschränkung alles, mit Einschränkung nur festgelegte Wechsel', () => {
    const transitions = [{ fromId: 'a', toId: 'b' }];
    expect(transitionAllowed(false, transitions, 'b', 'a')).toBe(true);
    expect(transitionAllowed(true, transitions, 'a', 'b')).toBe(true);
    expect(transitionAllowed(true, transitions, 'b', 'a')).toBe(false);
    expect(transitionAllowed(true, transitions, 'b', 'b')).toBe(true);
  });
});

describe('diagramPosition', () => {
  it('nimmt die gespeicherte Lage', () => {
    const s = status('a', 'new', 0, 40, 80);
    expect(diagramPosition(s, [s])).toEqual({ x: 40, y: 80 });
  });

  it('ordnet sonst nach Kategorie: Neu links, In Arbeit über Wartend, Erledigt über Abgelehnt', () => {
    const backlog = status('backlog', 'new', 0);
    const planned = status('planned', 'new', 1);
    const doing = status('doing', 'in_progress', 2);
    const testing = status('testing', 'in_progress', 3);
    const waiting = status('waiting', 'waiting', 4);
    const done = status('done', 'done', 5);
    const rejected = status('rejected', 'rejected', 6);
    const all = [planned, doing, backlog, testing, waiting, done, rejected];
    expect(diagramPosition(backlog, all)).toEqual({ x: 0, y: 0 });
    expect(diagramPosition(planned, all)).toEqual({ x: 0, y: 90 });
    expect(diagramPosition(doing, all)).toEqual({ x: 220, y: 0 });
    expect(diagramPosition(testing, all)).toEqual({ x: 220, y: 90 });
    // unter den zwei Status «In Arbeit»
    expect(diagramPosition(waiting, all)).toEqual({ x: 220, y: 225 });
    expect(diagramPosition(done, all)).toEqual({ x: 440, y: 0 });
    expect(diagramPosition(rejected, all)).toEqual({ x: 440, y: 135 });
  });
});

describe('edgePath', () => {
  const left = { x: 0, y: 0, width: 100, height: 40 };
  const right = { x: 200, y: 0, width: 100, height: 40 };

  it('zieht den Pfeil gerade von Rand zu Rand', () => {
    expect(edgePath(left, right, false)).toBe('M 100,20 L 200,20');
    expect(edgePath(left, { x: 0, y: 100, width: 100, height: 40 }, false)).toBe('M 50,40 L 50,100');
  });

  it('biegt Hin- und Rückweg auf verschiedene Seiten', () => {
    expect(edgePath(left, right, true)).toBe('M 100,35 Q 150,50 200,35');
    expect(edgePath(right, left, true)).toBe('M 200,5 Q 150,-10 100,5');
  });

  it('zeichnet nichts, wenn beide Status aufeinander liegen', () => {
    expect(edgePath(left, left, false)).toBe('');
  });
});
