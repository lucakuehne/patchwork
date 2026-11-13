import type { MailAttempt } from '../db/schema';

/**
 * Wiederholungen beim Versand (Entscheid vom 13.11.2026), einstellbar unter Verwaltung → Ausgehende Mails. Nach einem
 * Fehler steht die Mail auf «Fehler» und wird nach diesen Abständen erneut versucht; eine Änderung gilt sofort, auch
 * für Mails, die auf ihren nächsten Versuch warten.
 */
export interface MailRetrySettings {
  /** Anzahl Wiederholungen nach einem Fehler (0 = keine) */
  retries: number;
  /** Abstand vor der ersten Wiederholung in Minuten */
  firstDelayMinutes: number;
  /** Abstand jedes Mal verdoppeln … */
  doubling: boolean;
  /** … höchstens bis zu so vielen Minuten */
  maxDelayMinutes: number;
}

export const DEFAULT_MAIL_RETRY: MailRetrySettings = { retries: 10, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 };

/** Grenzen der Eingaben */
export const MAIL_RETRY_LIMITS = { retries: { min: 0, max: 20 }, minutes: { min: 1, max: 1440 } } as const;

/** Abstand vor der n-ten Wiederholung in Minuten (n ab 1); null = keine weitere */
export function retryDelayMinutes(settings: MailRetrySettings, n: number): number | null {
  if (n < 1 || n > settings.retries) return null;
  if (!settings.doubling) return settings.firstDelayMinutes;
  return Math.min(settings.firstDelayMinutes * 2 ** (n - 1), Math.max(settings.maxDelayMinutes, settings.firstDelayMinutes));
}

/**
 * Fehlversuche der laufenden Reihe am Ende des Protokolls: seit dem letzten «Erneut senden» (einschliesslich), sonst
 * seit dem ersten Versuch. Danach richtet sich die nächste Wiederholung.
 */
export function failuresInSeries(log: MailAttempt[]): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const attempt = log[i]!;
    if (attempt.result !== 'failed') break;
    n++;
    if (attempt.by) break;
  }
  return n;
}

/** Zeitpunkt des nächsten automatischen Versuchs nach den Fehlversuchen im Protokoll; null = keiner mehr */
export function nextAttemptAt(settings: MailRetrySettings, log: MailAttempt[]): Date | null {
  const last = log.at(-1);
  if (!last || last.result !== 'failed') return null;
  const delay = retryDelayMinutes(settings, failuresInSeries(log));
  return delay === null ? null : new Date(new Date(last.at).getTime() + delay * 60_000);
}
