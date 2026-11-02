import { describe, expect, it } from 'vitest';
import { dayWithWeekday, describeRecurrence, leadText } from './recurrence-text';

describe('Rhythmus in Worten', () => {
  it('je Art, mit «alle N»', () => {
    expect(describeRecurrence({ kind: 'daily', interval: 1 }, 'keep')).toBe('Täglich');
    expect(describeRecurrence({ kind: 'daily', interval: 3 }, 'keep')).toBe('Alle 3 Tage');
    expect(describeRecurrence({ kind: 'weekly', interval: 1, weekdays: [2] }, 'keep')).toBe('Jede Woche am Dienstag');
    expect(describeRecurrence({ kind: 'weekly', interval: 2, weekdays: [1, 3, 5] }, 'keep')).toBe('Alle 2 Wochen am Mo, Mi, Fr');
    expect(describeRecurrence({ kind: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, 'keep')).toBe('Jede Woche am Montag bis Freitag');
    expect(describeRecurrence({ kind: 'monthlyDay', interval: 1, day: 1 }, 'keep')).toBe('Jeden Monat am 1.');
    expect(describeRecurrence({ kind: 'monthlyDay', interval: 3, day: -1 }, 'keep')).toBe('Alle 3 Monate am letzten Tag');
    expect(describeRecurrence({ kind: 'monthlyWeekday', interval: 1, nth: 2, weekday: 2 }, 'keep')).toBe('Jeden Monat am zweiten Dienstag');
    expect(describeRecurrence({ kind: 'monthlyWeekday', interval: 2, nth: -1, weekday: 5 }, 'keep')).toBe('Alle 2 Monate am letzten Freitag');
    expect(describeRecurrence({ kind: 'yearly', interval: 1, month: 3, day: 31 }, 'keep')).toBe('Jedes Jahr am 31. März');
  });

  it('Wochenende auf Montag bzw. Freitag, ausser bei wöchentlich', () => {
    expect(describeRecurrence({ kind: 'monthlyDay', interval: 1, day: 1 }, 'monday')).toBe('Jeden Monat am 1., am Wochenende am Montag danach');
    expect(describeRecurrence({ kind: 'monthlyDay', interval: 1, day: -1 }, 'friday')).toBe('Jeden Monat am letzten Tag, am Wochenende am Freitag davor');
    expect(describeRecurrence({ kind: 'weekly', interval: 1, weekdays: [6] }, 'monday')).toBe('Jede Woche am Samstag');
  });

  it('Vorlauf und Datum mit Wochentag', () => {
    expect(leadText(0)).toBe('am Tag der Fälligkeit');
    expect(leadText(1)).toBe('1 Tag vorher');
    expect(leadText(7)).toBe('7 Tage vorher');
    expect(dayWithWeekday('2026-11-10')).toBe('Di 10.11.2026');
    expect(dayWithWeekday('2026-11-08')).toBe('So 08.11.2026');
  });
});
