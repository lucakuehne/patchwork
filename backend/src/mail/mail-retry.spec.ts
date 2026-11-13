import { describe, expect, it } from 'vitest';
import type { MailAttempt } from '../db/schema';
import { DEFAULT_MAIL_RETRY, failuresInSeries, nextAttemptAt, retryDelayMinutes } from './mail-retry';

const attempt = (at: string, result: MailAttempt['result'], by: string | null = null): MailAttempt => ({
  at,
  result,
  error: result === 'failed' ? 'Verbindung abgelehnt' : null,
  deliveredTo: [],
  mailbox: 'helpdesk@firma.test',
  by,
});

describe('Wiederholungen beim Versand', () => {
  it('Vorgabe: 10 Wiederholungen, ab 1 Minute verdoppelt bis höchstens 60 Minuten', () => {
    const delays = Array.from({ length: 11 }, (_, i) => retryDelayMinutes(DEFAULT_MAIL_RETRY, i + 1));
    expect(delays).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60, 60, null]);
  });

  it('fester Abstand, keine Wiederholungen, Obergrenze kleiner als der erste Abstand', () => {
    expect(retryDelayMinutes({ retries: 3, firstDelayMinutes: 5, doubling: false, maxDelayMinutes: 60 }, 3)).toBe(5);
    expect(retryDelayMinutes({ retries: 0, firstDelayMinutes: 5, doubling: true, maxDelayMinutes: 60 }, 1)).toBeNull();
    expect(retryDelayMinutes({ retries: 5, firstDelayMinutes: 30, doubling: true, maxDelayMinutes: 10 }, 2)).toBe(30);
  });

  it('Fehlversuche der laufenden Reihe: seit «Erneut senden» bzw. seit Beginn', () => {
    const t = (m: number) => `2026-11-13T10:${String(m).padStart(2, '0')}:00.000Z`;
    expect(failuresInSeries([])).toBe(0);
    expect(failuresInSeries([attempt(t(0), 'failed'), attempt(t(1), 'failed')])).toBe(2);
    expect(failuresInSeries([attempt(t(0), 'failed'), attempt(t(1), 'failed'), attempt(t(5), 'failed', 'Ada Admin')])).toBe(1);
    expect(failuresInSeries([attempt(t(0), 'failed'), attempt(t(1), 'sent')])).toBe(0);
  });

  it('nächster Versuch ab dem letzten Fehlversuch; nach der letzten Wiederholung keiner mehr', () => {
    const settings = { retries: 2, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 };
    const log = [attempt('2026-11-13T10:00:00.000Z', 'failed')];
    expect(nextAttemptAt(settings, log)?.toISOString()).toBe('2026-11-13T10:01:00.000Z');
    log.push(attempt('2026-11-13T10:01:00.000Z', 'failed'));
    expect(nextAttemptAt(settings, log)?.toISOString()).toBe('2026-11-13T10:03:00.000Z');
    log.push(attempt('2026-11-13T10:03:00.000Z', 'failed'));
    expect(nextAttemptAt(settings, log)).toBeNull();
    expect(nextAttemptAt(settings, [attempt('2026-11-13T10:00:00.000Z', 'sent')])).toBeNull();
  });
});
