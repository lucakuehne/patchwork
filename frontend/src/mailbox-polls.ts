import { formatDateTime } from './format';
import type { MailboxPoll, PollMailCounts } from './types';

/** Abrufprotokoll der Postfächer (Entscheid vom 13.11.2026): Texte einer Zeile */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const pollMailTotal = (m: PollMailCounts) => m.created + m.appended + m.ignored + m.duplicate + m.failed;

/** z.B. «3 Mails: 1 neuer Vorgang, 2 ignoriert» */
export function pollMailsText(m: PollMailCounts): string {
  const total = pollMailTotal(m);
  if (!total) return 'keine neuen Mails';
  const parts = [
    m.created ? count(m.created, 'neuer Vorgang', 'neue Vorgänge') : '',
    m.appended ? count(m.appended, 'in bestehenden Vorgang', 'in bestehende Vorgänge') : '',
    m.ignored ? `${m.ignored} ignoriert` : '',
    m.duplicate ? `${m.duplicate} schon vorhanden` : '',
    m.failed ? `${m.failed} fehlgeschlagen` : '',
  ].filter(Boolean);
  return `${count(total, 'Mail', 'Mails')}: ${parts.join(', ')}`;
}

/** Zeit des Abrufs; zusammengefasste von–bis, am selben Tag beim Ende nur die Uhrzeit */
export function pollTimeText(p: Pick<MailboxPoll, 'startedAt' | 'endedAt' | 'polls'>): string {
  const start = formatDateTime(p.startedAt);
  if (p.polls <= 1) return start;
  const end = formatDateTime(p.endedAt);
  const [startDay] = start.split(', ');
  const [endDay, endTime] = end.split(', ');
  return `${start} – ${endDay === startDay ? endTime : end}`;
}

/** Hauptteil der Zeile: Ergebnis und Mails */
export function pollResultText(p: Pick<MailboxPoll, 'polls' | 'mails' | 'error'>): string {
  if (p.polls > 1) return p.error ? `${p.polls} Abrufe mit Fehler` : `${p.polls} Abrufe ohne neue Mails`;
  if (!p.error) return pollMailsText(p.mails);
  // Ohne Mails sagt ein Fehler nichts darüber, ob es neue gegeben hätte
  return pollMailTotal(p.mails) ? `Fehler · ${pollMailsText(p.mails)}` : 'Fehler';
}

/** z.B. «0,4 s» oder «1 min 5 s» */
export function pollDurationText(ms: number): string {
  if (ms < 59_950) return `${(Math.round(ms / 100) / 10).toFixed(1).replace('.', ',')} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
