import { describe, expect, it } from 'vitest';
import { ruleSchema } from './rule-types';
import { dueDate, dueTimedRules, waitedDays } from './timed';

const since = new Date('2026-10-01T08:00:00Z');
const after = (days: number) => new Date(since.getTime() + days * 24 * 3600 * 1000);
const remind = { id: 'remind', schedule: { category: 'waiting' as const, days: 7 } };
const close = { id: 'close', schedule: { category: 'waiting' as const, days: 14 } };
const escalate = { id: 'escalate', schedule: { category: 'new' as const, days: 2 } };
const event = { id: 'event', schedule: null };
const all = [remind, close, escalate, event];
const ids = (rules: { id: string }[]) => rules.map((r) => r.id);

describe('dueTimedRules', () => {
  it('nach Kategorie und Wartezeit', () => {
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'waiting', after(6.9), new Set()))).toEqual([]);
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'waiting', after(7), new Set()))).toEqual(['remind']);
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'waiting', after(20), new Set()))).toEqual(['remind', 'close']);
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'new', after(2), new Set()))).toEqual(['escalate']);
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'in_progress', after(100), new Set()))).toEqual([]);
  });

  it('einmal pro Aufenthalt im Status', () => {
    expect(ids(dueTimedRules(all, { statusChangedAt: since }, 'waiting', after(8), new Set(['remind'])))).toEqual([]);
  });

  it('Hilfsfunktionen', () => {
    expect(waitedDays(since, after(7.9))).toBe(7);
    expect(dueDate(since, 14)).toEqual(after(14));
  });
});

describe('ruleSchema', () => {
  const base = { name: 'R', conditions: { kind: 'group', op: 'and', children: [] } };

  it('entweder Ereignisse oder Zeit', () => {
    expect(ruleSchema.safeParse({ ...base, triggers: ['mail_new'], actions: { priority: 'high' } }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, schedule: { category: 'waiting', days: 7 }, actions: { remindReporter: true } }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, actions: { priority: 'high' } }).success).toBe(false);
    expect(
      ruleSchema.safeParse({ ...base, triggers: ['mail_new'], schedule: { category: 'new', days: 1 }, actions: { priority: 'high' } }).success,
    ).toBe(false);
  });

  it('Erinnern und Schliessen nur zeitgesteuert bei «Wartend»', () => {
    expect(ruleSchema.safeParse({ ...base, schedule: { category: 'new', days: 2 }, actions: { close: true } }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, triggers: ['mail_reply'], actions: { remindReporter: true } }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, schedule: { category: 'new', days: 2 }, actions: { type: 'task' } }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, schedule: { category: 'new', days: 2 }, actions: { priority: 'high' } }).success).toBe(true);
  });
});
