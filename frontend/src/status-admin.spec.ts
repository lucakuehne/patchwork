import { describe, expect, it } from 'vitest';
import { targetOptions, targetsAfterRemoval, targetsOf } from './status-admin';
import type { StatusTargets } from './types';

const s = (id: string, closed = false) => ({ id, closed });
const statuses = [s('new'), s('in-progress'), s('awaiting'), s('resolved', true), s('archive', true), s('rejected', true)];
const targets: StatusTargets = { start: 'new', reply: 'in-progress', close: 'resolved', reject: 'rejected', waiting: 'awaiting' };
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('targetsOf', () => {
  it('liefert alle Ziele eines Status', () => {
    expect(targetsOf({ start: 'a', reply: 'a', close: 'b' }, 'a')).toEqual(['start', 'reply']);
    expect(targetsOf(targets, 'archive')).toEqual([]);
  });
});

describe('targetOptions', () => {
  it('bietet für offene Ziele nur offene Status, ohne den Wartet-Status', () => {
    expect(ids(targetOptions(statuses, targets, 'start'))).toEqual(['new', 'in-progress']);
    expect(ids(targetOptions(statuses, targets, 'reply'))).toEqual(['new', 'in-progress']);
  });

  it('bietet für «Wartet» offene Status ausser Start und «nach Antwort»', () => {
    expect(ids(targetOptions(statuses, targets, 'waiting'))).toEqual(['awaiting']);
    expect(ids(targetOptions(statuses, { start: 'new', reply: 'new' }, 'waiting'))).toEqual(['in-progress', 'awaiting']);
  });

  it('trennt Schliessen und Ablehnen', () => {
    expect(ids(targetOptions(statuses, targets, 'close'))).toEqual(['resolved', 'archive']);
    expect(ids(targetOptions(statuses, targets, 'reject'))).toEqual(['archive', 'rejected']);
    expect(ids(targetOptions(statuses, { ...targets, reject: undefined }, 'close'))).toEqual(['resolved', 'archive', 'rejected']);
  });
});

describe('targetsAfterRemoval', () => {
  it('übernimmt die Wahl für die Ziele des gelöschten Status', () => {
    expect(targetsAfterRemoval({ start: 'a', reply: 'a', close: 'c' }, 'a', { start: 'b', reply: 'd' })).toEqual({
      start: 'b',
      reply: 'd',
      close: 'c',
    });
  });

  it('leert freiwillige Ziele mit «keiner» und lässt nicht gewählte leer', () => {
    expect(targetsAfterRemoval(targets, 'awaiting', { waiting: null })).toEqual({
      start: 'new',
      reply: 'in-progress',
      close: 'resolved',
      reject: 'rejected',
    });
    expect(targetsAfterRemoval(targets, 'resolved', {}).close).toBeUndefined();
  });

  it('ändert nichts, wenn der Status kein Ziel ist', () => {
    expect(targetsAfterRemoval(targets, 'archive', { close: 'archive' })).toEqual(targets);
  });
});
