import { describe, expect, it } from 'vitest';
import { targetOptions, targetsAfterRemoval, targetsOf } from './status-admin';
import type { StatusTargets } from './types';

const s = (id: string, closed = false) => ({ id, closed });
const statuses = [s('neu'), s('arbeit'), s('wartet'), s('geloest', true), s('archiv', true), s('abgelehnt', true)];
const targets: StatusTargets = { start: 'neu', reply: 'arbeit', close: 'geloest', reject: 'abgelehnt', waiting: 'wartet' };
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('targetsOf', () => {
  it('liefert alle Ziele eines Status', () => {
    expect(targetsOf({ start: 'a', reply: 'a', close: 'b' }, 'a')).toEqual(['start', 'reply']);
    expect(targetsOf(targets, 'archiv')).toEqual([]);
  });
});

describe('targetOptions', () => {
  it('bietet für offene Ziele nur offene Status, ohne den Wartet-Status', () => {
    expect(ids(targetOptions(statuses, targets, 'start'))).toEqual(['neu', 'arbeit']);
    expect(ids(targetOptions(statuses, targets, 'reply'))).toEqual(['neu', 'arbeit']);
  });

  it('bietet für «Wartet» offene Status ausser Start und «nach Antwort»', () => {
    expect(ids(targetOptions(statuses, targets, 'waiting'))).toEqual(['wartet']);
    expect(ids(targetOptions(statuses, { start: 'neu', reply: 'neu' }, 'waiting'))).toEqual(['arbeit', 'wartet']);
  });

  it('trennt Schliessen und Ablehnen', () => {
    expect(ids(targetOptions(statuses, targets, 'close'))).toEqual(['geloest', 'archiv']);
    expect(ids(targetOptions(statuses, targets, 'reject'))).toEqual(['archiv', 'abgelehnt']);
    expect(ids(targetOptions(statuses, { ...targets, reject: undefined }, 'close'))).toEqual(['geloest', 'archiv', 'abgelehnt']);
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
    expect(targetsAfterRemoval(targets, 'wartet', { waiting: null })).toEqual({
      start: 'neu',
      reply: 'arbeit',
      close: 'geloest',
      reject: 'abgelehnt',
    });
    expect(targetsAfterRemoval(targets, 'geloest', {}).close).toBeUndefined();
  });

  it('ändert nichts, wenn der Status kein Ziel ist', () => {
    expect(targetsAfterRemoval(targets, 'archiv', { close: 'archiv' })).toEqual(targets);
  });
});
