import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { manualStatusChoices, sendStatusChange, typeChangeChoices, type StatusExtra } from './status-move';
import { useAssigneePrompt } from './stores/assignee-prompt';
import { useConfirm } from './stores/confirm';
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

describe('sendStatusChange (Zuständig Pflicht, offene Checklisten-Punkte)', () => {
  beforeEach(() => setActivePinia(createPinia()));
  const required = () =>
    new ApiError(400, 'Im Status «In Arbeit» braucht der Vorgang einen Zuständigen.', { code: 'ASSIGNEE_REQUIRED' });
  const checklist = () => new ApiError(409, 'Ein Punkt der Checklisten ist noch offen.', { code: 'OPEN_CHECKLIST' });

  it('ohne Rückfrage: einmal senden, ohne Zusatzangaben', async () => {
    const calls: StatusExtra[] = [];
    expect(await sendStatusChange(async (extra) => void calls.push(extra))).toBe(true);
    expect(calls).toEqual([{}]);
  });

  it('fragt nach dem Zuständigen und sendet mit der gewählten Person erneut', async () => {
    const calls: StatusExtra[] = [];
    const prompt = useAssigneePrompt();
    const result = sendStatusChange(async (extra) => {
      calls.push(extra);
      if (!extra.assigneeId) throw required();
    });
    await vi.waitFor(() => expect(prompt.message).toBe('Im Status «In Arbeit» braucht der Vorgang einen Zuständigen.'));
    prompt.answer('ivan');
    expect(await result).toBe(true);
    expect(calls).toEqual([{}, { assigneeId: 'ivan' }]);
    expect(prompt.message).toBeNull();
  });

  it('Zuständig und dann Checkliste: beide Angaben im letzten Versuch', async () => {
    const calls: StatusExtra[] = [];
    const prompt = useAssigneePrompt();
    const confirm = useConfirm();
    const result = sendStatusChange(async (extra) => {
      calls.push(extra);
      if (!extra.assigneeId) throw required();
      if (!extra.force) throw checklist();
    });
    await vi.waitFor(() => expect(prompt.message).not.toBeNull());
    prompt.answer('ivan');
    await vi.waitFor(() => expect(confirm.request?.message).toBe('Ein Punkt der Checklisten ist noch offen. Trotzdem abschliessen?'));
    confirm.answer(true);
    expect(await result).toBe(true);
    expect(calls).toEqual([{}, { assigneeId: 'ivan' }, { assigneeId: 'ivan', force: true }]);
  });

  it('Abbrechen: false, kein weiterer Versuch', async () => {
    const calls: StatusExtra[] = [];
    const prompt = useAssigneePrompt();
    const result = sendStatusChange(async (extra) => {
      calls.push(extra);
      throw required();
    });
    await vi.waitFor(() => expect(prompt.message).not.toBeNull());
    prompt.answer(null);
    expect(await result).toBe(false);
    expect(calls).toEqual([{}]);
  });

  it('andere Fehler gehen weiter, ohne Fenster', async () => {
    const prompt = useAssigneePrompt();
    await expect(sendStatusChange(async () => Promise.reject(new ApiError(400, 'Kaputt')))).rejects.toThrow('Kaputt');
    expect(prompt.message).toBeNull();
  });
});
