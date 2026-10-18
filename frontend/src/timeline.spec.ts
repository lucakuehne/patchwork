import { describe, expect, it } from 'vitest';
import { fillSnippet } from './snippets';
import { eventPart, groupTimeline } from './timeline';
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
