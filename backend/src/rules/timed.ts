import type { StatusCategory } from '../db/schema';
import type { RuleSchedule } from './rule-types';

const DAY_MS = 24 * 3600 * 1000;

/** Ganze Tage seit dem letzten Statuswechsel */
export const waitedDays = (statusChangedAt: Date, now: Date) => Math.floor((now.getTime() - statusChangedAt.getTime()) / DAY_MS);

/**
 * Zeitgesteuerte Regeln, die für einen Vorgang fällig sind: richtige Status-Kategorie, Wartezeit
 * erreicht und für diesen Aufenthalt im Status noch nicht ausgeführt. Reihenfolge wie übergeben.
 */
export function dueTimedRules<R extends { id: string; schedule: RuleSchedule | null }>(
  rules: R[],
  item: { statusChangedAt: Date },
  category: StatusCategory,
  now: Date,
  alreadyRun: ReadonlySet<string>,
): R[] {
  const waited = now.getTime() - item.statusChangedAt.getTime();
  return rules.filter(
    (r) => r.schedule && r.schedule.category === category && waited >= r.schedule.days * DAY_MS && !alreadyRun.has(r.id),
  );
}

/** Datum, an dem eine Regel mit dieser Wartezeit greift (z.B. für «schliessen wir am …») */
export const dueDate = (statusChangedAt: Date, days: number) => new Date(statusChangedAt.getTime() + days * DAY_MS);
