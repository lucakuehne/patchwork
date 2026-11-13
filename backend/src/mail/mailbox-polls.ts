import type { PollMailCounts } from '../db/schema';

/** Abrufprotokoll der Postfächer (Entscheid vom 13.11.2026): so lange aufbewahrt */
export const POLL_LOG_RETENTION_DAYS = 14;

/**
 * Gleichartige Abrufe kommen nur zur vorigen Zeile, wenn dazwischen höchstens so viel Zeit lag. Ein Unterbruch (Abruf
 * ausgeschaltet, Patchwork gestoppt) bleibt so als Lücke zwischen zwei Zeilen sichtbar.
 */
export const POLL_JOIN_GAP_MS = 5 * 60_000;

export interface PollEntry {
  startedAt: Date;
  endedAt: Date;
  mails: PollMailCounts;
  /** Fehler beim Abruf oder bei einer Mail; null = ok */
  error: string | null;
  /** «Jetzt abrufen» von …; null = automatisch */
  triggeredBy: string | null;
}

export const emptyPollCounts = (): PollMailCounts => ({ created: 0, appended: 0, ignored: 0, duplicate: 0, failed: 0 });

export const pollMailTotal = (m: PollMailCounts) => m.created + m.appended + m.ignored + m.duplicate + m.failed;

/**
 * Automatisch und ohne Mails: wird mit gleichen davor zu einer Zeile zusammengefasst (ohne Fehler oder mit derselben
 * Fehlermeldung, z.B. Postfach eine Stunde nicht erreichbar)
 */
export const isQuietPoll = (p: Pick<PollEntry, 'mails' | 'triggeredBy'>) => !p.triggeredBy && pollMailTotal(p.mails) === 0;

/** Kommt der Abruf zur vorigen Zeile (beide still mit demselben Ergebnis, ohne grössere Lücke)? */
export function joinsPrevious(previous: PollEntry | undefined, next: PollEntry): boolean {
  if (!previous || !isQuietPoll(previous) || !isQuietPoll(next) || previous.error !== next.error) return false;
  const gap = next.startedAt.getTime() - previous.endedAt.getTime();
  return gap <= POLL_JOIN_GAP_MS && next.startedAt.getTime() >= previous.startedAt.getTime();
}
