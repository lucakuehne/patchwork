import type { TargetsByType } from '../statuses/status-rules';
import type { RuleSchedule } from './rule-types';

const DAY_MS = 24 * 3600 * 1000;

/** Ganze Tage seit dem letzten Statuswechsel */
export const waitedDays = (statusChangedAt: Date, now: Date) => Math.floor((now.getTime() - statusChangedAt.getTime()) / DAY_MS);

/**
 * Gilt die Regel für einen Vorgang in diesem Status? Ja, wenn sie den Status nennt oder «Wartet auf den Melder» enthält
 * und der Status der Wartet-Status seines Typs ist («waitingId», fehlt bei Typen ohne Wartet-Status).
 */
export function scheduleCovers(schedule: RuleSchedule, statusId: string | null, waitingId: string | undefined): boolean {
  if (!statusId) return false;
  return schedule.statusIds.includes(statusId) || (schedule.waiting && statusId === waitingId);
}

/**
 * Status, in denen die Regeln greifen können: alle genannten Status und, sobald eine Regel «Wartet auf den Melder»
 * enthält, der Wartet-Status jedes Typs, der einen hat. Ein Status gehört zu genau einem Typ, deshalb genügt die
 * Vereinigung für die Auswahl der Vorgänge.
 */
export function scheduledStatusIds(schedules: RuleSchedule[], targets: TargetsByType): string[] {
  const ids = new Set(schedules.flatMap((s) => s.statusIds));
  if (schedules.some((s) => s.waiting)) {
    for (const own of Object.values(targets)) if (own.waiting) ids.add(own.waiting);
  }
  return [...ids];
}

/**
 * Zeitgesteuerte Regeln, die für einen Vorgang fällig sind: Regel gilt für seinen Status (siehe scheduleCovers),
 * Wartezeit erreicht und für diesen Aufenthalt im Status noch nicht ausgeführt. Reihenfolge wie übergeben.
 */
export function dueTimedRules<R extends { id: string; schedule: RuleSchedule | null }>(
  rules: R[],
  item: { statusId: string | null; statusChangedAt: Date },
  waitingId: string | undefined,
  now: Date,
  alreadyRun: ReadonlySet<string>,
): R[] {
  const waited = now.getTime() - item.statusChangedAt.getTime();
  return rules.filter(
    (r) =>
      r.schedule &&
      scheduleCovers(r.schedule, item.statusId, waitingId) &&
      waited >= r.schedule.days * DAY_MS &&
      !alreadyRun.has(r.id),
  );
}

/** Datum, an dem eine Regel mit dieser Wartezeit greift (z.B. für «schliessen wir am …») */
export const dueDate = (statusChangedAt: Date, days: number) => new Date(statusChangedAt.getTime() + days * DAY_MS);
