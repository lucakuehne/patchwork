import { describe, expect, it } from 'vitest';
import { manualStatusChoices, typeChangeChoices } from './status-move';
import type { StatusTargetsByType } from './types';

const s = (id: string) => ({ id });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

const incident = ['new', 'in-progress', 'awaiting', 'resolved'].map(s);
const task = ['backlog', 'geplant', 'doing', 'erledigt', 'rejected'].map(s);
const targets: StatusTargetsByType = {
  incident: { start: 'new', reply: 'in-progress', close: 'resolved', waiting: 'awaiting' },
  task: { start: 'backlog', reply: 'doing', close: 'erledigt', reject: 'rejected' },
};

describe('manualStatusChoices', () => {
  it('ohne Ablehnen-Status, Reihenfolge bleibt', () => {
    expect(ids(manualStatusChoices(task, targets.task, null))).toEqual(['backlog', 'geplant', 'doing', 'erledigt']);
    expect(ids(manualStatusChoices(incident, targets.incident, 'new'))).toEqual(['new', 'in-progress', 'awaiting', 'resolved']);
  });

  it('nur erlaubte Wechsel, der aktuelle Status bleibt', () => {
    const allowed = (to: string) => to === 'doing';
    expect(ids(manualStatusChoices(task, targets.task, 'geplant', allowed))).toEqual(['geplant', 'doing']);
  });

  it('der Ablehnen-Status fehlt auch, wenn der Vorgang darin steht', () => {
    expect(ids(manualStatusChoices(task, targets.task, 'rejected', (to) => to === 'backlog'))).toEqual(['backlog']);
  });
});

describe('typeChangeChoices', () => {
  it('alle Status des Zieltyps ausser dessen Ablehnen-Status', () => {
    expect(ids(typeChangeChoices(task, targets, { id: 'in-progress', type: 'incident' }, 'task'))).toEqual([
      'backlog',
      'geplant',
      'doing',
      'erledigt',
    ]);
    expect(ids(typeChangeChoices(incident, targets, { id: 'doing', type: 'task' }, 'incident'))).toEqual(ids(incident));
  });

  it('zur Störung den Ablehnen-Status nur aus dem Ablehnen-Status der Aufgaben', () => {
    const withReject: StatusTargetsByType = { ...targets, incident: { ...targets.incident, reject: 'storniert' } };
    const incidents = [...incident, s('storniert')];
    expect(ids(typeChangeChoices(incidents, withReject, { id: 'rejected', type: 'task' }, 'incident'))).toContain('storniert');
    expect(ids(typeChangeChoices(incidents, withReject, { id: 'erledigt', type: 'task' }, 'incident'))).not.toContain('storniert');
  });

  it('zur Aufgabe nie den Ablehnen-Status, auch aus dem Eingang', () => {
    const rejectedIncident: StatusTargetsByType = { ...targets, incident: { ...targets.incident, reject: 'storniert' } };
    expect(ids(typeChangeChoices(task, rejectedIncident, { id: 'storniert', type: 'incident' }, 'task'))).not.toContain('rejected');
    expect(ids(typeChangeChoices(task, targets, null, 'task'))).toEqual(['backlog', 'geplant', 'doing', 'erledigt']);
  });
});
