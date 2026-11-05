import { describe, expect, it } from 'vitest';
import { dueNow, dueOf, firstOpen, localTime, longestTaskTitle, nextOccurrence, taskTitle, upcoming, type Recurrence, type Schedule } from './recurrence';

/** Die ersten Termine ab «start» */
function first(rule: Recurrence, start: string, count = 4): string[] {
  const dates: string[] = [];
  let after: string | null = null;
  while (dates.length < count) {
    after = nextOccurrence(rule, start, after);
    dates.push(after);
  }
  return dates;
}

describe('Termine', () => {
  it('täglich bzw. alle N Tage ab dem Startdatum', () => {
    expect(first({ kind: 'daily', interval: 1 }, '2026-11-02', 3)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(first({ kind: 'daily', interval: 3 }, '2026-11-02', 3)).toEqual(['2026-11-02', '2026-11-05', '2026-11-08']);
    // Ab einem späteren Tag: im Takt des Startdatums
    expect(nextOccurrence({ kind: 'daily', interval: 3 }, '2026-11-02', '2026-11-06')).toBe('2026-11-08');
  });

  it('wöchentlich an Wochentagen, alle N Wochen ab der Woche des Startdatums', () => {
    // Start Mittwoch 04.11.2026: Mo und Mi alle zwei Wochen, der Montag vor dem Start zählt nicht
    expect(first({ kind: 'weekly', interval: 2, weekdays: [1, 3] }, '2026-11-04')).toEqual([
      '2026-11-04',
      '2026-11-16',
      '2026-11-18',
      '2026-11-30',
    ]);
    expect(first({ kind: 'weekly', interval: 1, weekdays: [5] }, '2026-11-02', 2)).toEqual(['2026-11-06', '2026-11-13']);
  });

  it('monatlich an einem Tag: fehlt er, der letzte Tag; −1 = letzter Tag; alle N Monate', () => {
    expect(first({ kind: 'monthlyDay', interval: 1, day: 31 }, '2026-12-01')).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
    expect(first({ kind: 'monthlyDay', interval: 1, day: -1 }, '2028-01-15', 2)).toEqual(['2028-01-31', '2028-02-29']);
    // Startdatum nach dem Tag: erst im nächsten Monat des Takts
    expect(first({ kind: 'monthlyDay', interval: 3, day: 1 }, '2026-11-02', 2)).toEqual(['2027-02-01', '2027-05-01']);
  });

  it('monatlich am n-ten bzw. letzten Wochentag', () => {
    // Patchday: zweiter Dienstag
    expect(first({ kind: 'monthlyWeekday', interval: 1, nth: 2, weekday: 2 }, '2026-11-02', 3)).toEqual([
      '2026-11-10',
      '2026-12-08',
      '2027-01-12',
    ]);
    expect(first({ kind: 'monthlyWeekday', interval: 1, nth: -1, weekday: 5 }, '2026-11-02', 2)).toEqual(['2026-11-27', '2026-12-25']);
    expect(first({ kind: 'monthlyWeekday', interval: 2, nth: 1, weekday: 1 }, '2026-11-03', 2)).toEqual(['2027-01-04', '2027-03-01']);
  });

  it('jährlich, der 29. Februar in anderen Jahren am 28.', () => {
    expect(first({ kind: 'yearly', interval: 1, month: 2, day: 29 }, '2026-11-02', 3)).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
    expect(first({ kind: 'yearly', interval: 2, month: 11, day: 1 }, '2026-11-02', 2)).toEqual(['2028-11-01', '2030-11-01']);
  });

  it('am Wochenende auf den Montag danach bzw. den Freitag davor verschoben, wenn gewählt', () => {
    expect(dueOf('2026-11-07', 'monday')).toBe('2026-11-09');
    expect(dueOf('2026-11-08', 'monday')).toBe('2026-11-09');
    expect(dueOf('2026-11-07', 'friday')).toBe('2026-11-06');
    expect(dueOf('2026-11-08', 'friday')).toBe('2026-11-06');
    expect(dueOf('2026-11-07', 'keep')).toBe('2026-11-07');
    expect(dueOf('2026-11-06', 'monday')).toBe('2026-11-06');
    expect(dueOf('2026-11-09', 'friday')).toBe('2026-11-09');
  });
});

describe('Anlegen', () => {
  const schedule = (s: Partial<Schedule> & Pick<Schedule, 'schedule'>): Schedule => ({
    startDate: '2026-11-02',
    endDate: null,
    weekend: 'keep',
    leadDays: 0,
    ...s,
  });
  const daily = schedule({ schedule: { kind: 'daily', interval: 1 } });

  it('Ortszeit in der Zeitzone der Anwendung', () => {
    expect(localTime(new Date('2026-11-02T05:30:00Z'), 'Europe/Zurich')).toEqual({ date: '2026-11-02', minutes: 390 });
    expect(localTime(new Date('2026-07-01T22:15:00Z'), 'Europe/Zurich')).toEqual({ date: '2026-07-02', minutes: 15 });
  });

  it('am Tag des Anlegens ab 06:00, mit Vorlauf entsprechend früher', () => {
    expect(dueNow(daily, '2026-11-02', { date: '2026-11-02', minutes: 5 * 60 + 59 })).toEqual({ create: [], nextOn: '2026-11-02' });
    expect(dueNow(daily, '2026-11-02', { date: '2026-11-02', minutes: 6 * 60 })).toEqual({
      create: [{ on: '2026-11-02', due: '2026-11-02', createOn: '2026-11-02' }],
      nextOn: '2026-11-03',
    });
    const patchday = schedule({ schedule: { kind: 'monthlyWeekday', interval: 1, nth: 2, weekday: 2 }, leadDays: 7 });
    expect(dueNow(patchday, '2026-11-10', { date: '2026-11-03', minutes: 7 * 60 }).create).toEqual([
      { on: '2026-11-10', due: '2026-11-10', createOn: '2026-11-03' },
    ]);
  });

  it('verpasste Termine (Fälligkeit vorbei) entfallen, Enddatum beendet', () => {
    expect(dueNow(daily, '2026-11-02', { date: '2026-11-05', minutes: 8 * 60 })).toEqual({
      create: [{ on: '2026-11-05', due: '2026-11-05', createOn: '2026-11-05' }],
      nextOn: '2026-11-06',
    });
    const ending = schedule({ schedule: { kind: 'daily', interval: 1 }, endDate: '2026-11-03' });
    expect(dueNow(ending, '2026-11-03', { date: '2026-11-03', minutes: 8 * 60 })).toEqual({
      create: [{ on: '2026-11-03', due: '2026-11-03', createOn: '2026-11-03' }],
      nextOn: null,
    });
  });

  it('Wochenende auf Montag: Samstag, Sonntag und Montag ergeben dieselbe Fälligkeit', () => {
    const workdays = schedule({ schedule: { kind: 'daily', interval: 1 }, weekend: 'monday', startDate: '2026-11-06' });
    const { create } = dueNow(workdays, '2026-11-06', { date: '2026-11-09', minutes: 7 * 60 });
    expect(create.map((o) => o.due)).toEqual(['2026-11-09', '2026-11-09', '2026-11-09']);
  });

  it('erster offener Termin: ab heute fällig und nach der letzten angelegten Fälligkeit', () => {
    expect(firstOpen(daily, '2026-11-04', null)).toBe('2026-11-04');
    expect(firstOpen(daily, '2026-11-04', '2026-11-05')).toBe('2026-11-06');
    // Samstag mit Fälligkeit Montag zählt am Sonntag noch
    const monthly = schedule({ schedule: { kind: 'monthlyDay', interval: 1, day: 7 }, weekend: 'monday' });
    expect(firstOpen(monthly, '2026-11-08', null)).toBe('2026-11-07');
    expect(firstOpen(schedule({ schedule: { kind: 'daily', interval: 1 }, endDate: '2026-11-03' }), '2026-11-04', null)).toBeNull();
  });

  it('Freitag davor: Monatsende am Sonntag ist am Freitag fällig und wird entsprechend früher angelegt', () => {
    const monthEnd = schedule({ schedule: { kind: 'monthlyDay', interval: 1, day: -1 }, weekend: 'friday', startDate: '2027-01-01' });
    // 31.01.2027 ist ein Sonntag
    expect(upcoming(monthEnd, firstOpen(monthEnd, '2027-01-28', null), 1)).toEqual([{ on: '2027-01-31', due: '2027-01-29', createOn: '2027-01-29' }]);
    // Am Fälligkeitstag nach dem Termin laut Rhythmus offen, aber noch nicht vorbei
    expect(firstOpen(monthEnd, '2027-01-29', null)).toBe('2027-01-31');
    expect(firstOpen(monthEnd, '2027-01-30', null)).toBe('2027-02-28');
    expect(dueNow(monthEnd, '2027-01-31', { date: '2027-01-29', minutes: 7 * 60 }).create.map((o) => o.due)).toEqual(['2027-01-29']);
  });

  it('Vorschau der nächsten Termine', () => {
    const monthly = schedule({ schedule: { kind: 'monthlyDay', interval: 1, day: 7 }, weekend: 'monday', leadDays: 2 });
    expect(upcoming(monthly, '2026-11-07', 2)).toEqual([
      { on: '2026-11-07', due: '2026-11-09', createOn: '2026-11-07' },
      { on: '2026-12-07', due: '2026-12-07', createOn: '2026-12-05' },
    ]);
  });
});

describe('Titel', () => {
  it('Platzhalter für den Termin laut Rhythmus', () => {
    expect(taskTitle('Patchday {{Monat}} {{Jahr}}', '2026-11-10')).toBe('Patchday November 2026');
    expect(taskTitle('{{Wochentag}}, {{Datum}} ({{Tag}}.) · KW {{woche}} · {{Quartal}}', '2027-01-01')).toBe(
      'Freitag, 01.01.2027 (1.) · KW 53 · Q1',
    );
    expect(taskTitle('Backup prüfen {{Unbekannt}}', '2026-11-10')).toBe('Backup prüfen {{Unbekannt}}');
  });

  it('längster möglicher Titel für die Höchstlänge (Entscheid vom 05.11.2026)', () => {
    expect(longestTaskTitle('Patchday {{Monat}} {{Jahr}}')).toBe('Patchday September 2026');
    expect(longestTaskTitle('{{Wochentag}} {{Datum}} KW {{Woche}} {{Quartal}} {{Tag}}')).toBe('Donnerstag 31.12.2026 KW 53 Q4 31');
    expect(longestTaskTitle('Ohne Platzhalter')).toBe('Ohne Platzhalter');
  });
});
