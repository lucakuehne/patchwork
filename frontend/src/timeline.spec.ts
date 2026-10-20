import { describe, expect, it } from 'vitest';
import { fillSnippet } from './snippets';
import { asListItem, eventPart, groupTimeline } from './timeline';
import type { Entry } from './types';

const ada = { id: 'ada', name: 'Ada Admin', email: 'ada@test.local', role: 'admin' as const };
const ivan = { id: 'ivan', name: 'Ivan IT', email: 'ivan@test.local', role: 'it' as const };
let n = 0;
const entry = (minute: number, patch: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`,
  kind: 'change',
  body: '',
  bodyHtml: null,
  meta: { field: 'priority', from: 'Normal', to: 'Hoch' },
  createdAt: new Date(Date.UTC(2026, 9, 15, 10, minute)).toISOString(),
  editedAt: null,
  author: ada,
  originalMessageId: null,
  delivery: null,
  attachments: [],
  ...patch,
});
const shape = (newestFirst: Entry[]) =>
  groupTimeline(newestFirst).map((b) => (b.kind === 'message' ? 'M' : b.entries.length));

describe('groupTimeline', () => {
  it('fasst Änderungen derselben Person innert 2 Minuten zusammen', () => {
    expect(shape([entry(3), entry(2), entry(1)])).toEqual([3]);
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

  it('Satzteile ohne «hat»', () => {
    expect(eventPart(entry(1)).text).toBe('die Priorität von «Normal» auf «Hoch» geändert');
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

describe('fillSnippet', () => {
  it('ersetzt Platzhalter, unbekannte bleiben stehen', () => {
    const text = fillSnippet('Guten Tag {{Melder}}, zu {{ nummer }} «{{Titel}}». {{Gruss}}, {{Bearbeiter}}', {
      reporter: 'Anna Muster',
      number: 42,
      title: 'VPN',
      editor: 'Ada',
    });
    expect(text).toBe('Guten Tag Anna Muster, zu PW-42 «VPN». {{Gruss}}, Ada');
  });
});
