import { describe, expect, it } from 'vitest';
import type { ItemType, StatusCategory } from '../db/schema';
import { CATEGORY_COLORS, DEFAULT_STATUSES, mapStatusForTypeChange, missingCategories, transitionAllowed, type StatusLike } from './status-rules';

const all: (StatusLike & { key: string })[] = DEFAULT_STATUSES.map((s) => ({ ...s, id: `${s.type}:${s.key}` }));
const byKey = (type: ItemType, key: string) => all.find((s) => s.type === type && s.key === key)!;

describe('mapStatusForTypeChange', () => {
  it.each([
    ['new', 'backlog'],
    ['in_progress', 'in_progress'],
    ['waiting', 'in_progress'],
    ['resolved', 'done'],
  ])('Störung %s → Aufgabe %s', (from, to) => {
    expect(mapStatusForTypeChange(all, byKey('incident', from), 'task').key).toBe(to);
  });

  it.each([
    ['backlog', 'new'],
    ['planned', 'new'],
    ['in_progress', 'in_progress'],
    ['done', 'resolved'],
    ['rejected', 'resolved'],
  ])('Aufgabe %s → Störung %s', (from, to) => {
    expect(mapStatusForTypeChange(all, byKey('task', from), 'incident').key).toBe(to);
  });

  it('nimmt bei mehreren Status derselben Kategorie den ersten nach Reihenfolge', () => {
    const custom = [
      ...all,
      { id: 'x', key: 'triage', type: 'task' as ItemType, category: 'new' as StatusCategory, position: -1 },
    ];
    expect(mapStatusForTypeChange(custom, byKey('incident', 'new'), 'task').key).toBe('triage');
  });
});

describe('transitionAllowed', () => {
  const transitions = [{ fromId: 'neu', toId: 'arbeit' }];

  it('erlaubt ohne Einschränkung jeden Wechsel', () => {
    expect(transitionAllowed(false, transitions, 'arbeit', 'neu')).toBe(true);
  });

  it('erlaubt mit Einschränkung nur die festgelegten Wechsel', () => {
    expect(transitionAllowed(true, transitions, 'neu', 'arbeit')).toBe(true);
    expect(transitionAllowed(true, transitions, 'arbeit', 'neu')).toBe(false);
    expect(transitionAllowed(true, [], 'neu', 'arbeit')).toBe(false);
  });

  it('lässt Verbleiben und Vorgänge ohne Status zu', () => {
    expect(transitionAllowed(true, [], 'neu', 'neu')).toBe(true);
    expect(transitionAllowed(true, [], null, 'neu')).toBe(true);
  });
});

describe('Standardfarben', () => {
  it('haben die bisherige Farbe der Kategorie', () => {
    for (const s of DEFAULT_STATUSES) expect(s.color).toBe(CATEGORY_COLORS[s.category]);
  });
});

describe('missingCategories', () => {
  it('meldet fehlende Pflichtkategorien', () => {
    const withoutDone = all.filter((s) => !(s.type === 'incident' && s.category === 'done'));
    expect(missingCategories(withoutDone, 'incident')).toEqual(['done']);
    expect(missingCategories(all, 'task')).toEqual([]);
  });
});
