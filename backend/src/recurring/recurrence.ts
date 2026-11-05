import { fill } from '../mail/mail-templates';

/**
 * Rhythmus wiederkehrender Aufgaben (seit 02.11.2026). Termine sind Daten «JJJJ-MM-TT» ohne Uhrzeit; gerechnet wird in
 * UTC, damit die Umstellung auf Sommer- bzw. Winterzeit keine Rolle spielt. Wochentage: 1 = Montag … 7 = Sonntag.
 */
export type Recurrence =
  /** alle N Tage */
  | { kind: 'daily'; interval: number }
  /** alle N Wochen an den gewählten Wochentagen */
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  /** alle N Monate an einem Tag (1–31, −1 = letzter Tag); hat ein Monat den Tag nicht, gilt sein letzter Tag */
  | { kind: 'monthlyDay'; interval: number; day: number }
  /** alle N Monate am n-ten Wochentag (1–4, −1 = letzter), z.B. am zweiten Dienstag */
  | { kind: 'monthlyWeekday'; interval: number; nth: number; weekday: number }
  /** alle N Jahre an einem Datum; der 29. Februar gilt in anderen Jahren als 28. Februar */
  | { kind: 'yearly'; interval: number; month: number; day: number };

/** Termin am Wochenende: bleibt, rückt auf den Montag danach oder auf den Freitag davor */
export type WeekendRule = 'keep' | 'monday' | 'friday';

/** Ab dieser Stunde (Ortszeit) entstehen die Aufgaben eines Tages, vor der Mail bei Fälligkeit um 07:00 */
export const CREATE_HOUR = 6;

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const yearMonth = (date: string) => [Number(date.slice(0, 4)), Number(date.slice(5, 7))] as const;

export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY_MS);
const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
export const weekdayOf = (date: string) => ((new Date(toMs(date)).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Termin eines Monats bei «monatlich» (month: 1–12) */
function dayInMonth(rule: Extract<Recurrence, { kind: 'monthlyDay' | 'monthlyWeekday' }>, year: number, month: number): string {
  const last = daysInMonth(year, month);
  if (rule.kind === 'monthlyDay') return ymd(year, month, rule.day === -1 ? last : Math.min(rule.day, last));
  if (rule.nth === -1) return ymd(year, month, last - ((weekdayOf(ymd(year, month, last)) - rule.weekday + 7) % 7));
  return ymd(year, month, 1 + ((rule.weekday - weekdayOf(ymd(year, month, 1)) + 7) % 7) + (rule.nth - 1) * 7);
}

/** Monat «index» Monate nach dem Monat von «date» */
function monthAfter(date: string, index: number): [number, number] {
  const [year, month] = yearMonth(date);
  const months = year * 12 + (month - 1) + index;
  return [Math.floor(months / 12), (months % 12) + 1];
}

/**
 * Erster Termin ab «start», der nach «after» liegt (ohne «after»: der erste ab «start»). Die Abstände («alle N») zählen
 * ab dem Startdatum: bei Wochen ab dessen Woche, bei Monaten und Jahren ab dessen Monat bzw. Jahr.
 */
export function nextOccurrence(rule: Recurrence, start: string, after: string | null): string {
  const from = after && after >= start ? addDays(after, 1) : start;
  switch (rule.kind) {
    case 'daily':
      return addDays(start, Math.ceil(daysBetween(start, from) / rule.interval) * rule.interval);
    case 'weekly': {
      const startMonday = addDays(start, 1 - weekdayOf(start));
      // Innerhalb von «interval» Wochen plus einer liegt immer ein Termin
      for (let i = 0; ; i++) {
        const date = addDays(from, i);
        const week = Math.floor(daysBetween(startMonday, date) / 7);
        if (week % rule.interval === 0 && rule.weekdays.includes(weekdayOf(date))) return date;
        if (i > 7 * (rule.interval + 1)) throw new Error('Wöchentlicher Rhythmus ohne Wochentag');
      }
    }
    case 'monthlyDay':
    case 'monthlyWeekday': {
      const [fromYear, fromMonth] = yearMonth(from);
      const [startYear, startMonth] = yearMonth(start);
      let index = Math.ceil(((fromYear - startYear) * 12 + fromMonth - startMonth) / rule.interval) * rule.interval;
      for (;;) {
        const date = dayInMonth(rule, ...monthAfter(start, index));
        if (date >= from) return date;
        index += rule.interval;
      }
    }
    case 'yearly': {
      const startYear = Number(start.slice(0, 4));
      let year = startYear + Math.ceil((Number(from.slice(0, 4)) - startYear) / rule.interval) * rule.interval;
      for (;;) {
        const date = ymd(year, rule.month, Math.min(rule.day, daysInMonth(year, rule.month)));
        if (date >= from) return date;
        year += rule.interval;
      }
    }
  }
}

/** Fälligkeit eines Termins: am Wochenende je nach Wahl auf den Montag danach oder den Freitag davor verschoben */
export function dueOf(occurrence: string, weekend: WeekendRule): string {
  const day = weekdayOf(occurrence);
  if (day < 6 || weekend === 'keep') return occurrence;
  return weekend === 'monday' ? addDays(occurrence, 8 - day) : addDays(occurrence, 5 - day);
}

/** Datum und Minuten seit Mitternacht in der Zeitzone der Anwendung */
export function localTime(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { date: ymd(get('year'), get('month'), get('day')), minutes: get('hour') * 60 + get('minute') };
}

export interface Schedule {
  schedule: Recurrence;
  startDate: string;
  endDate: string | null;
  weekend: WeekendRule;
  /** So viele Tage vor der Fälligkeit anlegen */
  leadDays: number;
}

export interface Occurrence {
  /** Termin laut Rhythmus */
  on: string;
  /** Fälligkeit (Termin, vom Wochenende verschoben) */
  due: string;
  /** Tag, an dem die Aufgabe entsteht (ab CREATE_HOUR Uhr) */
  createOn: string;
}

const occurrence = (s: Schedule, on: string): Occurrence => {
  const due = dueOf(on, s.weekend);
  return { on, due, createOn: addDays(due, -s.leadDays) };
};

/**
 * Nächster Termin, dessen Aufgabe noch fehlt: fällig ab «today» und nach der letzten angelegten Fälligkeit «lastDue».
 * null, wenn das Enddatum erreicht ist. Fälligkeiten steigen mit den Terminen (verschoben wird höchstens zwei Tage, über
 * das Wochenende hinweg).
 */
export function firstOpen(s: Schedule, today: string, lastDue: string | null): string | null {
  // Ein Termin am Wochenende kann bis zu zwei Tage vor bzw. nach seiner Fälligkeit liegen
  let on = nextOccurrence(s.schedule, s.startDate, addDays(today, -3));
  for (let i = 0; i < 1000; i++) {
    if (s.endDate && on > s.endDate) return null;
    const due = dueOf(on, s.weekend);
    if (due >= today && (!lastDue || due > lastDue)) return on;
    on = nextOccurrence(s.schedule, s.startDate, on);
  }
  return null;
}

/** Termin nach «on» oder null, wenn er nach dem Enddatum läge */
export function following(s: Schedule, on: string): string | null {
  const next = nextOccurrence(s.schedule, s.startDate, on);
  return s.endDate && next > s.endDate ? null : next;
}

/**
 * Durchlauf: Termine ab «nextOn», deren Aufgabe jetzt entsteht (ab CREATE_HOUR Uhr am Tag «createOn»), und der nächste
 * Termin danach. Termine, deren Fälligkeit schon vorbei ist (z.B. weil der Server aus war), entfallen.
 */
export function dueNow(s: Schedule, nextOn: string, now: { date: string; minutes: number }): { create: Occurrence[]; nextOn: string | null } {
  const create: Occurrence[] = [];
  let on: string | null = nextOn;
  for (let i = 0; on && i < 1000; i++) {
    const o = occurrence(s, on);
    if (o.createOn > now.date || (o.createOn === now.date && now.minutes < CREATE_HOUR * 60)) break;
    if (o.due >= now.date) create.push(o);
    on = following(s, on);
  }
  return { create, nextOn: on };
}

/** Die nächsten Termine ab «nextOn» (Vorschau) */
export function upcoming(s: Schedule, nextOn: string | null, count: number): Occurrence[] {
  const list: Occurrence[] = [];
  for (let on = nextOn; on && list.length < count; on = following(s, on)) list.push(occurrence(s, on));
  return list;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Kalenderwoche nach ISO 8601 */
function isoWeek(date: string): number {
  const thursday = addDays(date, 4 - weekdayOf(date));
  return Math.floor(daysBetween(`${thursday.slice(0, 4)}-01-01`, thursday) / 7) + 1;
}

/**
 * Platzhalter für den Titel, bezogen auf den Termin laut Rhythmus (nicht die vom Wochenende verschobene Fälligkeit):
 * «Monatsabschluss {{Monat}}» am 31.01. bleibt «Januar», auch wenn die Aufgabe am 01.02. fällig ist.
 */
export function dateValues(on: string): Record<string, string> {
  const [year, month] = yearMonth(on);
  const day = Number(on.slice(8, 10));
  return {
    Datum: `${pad(day)}.${pad(month)}.${year}`,
    Tag: String(day),
    Wochentag: WEEKDAYS[weekdayOf(on) - 1]!,
    Woche: String(isoWeek(on)),
    Monat: MONTHS[month - 1]!,
    Quartal: `Q${Math.ceil(month / 3)}`,
    Jahr: String(year),
  };
}

/** Längster mögliche Titel einer Vorlage: jeder Platzhalter mit seinem längsten Wert (für die Höchstlänge) */
export function longestTaskTitle(template: string): string {
  const longest = (list: string[]) => list.reduce((a, b) => (b.length > a.length ? b : a));
  return fill(template, {
    Datum: '31.12.2026',
    Tag: '31',
    Wochentag: longest(WEEKDAYS),
    Woche: '53',
    Monat: longest(MONTHS),
    Quartal: 'Q4',
    Jahr: '2026',
  }).trim();
}

/** Titel der Aufgabe zu einem Termin, z.B. «Patchday {{Monat}} {{Jahr}}» → «Patchday November 2026» */
export function taskTitle(template: string, on: string): string {
  return fill(template, dateValues(on)).trim().slice(0, 500);
}
