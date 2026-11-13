import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';
import { pollDurationText, pollMailsText, pollResultText, pollTimeText } from './mailbox-polls';

const none = { created: 0, appended: 0, ignored: 0, duplicate: 0, failed: 0 };

describe('Abrufprotokoll', () => {
  it('Mails nach Ergebnis', () => {
    expect(pollMailsText(none)).toBe('keine neuen Mails');
    expect(pollMailsText({ ...none, created: 1 })).toBe('1 Mail: 1 neuer Vorgang');
    expect(pollMailsText({ created: 2, appended: 1, ignored: 1, duplicate: 1, failed: 1 })).toBe(
      '6 Mails: 2 neue Vorgänge, 1 in bestehenden Vorgang, 1 ignoriert, 1 schon vorhanden, 1 fehlgeschlagen',
    );
  });

  it('Ergebnis: zusammengefasst, Fehler mit und ohne Mails', () => {
    expect(pollResultText({ polls: 46, mails: none, error: null })).toBe('46 Abrufe ohne neue Mails');
    expect(pollResultText({ polls: 61, mails: none, error: 'Server nicht erreichbar' })).toBe('61 Abrufe mit Fehler');
    expect(pollResultText({ polls: 1, mails: none, error: 'Anmeldung fehlgeschlagen' })).toBe('Fehler');
    expect(pollResultText({ polls: 1, mails: { ...none, created: 1, failed: 1 }, error: 'Mail UID 2: kaputt' })).toBe(
      'Fehler · 2 Mails: 1 neuer Vorgang, 1 fehlgeschlagen',
    );
  });

  it('Zeit: einzeln, von–bis am selben Tag und über Mitternacht', () => {
    const start = '2026-11-13T07:00:00Z';
    expect(pollTimeText({ startedAt: start, endedAt: start, polls: 1 })).toBe(formatDateTime(start));
    const sameDay = pollTimeText({ startedAt: start, endedAt: '2026-11-13T07:45:00Z', polls: 46 });
    expect(sameDay).toMatch(/^13\.11\.2026, \d\d:\d\d – \d\d:\d\d$/);
    const nextDay = pollTimeText({ startedAt: '2026-11-13T22:30:00Z', endedAt: '2026-11-14T22:30:00Z', polls: 1441 });
    expect(nextDay).toMatch(/^\d\d\.11\.2026, \d\d:\d\d – \d\d\.11\.2026, \d\d:\d\d$/);
  });

  it('Dauer', () => {
    expect(pollDurationText(350)).toBe('0,4 s');
    expect(pollDurationText(12_340)).toBe('12,3 s');
    expect(pollDurationText(65_000)).toBe('1 min 5 s');
  });
});
