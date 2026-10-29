/**
 * Zeiten aus der API von HelpSpot: formatiert in der Zeitzone von HelpSpot, z.B. «22. Oct 2026, 11:31 Uhr» (auf die
 * Minute) oder nur «22. Oct 2026». Englische und deutsche Monatsnamen; eine reine Zahl gilt als Unix-Zeit in Sekunden.
 */
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  mär: 2,
  apr: 3,
  may: 4,
  mai: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  okt: 9,
  nov: 10,
  dec: 11,
  dez: 11,
};

const FORMATTED = /^(\d{1,2})\.?\s*([a-zä]{3})[a-zä]*\.?\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?:\s*(uhr|am|pm))?)?$/i;

/** Abstand der Zeitzone zu UTC in Millisekunden an diesem Zeitpunkt */
function offsetAt(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
}

/** Ortszeit in der Zeitzone als Zeitpunkt (bei der Umstellung auf Sommerzeit die erste gültige Lesart) */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const local = Date.UTC(year, month, day, hour, minute);
  const first = local - offsetAt(local, timeZone);
  const second = local - offsetAt(first, timeZone);
  return new Date(second);
}

export function parseHelpSpotDate(value: unknown, timeZone = 'Europe/Zurich'): Date | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{9,11}$/.test(text)) return new Date(Number(text) * 1000);
  const m = FORMATTED.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (month === undefined) return null;
  let hour = m[4] ? Number(m[4]) : 0;
  const suffix = m[6]?.toLowerCase();
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  const date = zonedToUtc(Number(m[3]), month, Number(m[1]), hour, m[5] ? Number(m[5]) : 0, timeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}
