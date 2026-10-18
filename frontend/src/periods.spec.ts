import { describe, expect, it } from 'vitest';
import { bucketFor, bucketLabel, customPeriod, isoWeek, periodText, presetPeriod, startOfWeek } from './periods';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
// Mittwoch, 15. Oktober 2026
const now = new Date(2026, 9, 15, 14, 30);

describe('Zeiträume', () => {
  it('Woche beginnt am Montag', () => {
    expect(startOfWeek(now)).toEqual(day(2026, 10, 12));
    expect(startOfWeek(day(2026, 10, 18))).toEqual(day(2026, 10, 12)); // Sonntag
    expect(presetPeriod('thisWeek', now)).toEqual({ from: day(2026, 10, 12), to: day(2026, 10, 19) });
    expect(presetPeriod('lastWeek', now)).toEqual({ from: day(2026, 10, 5), to: day(2026, 10, 12) });
  });

  it('Monat, Quartal und Jahr', () => {
    expect(presetPeriod('thisMonth', now)).toEqual({ from: day(2026, 10, 1), to: day(2026, 11, 1) });
    expect(presetPeriod('lastMonth', now)).toEqual({ from: day(2026, 9, 1), to: day(2026, 10, 1) });
    expect(presetPeriod('thisQuarter', now)).toEqual({ from: day(2026, 10, 1), to: day(2027, 1, 1) });
    expect(presetPeriod('lastQuarter', now)).toEqual({ from: day(2026, 7, 1), to: day(2026, 10, 1) });
    expect(presetPeriod('thisYear', now)).toEqual({ from: day(2026, 1, 1), to: day(2027, 1, 1) });
    expect(presetPeriod('lastYear', now)).toEqual({ from: day(2025, 1, 1), to: day(2026, 1, 1) });
  });

  it('Jahreswechsel bei «Letztes Quartal» und «Letzter Monat»', () => {
    const january = new Date(2027, 0, 10);
    expect(presetPeriod('lastQuarter', january)).toEqual({ from: day(2026, 10, 1), to: day(2027, 1, 1) });
    expect(presetPeriod('lastMonth', january)).toEqual({ from: day(2026, 12, 1), to: day(2027, 1, 1) });
  });

  it('Freier Zeitraum: beide Tage inklusive', () => {
    expect(customPeriod('2026-10-01', '2026-10-15')).toEqual({ from: day(2026, 10, 1), to: day(2026, 10, 16) });
    expect(customPeriod('2026-10-15', '2026-10-01')).toBeNull();
    expect(customPeriod('', '2026-10-01')).toBeNull();
    expect(periodText({ from: day(2026, 10, 1), to: day(2026, 10, 16) })).toBe('01.10.2026 – 15.10.2026');
  });

  it('Einteilung und Beschriftung', () => {
    expect(bucketFor(presetPeriod('thisMonth', now))).toBe('day');
    expect(bucketFor(presetPeriod('thisQuarter', now))).toBe('week');
    expect(bucketFor(presetPeriod('thisYear', now))).toBe('month');
    expect(bucketLabel('2026-10-12', 'day')).toBe('12.10.');
    expect(bucketLabel('2026-10-12', 'week')).toBe('KW 42');
    expect(bucketLabel('2026-10-01', 'month')).toBe('Okt 2026');
    expect(isoWeek(day(2027, 1, 1))).toBe(53);
  });
});
