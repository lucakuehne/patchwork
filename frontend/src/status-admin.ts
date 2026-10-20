import { STATUS_TARGETS, TARGET_CLOSED } from './status-flow';
import type { StatusTarget, StatusTargets } from './types';

/** Kurze Namen der Ziele für Schilder und Legende (Verwaltung → Status); ausführlich siehe TARGET_LABELS */
export const TARGET_SHORT: Record<StatusTarget, string> = {
  start: 'Start',
  reply: 'nach Antwort',
  close: 'Schliessen',
  reject: 'Ablehnen',
  waiting: 'Wartet',
};

/** Marken der Ziele im Ablaufdiagramm (Start hat einen eigenen Startpunkt); ︎ verhindert Emoji-Darstellung */
export const TARGET_SYMBOLS: Record<Exclude<StatusTarget, 'start'>, string> = {
  reply: '↩︎',
  close: '✓',
  reject: '⊘',
  waiting: '⏸︎',
};

/** Ziele, die nicht derselbe Status sein dürfen (wie targetsProblem im Backend) */
const CONFLICTS: Record<StatusTarget, StatusTarget[]> = {
  start: ['waiting'],
  reply: ['waiting'],
  close: ['reject'],
  reject: ['close'],
  waiting: ['start', 'reply'],
};

/** Welche Ziele zeigen auf diesen Status? */
export function targetsOf(targets: StatusTargets, statusId: string): StatusTarget[] {
  return STATUS_TARGETS.filter((t) => targets[t] === statusId);
}

/**
 * Status, die für ein Ziel in Frage kommen: offen bzw. abgeschlossen wie verlangt und nicht der Status eines Ziels, mit
 * dem es sich ausschliesst (z.B. «Wartet auf den Melder» weder Start noch «nach Antwort»).
 */
export function targetOptions<T extends { id: string; closed: boolean }>(
  statuses: readonly T[],
  targets: StatusTargets,
  target: StatusTarget,
): T[] {
  const excluded = new Set(CONFLICTS[target].map((t) => targets[t]).filter(Boolean));
  return statuses.filter((s) => s.closed === TARGET_CLOSED[target] && !excluded.has(s.id));
}

/**
 * Ziele nach dem Löschen eines Status: Ziele, die auf ihn zeigen, erhalten die Wahl aus dem Lösch-Dialog (null = keiner,
 * leer bzw. nicht gewählt = vorerst ohne Status).
 */
export function targetsAfterRemoval(
  targets: StatusTargets,
  removedId: string,
  choices: Partial<Record<StatusTarget, string | null>>,
): StatusTargets {
  const result: StatusTargets = { ...targets };
  for (const target of targetsOf(targets, removedId)) {
    const choice = choices[target];
    if (choice) result[target] = choice;
    else delete result[target];
  }
  return result;
}
