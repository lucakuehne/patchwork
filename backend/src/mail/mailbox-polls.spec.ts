import { describe, expect, it } from 'vitest';
import { emptyPollCounts, isQuietPoll, joinsPrevious, type PollEntry } from './mailbox-polls';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 8, minute, 0));
const poll = (minute: number, fields: Partial<PollEntry> = {}): PollEntry => ({
  startedAt: at(minute),
  endedAt: new Date(at(minute).getTime() + 300),
  mails: emptyPollCounts(),
  error: null,
  triggeredBy: null,
  ...fields,
});

describe('Abrufprotokoll', () => {
  it('fasst automatische Abrufe ohne Mails und ohne Fehler zusammen', () => {
    expect(isQuietPoll(poll(0))).toBe(true);
    expect(joinsPrevious(poll(0), poll(1))).toBe(true);
    // Zusammengefasste Zeile: Ende des letzten Abrufs zählt
    expect(joinsPrevious({ ...poll(0), endedAt: at(44) }, poll(45))).toBe(true);
  });

  it('fasst gleiche Fehler hintereinander zusammen, nicht aber verschiedene oder Fehler und Erfolg', () => {
    const failed = (minute: number, error = 'Anmeldung fehlgeschlagen') => poll(minute, { error });
    expect(isQuietPoll(failed(0))).toBe(true);
    expect(joinsPrevious(failed(0), failed(1))).toBe(true);
    expect(joinsPrevious(failed(0), failed(1, 'Server nicht erreichbar'))).toBe(false);
    expect(joinsPrevious(failed(0), poll(1))).toBe(false);
    expect(joinsPrevious(poll(0), failed(1))).toBe(false);
  });

  it('Abrufe mit Mails oder von Hand stehen einzeln', () => {
    const withMail = poll(1, { mails: { ...emptyPollCounts(), created: 1 } });
    const failedMail = poll(1, { mails: { ...emptyPollCounts(), failed: 1 }, error: 'Mail UID 2: kaputt' });
    const manual = poll(1, { triggeredBy: 'Ada Admin' });
    for (const p of [withMail, failedMail, manual]) {
      expect(isQuietPoll(p)).toBe(false);
      expect(joinsPrevious(poll(0), p)).toBe(false);
      expect(joinsPrevious(p, poll(2))).toBe(false);
    }
    expect(joinsPrevious(undefined, poll(0))).toBe(false);
  });

  it('nach einem Unterbruch von mehr als 5 Minuten beginnt eine neue Zeile', () => {
    expect(joinsPrevious(poll(0), poll(5))).toBe(true);
    expect(joinsPrevious(poll(0), poll(6))).toBe(false);
  });
});
