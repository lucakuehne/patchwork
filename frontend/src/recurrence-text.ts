import { formatDay } from './format';
import type { Recurrence, WeekendRule } from './types';

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** n-te Woche im Monat; −1 = letzte */
export const NTH_LABELS: [number, string][] = [
  [1, 'ersten'],
  [2, 'zweiten'],
  [3, 'dritten'],
  [4, 'vierten'],
  [-1, 'letzten'],
];

/** Platzhalter für den Titel einer wiederkehrenden Aufgabe (wie im Backend, bezogen auf den Termin laut Rhythmus) */
export const TITLE_PLACEHOLDERS = ['Datum', 'Tag', 'Wochentag', 'Woche', 'Monat', 'Quartal', 'Jahr'];

function weekdayList(days: number[]): string {
  if (days.length === 1) return WEEKDAYS[days[0]! - 1]!;
  if (days.join() === '1,2,3,4,5') return 'Montag bis Freitag';
  return days.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ');
}

/** Rhythmus in Worten, z.B. «Jeden Monat am zweiten Dienstag» */
export function describeRecurrence(r: Recurrence, weekend: WeekendRule): string {
  const every = (one: string, many: string) => (r.interval === 1 ? one : `Alle ${r.interval} ${many}`);
  let text: string;
  switch (r.kind) {
    case 'daily':
      text = every('Täglich', 'Tage');
      break;
    case 'weekly':
      text = `${every('Jede Woche', 'Wochen')} am ${weekdayList(r.weekdays)}`;
      break;
    case 'monthlyDay':
      text = `${every('Jeden Monat', 'Monate')} am ${r.day === -1 ? 'letzten Tag' : `${r.day}.`}`;
      break;
    case 'monthlyWeekday':
      text = `${every('Jeden Monat', 'Monate')} am ${NTH_LABELS.find(([n]) => n === r.nth)?.[1] ?? ''} ${WEEKDAYS[r.weekday - 1]}`;
      break;
    case 'yearly':
      text = `${every('Jedes Jahr', 'Jahre')} am ${r.day}. ${MONTHS[r.month - 1]}`;
      break;
  }
  // Wöchentlich wählt man die Wochentage selbst
  if (r.kind !== 'weekly' && weekend !== 'keep') text += weekend === 'monday' ? ', am Wochenende am Montag danach' : ', am Wochenende am Freitag davor';
  return text;
}

/** Wann die Aufgabe entsteht, z.B. «3 Tage vorher» */
export function leadText(leadDays: number): string {
  if (leadDays === 0) return 'am Tag der Fälligkeit';
  return leadDays === 1 ? '1 Tag vorher' : `${leadDays} Tage vorher`;
}

/** Datum JJJJ-MM-TT mit Wochentag, z.B. «Di 10.11.2026» */
export function dayWithWeekday(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAYS_SHORT[weekday]} ${formatDay(date)}`;
}
