import { describe, expect, it } from 'vitest';
import type { ItemType } from '../db/schema';
import { DEFAULT_STATUSES, DEFAULT_TARGETS, type StatusLike, type TargetsByType } from '../statuses/status-rules';
import { closedAtAfter, moveTarget, newItemStatus, typeChangeStatus } from './status-change';

const all: (StatusLike & { key: string; label: string })[] = DEFAULT_STATUSES.map((s) => ({ ...s, id: `${s.type}:${s.key}` }));
const byKey = (type: ItemType, key: string) => all.find((s) => s.type === type && s.key === key)!;
const toIds = (type: ItemType) =>
  Object.fromEntries(Object.entries(DEFAULT_TARGETS[type]).map(([target, key]) => [target, byKey(type, key!).id]));
const targets: TargetsByType = { incident: toIds('incident'), task: toIds('task') };

describe('closedAtAfter', () => {
  const earlier = new Date('2026-10-01T08:00:00Z');
  const now = new Date('2026-10-20T10:00:00Z');

  it('setzt das Datum beim Wechsel in einen abgeschlossenen Status', () => {
    expect(closedAtAfter(null, byKey('task', 'in_progress'), byKey('task', 'done'), now)).toBe(now);
    expect(closedAtAfter(null, undefined, byKey('task', 'done'), now)).toBe(now);
  });

  it('behält das Datum zwischen zwei abgeschlossenen Status', () => {
    expect(closedAtAfter(earlier, byKey('task', 'done'), byKey('task', 'rejected'), now)).toBe(earlier);
  });

  it('setzt ein fehlendes Datum auch zwischen abgeschlossenen Status', () => {
    expect(closedAtAfter(null, byKey('task', 'done'), byKey('task', 'rejected'), now)).toBe(now);
  });

  it('löscht das Datum in einem offenen Status', () => {
    expect(closedAtAfter(earlier, byKey('task', 'done'), byKey('task', 'in_progress'), now)).toBeNull();
    expect(closedAtAfter(earlier, undefined, byKey('incident', 'new'), now)).toBeNull();
  });
});

describe('newItemStatus', () => {
  it('ohne Wahl: «Neuer Vorgang erhält»', () => {
    expect(newItemStatus(all, targets.task, 'task').id).toBe('task:backlog');
    expect(newItemStatus(all, targets.incident, 'incident', null).id).toBe('incident:new');
  });

  it('übernimmt einen gewählten Status des Typs, auch einen abgeschlossenen', () => {
    expect(newItemStatus(all, targets.task, 'task', 'task:planned').id).toBe('task:planned');
    expect(newItemStatus(all, targets.task, 'task', 'task:done').id).toBe('task:done');
  });

  it('lehnt den Ablehnen-Status und Status anderer Typen ab', () => {
    expect(() => newItemStatus(all, targets.task, 'task', 'task:rejected')).toThrow(/nicht abgelehnt/);
    expect(() => newItemStatus(all, targets.task, 'task', 'incident:new')).toThrow(/passt nicht/);
  });
});

describe('moveTarget', () => {
  it('erlaubt jeden Status des Typs ausser dem Ablehnen-Status', () => {
    expect(moveTarget(all, targets.task, 'task', 'task:done').id).toBe('task:done');
    expect(() => moveTarget(all, targets.task, 'task', 'task:rejected')).toThrow(/«Ablehnen» verwenden/);
    expect(() => moveTarget(all, targets.task, 'task', 'incident:new')).toThrow(/passt nicht/);
  });

  it('ohne Ablehnen-Ziel ist ein früherer Ablehnen-Status ein gewöhnlicher abgeschlossener Status', () => {
    expect(moveTarget(all, { ...targets.task, reject: undefined }, 'task', 'task:rejected').id).toBe('task:rejected');
  });
});

describe('typeChangeStatus', () => {
  it('ohne Wahl: Vorschlag nach der Rolle des bisherigen Status', () => {
    expect(typeChangeStatus(all, targets, byKey('incident', 'waiting'), 'task').id).toBe('task:in_progress');
    expect(typeChangeStatus(all, targets, byKey('incident', 'new'), 'task').id).toBe('task:backlog');
    expect(typeChangeStatus(all, targets, byKey('task', 'rejected'), 'incident').id).toBe('incident:resolved');
    expect(typeChangeStatus(all, targets, byKey('task', 'done'), 'incident', null).id).toBe('incident:resolved');
  });

  it('aus dem Eingang: «Neuer Vorgang erhält»', () => {
    expect(typeChangeStatus(all, targets, undefined, 'incident').id).toBe('incident:new');
  });

  it('übernimmt den gewählten Status des neuen Typs', () => {
    expect(typeChangeStatus(all, targets, byKey('incident', 'in_progress'), 'task', 'task:planned').id).toBe('task:planned');
    expect(typeChangeStatus(all, targets, byKey('incident', 'resolved'), 'task', 'task:in_progress').id).toBe('task:in_progress');
  });

  it('lehnt Status eines anderen Typs ab', () => {
    expect(() => typeChangeStatus(all, targets, byKey('incident', 'new'), 'task', 'incident:in_progress')).toThrow(/passt nicht/);
  });

  it('den Ablehnen-Status des neuen Typs nur aus dem Ablehnen-Status', () => {
    const withReject: TargetsByType = { ...targets, incident: { ...targets.incident, reject: 'incident:abgelehnt' } };
    const withRejectStatus = [
      ...all,
      { id: 'incident:abgelehnt', key: 'abgelehnt', label: 'Abgelehnt', type: 'incident' as const, closed: true, position: 4 },
    ];
    expect(typeChangeStatus(withRejectStatus, withReject, byKey('task', 'rejected'), 'incident').id).toBe('incident:abgelehnt');
    expect(typeChangeStatus(withRejectStatus, withReject, byKey('task', 'rejected'), 'incident', 'incident:abgelehnt').id).toBe(
      'incident:abgelehnt',
    );
    expect(() => typeChangeStatus(withRejectStatus, withReject, byKey('task', 'done'), 'incident', 'incident:abgelehnt')).toThrow(
      /nur über «Ablehnen»/,
    );
    expect(() => typeChangeStatus(all, targets, byKey('incident', 'resolved'), 'task', 'task:rejected')).toThrow(/nur über «Ablehnen»/);
    expect(() => typeChangeStatus(all, targets, undefined, 'task', 'task:rejected')).toThrow(/nur über «Ablehnen»/);
  });
});
