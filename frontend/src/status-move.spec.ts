import { describe, expect, it } from 'vitest';
import { manualStatusChoices, typeChangeChoices } from './status-move';
import type { StatusTargetsByType } from './types';

const s = (id: string) => ({ id });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

const incident = ['neu', 'arbeit', 'wartet', 'geloest'].map(s);
const task = ['backlog', 'geplant', 'doing', 'erledigt', 'abgelehnt'].map(s);
const targets: StatusTargetsByType = {
  incident: { start: 'neu', reply: 'arbeit', close: 'geloest', waiting: 'wartet' },
  task: { start: 'backlog', reply: 'doing', close: 'erledigt', reject: 'abgelehnt' },
};

describe('manualStatusChoices', () => {
  it('ohne Ablehnen-Status, Reihenfolge bleibt', () => {
    expect(ids(manualStatusChoices(task, targets.task, null))).toEqual(['backlog', 'geplant', 'doing', 'erledigt']);
    expect(ids(manualStatusChoices(incident, targets.incident, 'neu'))).toEqual(['neu', 'arbeit', 'wartet', 'geloest']);
  });

  it('nur erlaubte Wechsel, der aktuelle Status bleibt', () => {
    const allowed = (to: string) => to === 'doing';
    expect(ids(manualStatusChoices(task, targets.task, 'geplant', allowed))).toEqual(['geplant', 'doing']);
  });

  it('der Ablehnen-Status fehlt auch, wenn der Vorgang darin steht', () => {
    expect(ids(manualStatusChoices(task, targets.task, 'abgelehnt', (to) => to === 'backlog'))).toEqual(['backlog']);
  });
});

describe('typeChangeChoices', () => {
  it('alle Status des Zieltyps ausser dessen Ablehnen-Status', () => {
    expect(ids(typeChangeChoices(task, targets, { id: 'arbeit', type: 'incident' }, 'task'))).toEqual([
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
    expect(ids(typeChangeChoices(incidents, withReject, { id: 'abgelehnt', type: 'task' }, 'incident'))).toContain('storniert');
    expect(ids(typeChangeChoices(incidents, withReject, { id: 'erledigt', type: 'task' }, 'incident'))).not.toContain('storniert');
  });

  it('zur Aufgabe nie den Ablehnen-Status, auch aus dem Eingang', () => {
    const rejectedIncident: StatusTargetsByType = { ...targets, incident: { ...targets.incident, reject: 'storniert' } };
    expect(ids(typeChangeChoices(task, rejectedIncident, { id: 'storniert', type: 'incident' }, 'task'))).not.toContain('abgelehnt');
    expect(ids(typeChangeChoices(task, targets, null, 'task'))).toEqual(['backlog', 'geplant', 'doing', 'erledigt']);
  });
});
