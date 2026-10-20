import { describe, expect, it } from 'vitest';
import { ruleSchema } from './rule-types';
import { dueDate, dueTimedRules, scheduleCovers, scheduledStatusIds, waitedDays } from './timed';

// Status-IDs (gültige UUIDs, weil das Schema sie prüft)
const NEW = '0b6a1c2e-6f1d-4c8e-9a51-1f2d3c4b5a61';
const IN_PROGRESS = '1c7b2d3f-7a2e-4d9f-8b62-2a3e4d5c6b72';
const WAITING = '2d8c3e4a-8b3f-4e0a-9c73-3b4f5e6d7c83';
const TASK_NEW = '3e9d4f5b-9c4a-4f1b-8d84-4c5a6f7e8d94';
const TASK_WAITING = '4fae5a6c-ad5b-4a2c-9e95-5d6b7a8f9ea5';

const since = new Date('2026-10-01T08:00:00Z');
const after = (days: number) => new Date(since.getTime() + days * 24 * 3600 * 1000);
const remind = { id: 'remind', schedule: { days: 7, statusIds: [], waiting: true } };
const close = { id: 'close', schedule: { days: 14, statusIds: [], waiting: true } };
const escalate = { id: 'escalate', schedule: { days: 2, statusIds: [NEW, TASK_NEW], waiting: false } };
const mixed = { id: 'mixed', schedule: { days: 3, statusIds: [IN_PROGRESS], waiting: true } };
const event = { id: 'event', schedule: null };
const all = [remind, close, escalate, mixed, event];
const ids = (rules: { id: string }[]) => rules.map((r) => r.id);
const inStatus = (statusId: string | null) => ({ statusId, statusChangedAt: since });

describe('scheduleCovers', () => {
  it('genannte Status und der Wartet-Status des Typs', () => {
    expect(scheduleCovers(escalate.schedule, NEW, WAITING)).toBe(true);
    expect(scheduleCovers(escalate.schedule, TASK_NEW, undefined)).toBe(true);
    expect(scheduleCovers(escalate.schedule, WAITING, WAITING)).toBe(false);
    expect(scheduleCovers(remind.schedule, WAITING, WAITING)).toBe(true);
    expect(scheduleCovers(remind.schedule, NEW, WAITING)).toBe(false);
    expect(scheduleCovers(mixed.schedule, IN_PROGRESS, WAITING)).toBe(true);
    expect(scheduleCovers(mixed.schedule, WAITING, WAITING)).toBe(true);
  });

  it('ohne Wartet-Status des Typs bzw. ohne Status nie', () => {
    expect(scheduleCovers(remind.schedule, TASK_NEW, undefined)).toBe(false);
    expect(scheduleCovers(remind.schedule, null, undefined)).toBe(false);
    expect(scheduleCovers(escalate.schedule, null, WAITING)).toBe(false);
  });
});

describe('scheduledStatusIds', () => {
  const targets = { incident: { start: NEW, waiting: WAITING }, task: { start: TASK_NEW, waiting: TASK_WAITING } };

  it('Vereinigung der genannten Status, mit «Wartet» die Wartet-Status beider Typen', () => {
    expect(scheduledStatusIds([escalate.schedule], targets).sort()).toEqual([NEW, TASK_NEW].sort());
    expect(scheduledStatusIds([remind.schedule], targets).sort()).toEqual([WAITING, TASK_WAITING].sort());
    expect(scheduledStatusIds([escalate.schedule, mixed.schedule, remind.schedule], targets).sort()).toEqual(
      [NEW, TASK_NEW, IN_PROGRESS, WAITING, TASK_WAITING].sort(),
    );
  });

  it('Typen ohne Wartet-Status', () => {
    expect(scheduledStatusIds([remind.schedule], { incident: { start: NEW }, task: {} })).toEqual([]);
    expect(scheduledStatusIds([remind.schedule], { incident: { waiting: WAITING }, task: {} })).toEqual([WAITING]);
    expect(scheduledStatusIds([], targets)).toEqual([]);
  });
});

describe('dueTimedRules', () => {
  it('nach Status und Wartezeit', () => {
    expect(ids(dueTimedRules(all, inStatus(WAITING), WAITING, after(2.9), new Set()))).toEqual([]);
    expect(ids(dueTimedRules(all, inStatus(WAITING), WAITING, after(3), new Set()))).toEqual(['mixed']);
    expect(ids(dueTimedRules(all, inStatus(WAITING), WAITING, after(7), new Set()))).toEqual(['remind', 'mixed']);
    expect(ids(dueTimedRules(all, inStatus(WAITING), WAITING, after(20), new Set()))).toEqual(['remind', 'close', 'mixed']);
    expect(ids(dueTimedRules(all, inStatus(NEW), WAITING, after(2), new Set()))).toEqual(['escalate']);
    expect(ids(dueTimedRules(all, inStatus(TASK_NEW), undefined, after(2), new Set()))).toEqual(['escalate']);
    expect(ids(dueTimedRules(all, inStatus(IN_PROGRESS), WAITING, after(100), new Set()))).toEqual(['mixed']);
  });

  it('Wartet-Status nur des eigenen Typs', () => {
    // Aufgabe ohne Wartet-Status: Die Regeln mit «Wartet auf den Melder» greifen nicht
    expect(ids(dueTimedRules(all, inStatus(TASK_WAITING), undefined, after(100), new Set()))).toEqual([]);
    expect(ids(dueTimedRules(all, inStatus(TASK_WAITING), TASK_WAITING, after(100), new Set()))).toEqual(['remind', 'close', 'mixed']);
  });

  it('einmal pro Aufenthalt im Status', () => {
    expect(ids(dueTimedRules(all, inStatus(WAITING), WAITING, after(8), new Set(['remind', 'mixed'])))).toEqual([]);
  });

  it('Hilfsfunktionen', () => {
    expect(waitedDays(since, after(7.9))).toBe(7);
    expect(dueDate(since, 14)).toEqual(after(14));
  });
});

describe('ruleSchema', () => {
  const base = { name: 'R', conditions: { kind: 'group', op: 'and', children: [] } };
  const valid = (rule: object) => ruleSchema.safeParse({ ...base, ...rule }).success;
  const priority = { priority: 'high' };

  it('entweder Ereignisse oder Zeit', () => {
    expect(valid({ triggers: ['mail_new'], actions: priority })).toBe(true);
    expect(valid({ schedule: { days: 7, waiting: true }, actions: { remindReporter: true } })).toBe(true);
    expect(valid({ actions: priority })).toBe(false);
    expect(valid({ triggers: ['mail_new'], schedule: { days: 1, statusIds: [NEW] }, actions: priority })).toBe(false);
  });

  it('Zeit braucht einen Status oder «Wartet auf den Melder»', () => {
    expect(valid({ schedule: { days: 2 }, actions: priority })).toBe(false);
    expect(valid({ schedule: { days: 2, statusIds: [], waiting: false }, actions: priority })).toBe(false);
    expect(valid({ schedule: { days: 2, statusIds: ['kein-status'] }, actions: priority })).toBe(false);
    const parsed = ruleSchema.parse({ ...base, schedule: { days: 2, statusIds: [NEW, NEW, TASK_NEW] }, actions: priority });
    expect(parsed.schedule).toEqual({ days: 2, statusIds: [NEW, TASK_NEW], waiting: false });
  });

  it('Erinnern und Schliessen nur zeitgesteuert mit «Wartet auf den Melder» allein', () => {
    expect(valid({ schedule: { days: 14, waiting: true }, actions: { close: true } })).toBe(true);
    expect(valid({ schedule: { days: 2, statusIds: [NEW] }, actions: { close: true } })).toBe(false);
    expect(valid({ schedule: { days: 2, statusIds: [NEW], waiting: true }, actions: { remindReporter: true } })).toBe(false);
    expect(valid({ triggers: ['mail_reply'], actions: { remindReporter: true } })).toBe(false);
    expect(valid({ schedule: { days: 2, statusIds: [NEW] }, actions: { type: 'task' } })).toBe(false);
    expect(valid({ schedule: { days: 2, statusIds: [NEW], waiting: true }, actions: priority })).toBe(true);
  });
});
