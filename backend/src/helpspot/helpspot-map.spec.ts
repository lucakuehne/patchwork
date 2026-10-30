import { describe, expect, it } from 'vitest';
import type { HelpSpotSettings } from '../settings/settings.service';
import { changeText, effectiveMappings, resolveTicket, suggestCopyKeep, suggestType, type MappingContext } from './helpspot-map';
import { htmlToText } from './helpspot-text';
import type { HsTicket } from './helpspot-ticket';

const ctx: MappingContext = {
  targets: {
    incident: { start: 'i-new', reply: 'i-progress', close: 'i-resolved', reject: 'i-rejected' },
    task: { start: 't-backlog', reply: 't-progress', close: 't-done', reject: 't-rejected' },
  },
  statuses: [
    { id: 'i-new', type: 'incident', closed: false },
    { id: 'i-progress', type: 'incident', closed: false },
    { id: 'i-resolved', type: 'incident', closed: true },
    { id: 'i-rejected', type: 'incident', closed: true },
    { id: 't-backlog', type: 'task', closed: false },
    { id: 't-progress', type: 'task', closed: false },
    { id: 't-done', type: 'task', closed: true },
    { id: 't-rejected', type: 'task', closed: true },
  ],
  channels: [
    { id: 'c-mail', label: 'Mail' },
    { id: 'c-phone', label: 'Telefon' },
  ],
  mailChannelId: 'c-mail',
};
const empty: HelpSpotSettings = { url: '', apiKeyEnc: null, types: {}, statuses: {}, channels: {}, analysis: null };
const ticket = (patch: Partial<HsTicket>): HsTicket => ({
  number: 1,
  title: 'T',
  open: false,
  status: 'Problem Solved',
  urgent: false,
  openedVia: 'Email',
  type: 'Incident',
  reporter: { email: '', firstName: '', lastName: '', phone: '' },
  assignedTo: '',
  trash: false,
  spam: false,
  closedAt: null,
  history: [],
  ...patch,
});

describe('Zuordnung aus HelpSpot', () => {
  it('schlägt den Typ vor: Changes und Project werden Aufgaben', () => {
    expect(['Incident', '', 'Other', 'Changes', 'Project'].map(suggestType)).toEqual(['incident', 'incident', 'incident', 'task', 'task']);
  });

  it('schlägt Status vor: geschlossen auf Schliessen, «Not a problem» auf Ablehnen, offen auf «Antwort führt in»', () => {
    expect(resolveTicket(ticket({}), empty, ctx)).toEqual({ type: 'incident', statusId: 'i-resolved', channelId: 'c-mail' });
    expect(resolveTicket(ticket({ status: 'Not a Problem' }), empty, ctx).statusId).toBe('i-rejected');
    expect(resolveTicket(ticket({ open: true, status: 'Active', type: 'Changes', openedVia: 'Phone' }), empty, ctx)).toEqual({
      type: 'task',
      statusId: 't-progress',
      channelId: 'c-phone',
    });
    expect(resolveTicket(ticket({ openedVia: 'Walk In' }), empty, ctx).channelId).toBeNull();
  });

  it('gespeicherte Zuordnungen gelten, aber nur passende Status', () => {
    const settings = {
      ...empty,
      types: { Incident: 'task' as const },
      statuses: { 'task|Problem Solved|closed': 't-rejected', 'task|Active|open': 't-done' },
      channels: { Email: null },
    };
    expect(resolveTicket(ticket({}), settings, ctx)).toEqual({ type: 'task', statusId: 't-rejected', channelId: null });
    // Ein abgeschlossener Status für ein offenes Ticket wird nicht übernommen, es gilt der Vorschlag
    expect(resolveTicket(ticket({ open: true, status: 'Active' }), settings, ctx).statusId).toBe('t-progress');
  });

  it('Zuordnungen für die Seite aus der Übersicht', () => {
    const analysis = {
      at: '',
      total: 3,
      statuses: [
        { status: 'Problem Solved', open: false, count: 2 },
        { status: 'Active', open: true, count: 1 },
      ],
      types: [
        { value: 'Incident', count: 2 },
        { value: 'Changes', count: 1 },
      ],
      openedVia: [{ value: 'Email', count: 3 }],
    };
    expect(effectiveMappings(empty, analysis, ctx)).toEqual({
      types: { Incident: 'incident', Changes: 'task' },
      statuses: {
        'incident|Problem Solved|closed': 'i-resolved',
        'incident|Active|open': 'i-progress',
        'task|Problem Solved|closed': 't-done',
        'task|Active|open': 't-progress',
      },
      channels: { Email: 'c-mail' },
    });
  });

  it('HTML als Text', () => {
    expect(htmlToText('<p>Hallo&nbsp;Anna</p><p>Zeile 1<br>Zeile 2 &amp; mehr</p><script>x()</script>')).toBe('Hallo Anna\nZeile 1\nZeile 2 & mehr');
  });

  it('Änderung aus HelpSpot: eine Zeile je Änderung, ohne «Request Changed:»', () => {
    const log =
      '<div class="note-stream-item-logtext">Request Changed:</div><div class="note-stream-item-logtext">Request changed from &quot;CLOSED&quot; to &quot;OPEN&quot;</div>' +
      '<div class="note-stream-item-logtext">Status changed from &quot;Problem Solved&quot; to &quot;Active&quot;</div>';
    expect(changeText(log, true)).toBe('Request changed from "CLOSED" to "OPEN"\nStatus changed from "Problem Solved" to "Active"');
    expect(changeText('Request Changed:\nStatus von Active zu Problem Solved', false)).toBe('Status von Active zu Problem Solved');
  });

  it('Kopie aus der Parallelphase: bleibt bei Aufgaben und mit Antworten oder Notizen der IT, sonst bleibt der HS-Vorgang', () => {
    const copy = (type: 'incident' | 'task' | null, discarded = false) => ({ type, discarded });
    expect(suggestCopyKeep(copy('task'), 0)).toEqual({ keep: 'copy', reason: 'task' });
    expect(suggestCopyKeep(copy('incident'), 2)).toEqual({ keep: 'copy', reason: 'staffEntries' });
    expect(suggestCopyKeep(copy(null), 1)).toEqual({ keep: 'copy', reason: 'staffEntries' });
    expect(suggestCopyKeep(copy('incident'), 0)).toEqual({ keep: 'original', reason: null });
    expect(suggestCopyKeep(copy(null), 0)).toEqual({ keep: 'original', reason: null });
    // Verworfen: Antworten landen dort nie, also bleibt der HS-Vorgang
    expect(suggestCopyKeep(copy(null, true), 3)).toEqual({ keep: 'original', reason: null });
  });
});
