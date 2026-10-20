import { describe, expect, it } from 'vitest';
import type { ItemType } from '../db/schema';
import {
  DEFAULT_STATUSES,
  DEFAULT_TARGETS,
  isCompleting,
  rejectAllowed,
  reopensOnReply,
  suggestTypeChangeStatus,
  targetsProblem,
  transitionAllowed,
  type StatusLike,
  type TargetsByType,
} from './status-rules';

const all: (StatusLike & { key: string })[] = DEFAULT_STATUSES.map((s) => ({ ...s, id: `${s.type}:${s.key}` }));
const byKey = (type: ItemType, key: string) => all.find((s) => s.type === type && s.key === key)!;
const toIds = (type: ItemType) =>
  Object.fromEntries(Object.entries(DEFAULT_TARGETS[type]).map(([target, key]) => [target, byKey(type, key!).id]));
const targets: TargetsByType = { incident: toIds('incident'), task: toIds('task') };

describe('suggestTypeChangeStatus', () => {
  const suggest = (type: ItemType, key: string, to: ItemType) => suggestTypeChangeStatus(targets, byKey(type, key), to);

  it.each([
    ['new', 'task:backlog'],
    ['in_progress', 'task:in_progress'],
    ['waiting', 'task:in_progress'],
    ['resolved', 'task:done'],
  ])('Störung %s → Aufgabe %s', (from, to) => {
    expect(suggest('incident', from, 'task')).toBe(to);
  });

  it.each([
    ['backlog', 'incident:new'],
    ['planned', 'incident:in_progress'],
    ['in_progress', 'incident:in_progress'],
    ['done', 'incident:resolved'],
    ['rejected', 'incident:resolved'],
  ])('Aufgabe %s → Störung %s', (from, to) => {
    expect(suggest('task', from, 'incident')).toBe(to);
  });

  it('übernimmt Wartet und Ablehnen, wenn der Zieltyp sie hat', () => {
    const withBoth: TargetsByType = {
      incident: { ...targets.incident, reject: 'incident:abgelehnt' },
      task: { ...targets.task, waiting: 'task:wartet' },
    };
    expect(suggestTypeChangeStatus(withBoth, byKey('incident', 'waiting'), 'task')).toBe('task:wartet');
    expect(suggestTypeChangeStatus(withBoth, byKey('task', 'rejected'), 'incident')).toBe('incident:abgelehnt');
  });

  it('aus dem Eingang: Start', () => {
    expect(suggestTypeChangeStatus(targets, null, 'incident')).toBe('incident:new');
  });
});

describe('targetsProblem', () => {
  it('akzeptiert die Standardziele', () => {
    expect(targetsProblem(all, 'incident', targets.incident)).toBeNull();
    expect(targetsProblem(all, 'task', targets.task)).toBeNull();
  });

  it('verlangt Pflichtziele, passendes «abgeschlossen» und den richtigen Typ', () => {
    expect(targetsProblem(all, 'task', { ...targets.task, reply: undefined })).toMatch(/Antwort des Melders/);
    expect(targetsProblem(all, 'task', { ...targets.task, start: 'task:done' })).toMatch(/muss offen sein/);
    expect(targetsProblem(all, 'task', { ...targets.task, close: 'task:in_progress' })).toMatch(/muss abgeschlossen sein/);
    expect(targetsProblem(all, 'task', { ...targets.task, start: 'incident:new' })).toMatch(/nicht zu diesem Typ/);
  });

  it('trennt Wartet von Start und «nach Antwort», Schliessen von Ablehnen', () => {
    expect(targetsProblem(all, 'incident', { ...targets.incident, reply: 'incident:waiting' })).toMatch(/nicht der Status «Wartet/);
    expect(targetsProblem(all, 'incident', { ...targets.incident, start: 'incident:waiting' })).toMatch(/neue Vorgänge/);
    expect(targetsProblem(all, 'task', { ...targets.task, reject: 'task:done' })).toMatch(/verschiedene Status/);
  });
});

describe('reopensOnReply', () => {
  it('öffnet aus Wartet und Abgeschlossenem, nicht aus Ablehnen und anderen offenen', () => {
    expect(reopensOnReply(targets.incident, byKey('incident', 'waiting'))).toBe(true);
    expect(reopensOnReply(targets.incident, byKey('incident', 'resolved'))).toBe(true);
    expect(reopensOnReply(targets.incident, byKey('incident', 'in_progress'))).toBe(false);
    expect(reopensOnReply(targets.task, byKey('task', 'rejected'))).toBe(false);
    expect(reopensOnReply(targets.task, byKey('task', 'done'))).toBe(true);
  });
});

describe('isCompleting', () => {
  it('in Abgeschlossenes ausser Ablehnen, aus Offenem oder aus Ablehnen', () => {
    const t = targets.task;
    expect(isCompleting(t, byKey('task', 'in_progress'), byKey('task', 'done'))).toBe(true);
    expect(isCompleting(t, byKey('task', 'rejected'), byKey('task', 'done'))).toBe(true);
    expect(isCompleting(t, byKey('task', 'in_progress'), byKey('task', 'rejected'))).toBe(false);
    expect(isCompleting(t, byKey('task', 'done'), { id: 'task:archiv', closed: true })).toBe(false);
    expect(isCompleting(t, byKey('task', 'done'), byKey('task', 'in_progress'))).toBe(false);
  });
});

describe('rejectAllowed', () => {
  it('braucht ein Ablehnen-Ziel, nicht aus dem Ablehnen-Status, mit Einschränkung nur entlang eines Pfeils', () => {
    expect(rejectAllowed(false, [], undefined, 'incident:new')).toBe(false);
    expect(rejectAllowed(false, [], 'task:rejected', 'task:done')).toBe(true);
    expect(rejectAllowed(false, [], 'task:rejected', 'task:rejected')).toBe(false);
    expect(rejectAllowed(true, [], 'task:rejected', 'task:backlog')).toBe(false);
    expect(rejectAllowed(true, [{ fromId: 'task:backlog', toId: 'task:rejected' }], 'task:rejected', 'task:backlog')).toBe(true);
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
