export type PeriodKey =
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  thisWeek: 'Diese Woche',
  lastWeek: 'Letzte Woche',
  thisMonth: 'Dieser Monat',
  lastMonth: 'Letzter Monat',
  thisQuarter: 'Dieses Quartal',
  lastQuarter: 'Letztes Quartal',
  thisYear: 'Dieses Jahr',
  lastYear: 'Letztes Jahr',
  custom: 'Freier Zeitraum',
};

export type Bucket = 'day' | 'week' | 'month';

/** Zeitraum in lokaler Zeit: «from» inklusive, «to» exklusive */
export interface Period {
  from: Date;
  to: Date;
}

const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Montag der Woche (die Woche beginnt am Montag) */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function presetPeriod(key: Exclude<PeriodKey, 'custom'>, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  const quarter = Math.floor(m / 3) * 3;
  switch (key) {
    case 'thisWeek':
      return { from: startOfWeek(now), to: addDays(startOfWeek(now), 7) };
    case 'lastWeek':
      return { from: addDays(startOfWeek(now), -7), to: startOfWeek(now) };
    case 'thisMonth':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    case 'lastMonth':
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
    case 'thisQuarter':
      return { from: new Date(y, quarter, 1), to: new Date(y, quarter + 3, 1) };
    case 'lastQuarter':
      return { from: new Date(y, quarter - 3, 1), to: new Date(y, quarter, 1) };
    case 'thisYear':
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
    case 'lastYear':
      return { from: new Date(y - 1, 0, 1), to: new Date(y, 0, 1) };
  }
}

/** Freier Zeitraum aus zwei Tagen (YYYY-MM-DD), beide inklusive. null, wenn ungültig. */
export function customPeriod(fromDay: string, toDay: string): Period | null {
  const parse = (s: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  };
  const from = parse(fromDay);
  const to = parse(toDay);
  if (!from || !to || to < from) return null;
  return { from, to: addDays(to, 1) };
}

/** Einteilung des Verlaufs: bis gut einen Monat nach Tagen, bis ein halbes Jahr nach Wochen, sonst nach Monaten. */
export function bucketFor(p: Period): Bucket {
  const days = Math.round((p.to.getTime() - p.from.getTime()) / (24 * 3600 * 1000));
  if (days <= 31) return 'day';
  if (days <= 186) return 'week';
  return 'month';
}

/** Kalenderwoche nach ISO 8601 */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Beschriftung eines Abschnitts (Beginn als YYYY-MM-DD) */
export function bucketLabel(start: string, bucket: Bucket): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  if (bucket === 'day') return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
  if (bucket === 'week') return `KW ${isoWeek(new Date(y, m - 1, d))}`;
  return `${MONTHS[m - 1]} ${y}`;
}

/** Tag als YYYY-MM-DD in lokaler Zeit */
export function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «13.10.2026 – 19.10.2026» (letzter enthaltener Tag) */
export function periodText(p: Period): string {
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return `${fmt(p.from)} – ${fmt(addDays(p.to, -1))}`;
}
