import { describe, expect, it } from 'vitest';
import { describeTrigger, openScheduleIds, scheduleChoices, waitingOnly } from './rules-text';
import type { ItemType } from './types';

const status = (id: string, type: ItemType, label: string, position: number, closed = false) => ({
  id,
  type,
  label,
  position,
  closed,
});

const statuses = [
  status('backlog', 'task', 'Backlog', 0),
  status('done', 'task', 'Erledigt', 3, true),
  status('planned', 'task', 'Geplant', 1),
  status('in-progress', 'incident', 'In Arbeit', 1),
  status('new', 'incident', 'Neu', 0),
  status('awaiting', 'incident', 'Wartet auf Melder', 2),
  status('resolved', 'incident', 'Gelöst', 3, true),
];

describe('describeTrigger', () => {
  const timed = (days: number, statusIds: string[], waiting: boolean) => ({ triggers: [], schedule: { days, statusIds, waiting } });

  it('beschreibt Ereignisse', () => {
    expect(describeTrigger({ triggers: ['mail_new', 'portal_reply'], schedule: null }, statuses)).toBe(
      'Neue Mail, Antwort im Portal',
    );
  });

  it('beschreibt «Wartet auf den Melder»', () => {
    expect(describeTrigger(timed(7, [], true), statuses)).toBe('seit 7 Tagen in «Wartet auf den Melder»');
    expect(describeTrigger(timed(1, [], true), statuses)).toBe('seit 1 Tag in «Wartet auf den Melder»');
  });

  it('nennt die Status mit Typ, nach Typ und Reihenfolge, und lässt gelöschte weg', () => {
    expect(describeTrigger(timed(2, ['backlog', 'gone', 'new'], false), statuses)).toBe(
      'seit 2 Tagen in «Neu» (Störung), «Backlog» (Aufgabe)',
    );
    expect(describeTrigger(timed(3, ['planned'], true), statuses)).toBe(
      'seit 3 Tagen in «Wartet auf den Melder», «Geplant» (Aufgabe)',
    );
  });

  it('meldet, wenn alle Status gelöscht sind', () => {
    expect(describeTrigger(timed(2, ['gone'], false), statuses)).toBe('seit 2 Tagen in (Status gelöscht)');
  });
});

describe('scheduleChoices', () => {
  it('bietet die offenen Status je Typ in der eingestellten Reihenfolge an', () => {
    expect(scheduleChoices(statuses).map((g) => [g.type, g.statuses.map((s) => s.id)])).toEqual([
      ['incident', ['new', 'in-progress', 'awaiting']],
      ['task', ['backlog', 'planned']],
    ]);
  });

  it('lässt Typen ohne offenen Status weg', () => {
    expect(scheduleChoices([status('done', 'task', 'Erledigt', 0, true)])).toEqual([]);
  });
});

describe('openScheduleIds', () => {
  it('behält nur vorhandene offene Status', () => {
    expect(openScheduleIds(['new', 'gone', 'resolved', 'backlog'], statuses)).toEqual(['new', 'backlog']);
  });
});

describe('waitingOnly', () => {
  it('gilt nur für «Wartet auf den Melder» allein', () => {
    expect(waitingOnly({ statusIds: [], waiting: true })).toBe(true);
    expect(waitingOnly({ statusIds: ['new'], waiting: true })).toBe(false);
    expect(waitingOnly({ statusIds: [], waiting: false })).toBe(false);
  });
});
