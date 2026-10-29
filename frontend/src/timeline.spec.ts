import { describe, expect, it } from 'vitest';
import { asListItem, eventPart, groupTimeline, mailRecipientsText } from './timeline';
import type { Entry, ItemMail } from './types';

const ada = { id: 'ada', name: 'Ada Admin', firstName: 'Ada', lastName: 'Admin', email: 'ada@test.local', role: 'admin' as const };
const ivan = { id: 'ivan', name: 'Ivan IT', firstName: 'Ivan', lastName: 'IT', email: 'ivan@test.local', role: 'it' as const };
let n = 0;
const entry = (minute: number, patch: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`,
  kind: 'change',
  body: '',
  bodyHtml: null,
  meta: { field: 'priority', from: 'Normal', to: 'Hoch' },
  createdAt: new Date(Date.UTC(2026, 9, 15, 10, minute)).toISOString(),
  editedAt: null,
  timeChange: null,
  author: ada,
  recordedBy: null,
  recordedById: null,
  originalMessageId: null,
  delivery: null,
  mailId: null,
  attachments: [],
  ...patch,
});
const mail = (minute: number, patch: Partial<ItemMail> = {}): ItemMail => ({
  id: `m${++n}`,
  template: 'done',
  label: 'Erledigt',
  createdAt: new Date(Date.UTC(2026, 9, 15, 10, minute)).toISOString(),
  status: 'sent',
  to: [{ email: 'anna@test.local', name: 'Anna Muster' }],
  cc: [],
  deliveredTo: ['anna@test.local'],
  error: null,
  ...patch,
});
const shape = (newestFirst: Entry[], mails: ItemMail[] = []) =>
  groupTimeline(newestFirst, mails).map((b) => (b.kind === 'message' ? 'M' : b.kind === 'mail' ? 'Mail' : b.entries.length));

describe('groupTimeline', () => {
  it('fasst Änderungen derselben Person innert 2 Minuten zusammen', () => {
    const status = entry(2, { kind: 'status', meta: { from: 'Neu', to: 'In Arbeit' } });
    const title = entry(1, { meta: { field: 'title', from: 'A', to: 'B' } });
    expect(shape([entry(3), status, title])).toEqual([3]);
  });

  it('trennt bei grösserem Abstand, anderer Person oder einer Nachricht dazwischen', () => {
    expect(shape([entry(10), entry(1)])).toEqual([1, 1]);
    expect(shape([entry(2), entry(1, { author: ivan })])).toEqual([1, 1]);
    expect(shape([entry(3), entry(2, { kind: 'note', meta: null, body: 'x' }), entry(1)])).toEqual([1, 'M', 1]);
  });

  it('Regeln, Ablehnungen und automatische Statuswechsel stehen für sich', () => {
    const rule = entry(2, { author: null, meta: { field: 'rule', ruleName: 'R', changes: ['x'] } });
    const system = entry(1, { author: null, meta: { field: 'priority', from: 'Normal', to: 'Hoch' } });
    expect(shape([rule, system])).toEqual([1, 1]);
    const rejected = entry(2, { kind: 'status', meta: { rejected: true, from: 'Backlog', to: 'Abgelehnt' } });
    expect(shape([rejected, entry(1)])).toEqual([1, 1]);
  });

  it('zeigt ein mehrfach geändertes Feld einmal, vom ersten zum letzten Wert', () => {
    const blocks = groupTimeline([
      entry(3, { meta: { field: 'priority', from: 'Hoch', to: 'Niedrig' } }),
      entry(2, { kind: 'status', meta: { from: 'Neu', to: 'In Arbeit' } }),
      entry(1, { meta: { field: 'priority', from: 'Normal', to: 'Hoch' } }),
    ]);
    expect(blocks).toHaveLength(1);
    const entries = blocks[0]!.kind === 'events' ? blocks[0]!.entries : [];
    expect(entries.map((e) => eventPart(e).text)).toEqual([
      'die Priorität von «Normal» auf «Niedrig» geändert',
      'den Status von «Neu» auf «In Arbeit» geändert',
    ]);
    // Zeit der letzten Änderung
    expect(entries[0]!.createdAt).toBe(new Date(Date.UTC(2026, 9, 15, 10, 3)).toISOString());
  });

  it('lässt eine Änderung weg, die wieder beim Ausgangswert endet, und die Karte, wenn nichts übrig bleibt', () => {
    const back = [entry(2, { meta: { field: 'priority', from: 'Hoch', to: 'Normal' } }), entry(1)];
    expect(shape(back)).toEqual([]);
    expect(shape([entry(3, { kind: 'status', meta: { from: 'Neu', to: 'In Arbeit' } }), ...back])).toEqual([1]);
    const type = (minute: number, from: string, to: string, fromStatus: string, toStatus: string) =>
      entry(minute, { kind: 'type', meta: { from, to, fromStatus, toStatus } });
    // Störung → Aufgabe → Störung in einem anderen Status: als Statuswechsel
    const there = type(1, 'Störung', 'Aufgabe', 'Neu', 'Geplant');
    const blocks = groupTimeline([type(2, 'Aufgabe', 'Störung', 'Geplant', 'In Arbeit'), there]);
    expect(blocks[0]!.kind === 'events' && eventPart(blocks[0]!.entries[0]!).text).toBe('den Status von «Neu» auf «In Arbeit» geändert');
    expect(shape([type(2, 'Aufgabe', 'Störung', 'Geplant', 'Neu'), there])).toEqual([]);
    // Dreimal gewechselt: vom ersten zum letzten Typ und Status
    const thrice = groupTimeline([
      type(3, 'Störung', 'Aufgabe', 'Neu', 'Backlog'),
      type(2, 'Aufgabe', 'Störung', 'Geplant', 'Neu'),
      type(1, 'Störung', 'Aufgabe', 'Wartet', 'Geplant'),
    ]);
    expect(thrice[0]!.kind === 'events' && eventPart(thrice[0]!.entries[0]!).text).toBe(
      'den Typ von «Störung» auf «Aufgabe» geändert (Status «Wartet» → «Backlog»)',
    );
  });

  it('Status und Typ bilden eine Kette, wenn die Karte einen Typwechsel enthält', () => {
    const text = (newestFirst: Entry[]) =>
      groupTimeline(newestFirst).flatMap((b) => (b.kind === 'events' ? b.entries.map((e) => eventPart(e).text) : []));
    const type = (minute: number, from: string, to: string, fromStatus: string, toStatus: string) =>
      entry(minute, { kind: 'type', meta: { from, to, fromStatus, toStatus } });
    const status = (minute: number, from: string, to: string) => entry(minute, { kind: 'status', meta: { from, to } });
    // Störung → Aufgabe, Status gewechselt, zurück zur Störung: nur eine Statuszeile
    expect(
      text([type(3, 'Aufgabe', 'Störung', 'In Arbeit', 'In Arbeit'), status(2, 'Backlog', 'In Arbeit'), type(1, 'Störung', 'Aufgabe', 'Neu', 'Backlog')]),
    ).toEqual(['den Status von «Neu» auf «In Arbeit» geändert']);
    // Status, Typ hin, Status, Typ zurück: vom ersten zum letzten Status
    expect(
      text([
        type(4, 'Aufgabe', 'Störung', 'Erledigt', 'Gelöst'),
        status(3, 'In Arbeit', 'Erledigt'),
        type(2, 'Störung', 'Aufgabe', 'In Arbeit', 'In Arbeit'),
        status(1, 'Neu', 'In Arbeit'),
      ]),
    ).toEqual(['den Status von «Neu» auf «Gelöst» geändert']);
    // Typ bleibt geändert: eine Typzeile mit erstem und letztem Status
    expect(text([status(2, 'Backlog', 'In Arbeit'), type(1, 'Störung', 'Aufgabe', 'Neu', 'Backlog')])).toEqual([
      'den Typ von «Störung» auf «Aufgabe» geändert (Status «Neu» → «In Arbeit»)',
    ]);
  });

  it('Beschreibung einmal, Beteiligte und Ablehnungen bleiben einzeln, nur innerhalb von 2 Minuten', () => {
    const description = (minute: number) => entry(minute, { meta: { field: 'description' } });
    expect(shape([description(2), description(1)])).toEqual([1]);
    const added = (minute: number) => entry(minute, { meta: { field: 'participantAdded', to: 'Bea' } });
    const removed = entry(3, { meta: { field: 'participantRemoved', from: 'Bea' } });
    expect(shape([removed, added(2), added(1)])).toEqual([3]);
    expect(shape([entry(10, { meta: { field: 'priority', from: 'Hoch', to: 'Normal' } }), entry(1)])).toEqual([1, 1]);
  });

  it('reiht automatische Mails nach ihrer Zeit ein, ohne zusammengefasste Änderungen zu trennen', () => {
    // Änderungen um 10:01 und 10:03 bilden eine Karte (10:03); die Mail um 10:02 steht darunter
    const status = entry(3, { kind: 'status', meta: { from: 'In Arbeit', to: 'Erledigt' } });
    expect(shape([status, entry(1)], [mail(2)])).toEqual([2, 'Mail']);
    // Neuere Mail zuoberst, ältere zuunterst (z.B. Eingangsbestätigung), Reihenfolge der Mails unabhängig von der Eingabe
    const blocks = groupTimeline([entry(5), entry(2, { kind: 'note', meta: null, body: 'x' })], [mail(0, { label: 'Eingangsbestätigung' }), mail(9)]);
    expect(blocks.map((b) => (b.kind === 'mail' ? b.mail.label : b.kind))).toEqual(['Erledigt', 'events', 'message', 'Eingangsbestätigung']);
    // Gleiche Zeit: die Mail zuerst; ohne Einträge nur die Mails
    expect(shape([entry(4)], [mail(4)])).toEqual(['Mail', 1]);
    expect(shape([], [mail(1), mail(2)])).toEqual(['Mail', 'Mail']);
  });

  it('Empfänger einer Mail mit Namen, sonst mit Adresse', () => {
    expect(mailRecipientsText(mail(1))).toBe('an Anna Muster');
    expect(
      mailRecipientsText(mail(1, { cc: [{ email: 'carla@test.local', name: 'Carla Rossi' }, { email: 'extern@firma.ch', name: null }] })),
    ).toBe('an Anna Muster, CC Carla Rossi, CC extern@firma.ch');
  });

  it('Checklisten-Punkte: abgehakt, zurückgenommen, hin und zurück fällt weg', () => {
    const tick = (minute: number, itemId: string, text: string, from: boolean, to: boolean) =>
      entry(minute, { meta: { field: 'checklistItem', itemId, text, from, to } });
    const texts = (newestFirst: Entry[]) =>
      groupTimeline(newestFirst).flatMap((b) => (b.kind === 'events' ? b.entries.map((e) => asListItem(eventPart(e).text)) : []));
    expect(texts([tick(2, 'b', 'Mailbox einrichten', false, true), tick(1, 'a', 'AD-Konto anlegen', false, true)])).toEqual([
      'Punkt «Mailbox einrichten» abgehakt',
      'Punkt «AD-Konto anlegen» abgehakt',
    ]);
    expect(texts([tick(3, 'a', 'AD-Konto anlegen', true, false)])).toEqual(['Haken bei «AD-Konto anlegen» entfernt']);
    // Abgehakt und gleich wieder zurückgenommen: keine Zeile, der andere Punkt bleibt
    expect(
      texts([tick(3, 'a', 'AD-Konto anlegen', true, false), tick(2, 'b', 'Mailbox einrichten', false, true), tick(1, 'a', 'AD-Konto anlegen', false, true)]),
    ).toEqual(['Punkt «Mailbox einrichten» abgehakt']);
  });

  it('Fälligkeitsdatum gesetzt, geändert, entfernt; beim Typwechsel ausgeblendet', () => {
    const due = (from: string | null, to: string | null) => asListItem(eventPart(entry(1, { meta: { field: 'dueDate', from, to } })).text);
    expect(due(null, '24.10.2026')).toBe('Fälligkeitsdatum «24.10.2026» gesetzt');
    expect(due('24.10.2026', '31.10.2026')).toBe('Fälligkeitsdatum von «24.10.2026» auf «31.10.2026» geändert');
    expect(due('24.10.2026', null)).toBe('Fälligkeitsdatum «24.10.2026» entfernt');
    const type = (meta: Record<string, unknown>) =>
      eventPart(entry(1, { kind: 'type', meta: { from: 'Aufgabe', to: 'Störung', fromStatus: 'Backlog', toStatus: 'Neu', ...meta } })).text;
    expect(type({ dueDate: 'hidden' })).toMatch(/– Fälligkeitsdatum ausgeblendet, es bleibt gespeichert$/);
    expect(type({ checklists: 'hidden', dueDate: 'hidden' })).toMatch(/– Checklisten und Fälligkeitsdatum ausgeblendet, sie bleiben gespeichert$/);
    expect(type({ checklists: 'hidden' })).toMatch(/– Checklisten ausgeblendet, sie bleiben gespeichert$/);
    expect(type({ dueDate: 'shown' })).toMatch(/– Fälligkeitsdatum wieder eingeblendet$/);
  });

  it('Satzteile ohne «hat»', () => {
    expect(eventPart(entry(1)).text).toBe('die Priorität von «Normal» auf «Hoch» geändert');
  });

  it('Meldeweg geändert oder erstmals eingetragen', () => {
    expect(eventPart(entry(1, { meta: { field: 'channel', from: 'Telefon', to: 'Teams/Chat' } })).text).toBe(
      'den Meldeweg von «Telefon» auf «Teams/Chat» geändert',
    );
    expect(eventPart(entry(1, { meta: { field: 'channel', from: null, to: 'Telefon' } })).text).toBe('den Meldeweg «Telefon» eingetragen');
    expect(asListItem('den Meldeweg «Telefon» eingetragen')).toBe('Meldeweg «Telefon» eingetragen');
  });

  it('Verweis auf einen anderen Vorgang mit seinem Typ, gesperrte ohne Titel', () => {
    const link = (meta: Record<string, unknown>) => eventPart(entry(1, { kind: 'change', meta })).link;
    expect(link({ role: 'relates', otherNumber: 12, otherTitle: 'Drucker', refType: 'task' })).toEqual({
      prefix: 'PW',
      number: 12,
      type: 'task',
      hidden: false,
      text: 'PW-12 «Drucker»',
    });
    expect(link({ role: 'relates', otherNumber: 12, otherTitle: 'Drucker', refType: null })?.type).toBeNull();
    expect(link({ role: 'relates', otherNumber: 12, otherTitle: 'Drucker' })?.type).toBeUndefined();
    expect(link({ role: 'relates', otherNumber: 12, refHidden: true })).toEqual({
      prefix: 'PW',
      number: 12,
      type: undefined,
      hidden: true,
      text: 'PW-12',
    });
    const duplicate = eventPart(entry(1, { kind: 'status', meta: { from: 'Neu', to: 'Duplikat', duplicateOf: 5, refType: 'incident' } }));
    expect(duplicate.link).toEqual({ prefix: 'PW', number: 5, type: 'incident', hidden: false, text: 'Original PW-5' });
    // Seit 29.10.2026 mit Präfix, z.B. aus HelpSpot übernommene Vorgänge
    expect(link({ role: 'relates', otherNumber: 17223, otherPrefix: 'HS', otherTitle: 'Alt' })).toMatchObject({
      prefix: 'HS',
      number: 17223,
      text: 'HS-17223 «Alt»',
    });
  });

  it('Listenpunkte in der Karte ohne Artikel und gross geschrieben', () => {
    expect(asListItem('die Priorität von «Normal» auf «Hoch» geändert')).toBe('Priorität von «Normal» auf «Hoch» geändert');
    expect(asListItem('den Status von «Neu» auf «In Arbeit» geändert')).toBe('Status von «Neu» auf «In Arbeit» geändert');
    expect(asListItem('eine Verknüpfung entfernt: behebt')).toBe('Verknüpfung entfernt: behebt');
    expect(asListItem('«Luca Kühne» als zuständig gesetzt')).toBe('«Luca Kühne» als zuständig gesetzt');
    expect(asListItem('keine Eingangsbestätigung verschickt')).toBe('Keine Eingangsbestätigung verschickt');
    expect(asListItem('abgelehnt (Melder informiert)')).toBe('Abgelehnt (Melder informiert)');
  });
});
