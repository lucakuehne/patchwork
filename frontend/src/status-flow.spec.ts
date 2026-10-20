import { describe, expect, it } from 'vitest';
import { diagramPosition, edgePath, isCompleting, rejectAllowed, suggestTypeChangeStatus, transitionAllowed } from './status-flow';
import type { Status, StatusTargetsByType } from './types';

const status = (id: string, closed: boolean, position: number, x: number | null = null, y: number | null = null): Status => ({
  id,
  type: 'task',
  key: id,
  label: id,
  closed,
  position,
  color: 'gray',
  diagramX: x,
  diagramY: y,
});

const targets: StatusTargetsByType = {
  incident: { start: 'neu', reply: 'arbeit', close: 'geloest', waiting: 'wartet' },
  task: { start: 'backlog', reply: 'doing', close: 'done', reject: 'rejected' },
};

describe('transitionAllowed', () => {
  it('erlaubt ohne Einschränkung alles, mit Einschränkung nur festgelegte Wechsel', () => {
    const transitions = [{ fromId: 'a', toId: 'b' }];
    expect(transitionAllowed(false, transitions, 'b', 'a')).toBe(true);
    expect(transitionAllowed(true, transitions, 'a', 'b')).toBe(true);
    expect(transitionAllowed(true, transitions, 'b', 'a')).toBe(false);
    expect(transitionAllowed(true, transitions, 'b', 'b')).toBe(true);
  });
});

describe('rejectAllowed', () => {
  it('braucht ein Ablehnen-Ziel und bei Einschränkung einen Pfeil dorthin', () => {
    expect(rejectAllowed(false, [], undefined, 'neu')).toBe(false);
    expect(rejectAllowed(false, [], 'rejected', 'done')).toBe(true);
    expect(rejectAllowed(false, [], 'rejected', 'rejected')).toBe(false);
    expect(rejectAllowed(true, [], 'rejected', 'backlog')).toBe(false);
    expect(rejectAllowed(true, [{ fromId: 'backlog', toId: 'rejected' }], 'rejected', 'backlog')).toBe(true);
  });
});

describe('isCompleting', () => {
  it('in Abgeschlossenes ausser Ablehnen, aus Offenem oder aus Ablehnen', () => {
    const t = targets.task;
    expect(isCompleting(t, { id: 'doing', closed: false }, { id: 'done', closed: true })).toBe(true);
    expect(isCompleting(t, { id: 'rejected', closed: true }, { id: 'done', closed: true })).toBe(true);
    expect(isCompleting(t, { id: 'doing', closed: false }, { id: 'rejected', closed: true })).toBe(false);
    expect(isCompleting(t, { id: 'done', closed: true }, { id: 'archiv', closed: true })).toBe(false);
  });
});

describe('suggestTypeChangeStatus', () => {
  it('ordnet nach Rolle zu', () => {
    const s = (id: string, type: 'incident' | 'task', closed = false) => ({ id, type, closed });
    expect(suggestTypeChangeStatus(targets, s('neu', 'incident'), 'task')).toBe('backlog');
    expect(suggestTypeChangeStatus(targets, s('wartet', 'incident'), 'task')).toBe('doing');
    expect(suggestTypeChangeStatus(targets, s('geplant', 'task'), 'incident')).toBe('arbeit');
    expect(suggestTypeChangeStatus(targets, s('rejected', 'task', true), 'incident')).toBe('geloest');
    expect(suggestTypeChangeStatus(targets, null, 'incident')).toBe('neu');
  });
});

describe('diagramPosition', () => {
  it('nimmt die gespeicherte Lage', () => {
    const s = status('a', false, 0, 40, 80);
    expect(diagramPosition(s, [s], targets.task)).toEqual({ x: 40, y: 80 });
  });

  it('ordnet sonst ein: Start links, offene in der Mitte, abgeschlossene rechts, unter den vorhandenen', () => {
    const backlog = status('backlog', false, 0);
    const doing = status('doing', false, 1, 220, 0);
    const testing = status('testing', false, 2);
    const review = status('review', false, 3);
    const done = status('done', true, 4, 440, 0);
    const archive = status('archive', true, 5);
    const all = [backlog, doing, testing, review, done, archive];
    expect(diagramPosition(backlog, all, targets.task)).toEqual({ x: 0, y: 0 });
    expect(diagramPosition(testing, all, targets.task)).toEqual({ x: 220, y: 90 });
    expect(diagramPosition(review, all, targets.task)).toEqual({ x: 220, y: 180 });
    expect(diagramPosition(archive, all, targets.task)).toEqual({ x: 440, y: 90 });
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
