import { describe, expect, it } from 'vitest';
import { formatDuration, remainingMs } from './import-estimate';

const start = '2026-10-30T08:00:00.000Z';
const at = (minutes: number) => new Date(start).getTime() + minutes * 60_000;

describe('Hochrechnung des Imports', () => {
  it('rechnet die restlichen Tickets im bisherigen Tempo hoch', () => {
    // 1000 von 5000 in 40 Minuten: die restlichen 4000 brauchen noch 160 Minuten
    expect(remainingMs({ startedAt: start, total: 5000, processed: 1000 }, at(40))).toBe(160 * 60_000);
  });

  it('erst ab einigen Tickets und nur solange etwas fehlt', () => {
    expect(remainingMs({ startedAt: start, total: 5000, processed: 9 }, at(1))).toBeNull();
    expect(remainingMs({ startedAt: start, total: 0, processed: 0 }, at(1))).toBeNull();
    expect(remainingMs({ startedAt: start, total: 50, processed: 50 }, at(1))).toBeNull();
  });

  it('Dauer ungefähr, ab einer Stunde auf 5 Minuten gerundet', () => {
    expect(formatDuration(20_000)).toBe('weniger als 1 Min.');
    expect(formatDuration(25 * 60_000)).toBe('etwa 25 Min.');
    expect(formatDuration(132 * 60_000)).toBe('etwa 2 Std. 10 Min.');
    expect(formatDuration(119 * 60_000)).toBe('etwa 2 Std.');
  });
});
