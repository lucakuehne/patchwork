import { describe, expect, it } from 'vitest';
import { parseHelpSpotDate } from './helpspot-dates';

describe('Zeiten aus HelpSpot', () => {
  it('liest Datum und Uhrzeit in der Zeitzone von HelpSpot (Sommer- und Winterzeit)', () => {
    expect(parseHelpSpotDate('22. Oct 2026, 11:31 Uhr')?.toISOString()).toBe('2026-10-22T09:31:00.000Z');
    expect(parseHelpSpotDate('5. Jan 2026, 08:05 Uhr')?.toISOString()).toBe('2026-01-05T07:05:00.000Z');
    expect(parseHelpSpotDate('5. Mai 2025, 14:00')?.toISOString()).toBe('2025-05-05T12:00:00.000Z');
    expect(parseHelpSpotDate('3. Dec 2024, 1:15 pm')?.toISOString()).toBe('2024-12-03T12:15:00.000Z');
  });

  it('nur das Datum: Mitternacht in der Zeitzone', () => {
    expect(parseHelpSpotDate('22. Oct 2026')?.toISOString()).toBe('2026-10-21T22:00:00.000Z');
  });

  it('Unix-Zeit in Sekunden', () => {
    expect(parseHelpSpotDate('1793087975')?.toISOString()).toBe(new Date(1793087975 * 1000).toISOString());
  });

  it('Unlesbares ergibt null', () => {
    for (const value of ['', null, undefined, 'gestern', '22. Foo 2026', '22 2026']) expect(parseHelpSpotDate(value)).toBeNull();
  });
});
