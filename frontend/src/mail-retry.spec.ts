import { describe, expect, it } from 'vitest';
import { retryDelays, retryPlanText } from './mail-retry';

describe('Wiederholungen beim Versand', () => {
  it('Vorgabe: verdoppelt bis 60 Minuten, Ablauf als Satz', () => {
    const s = { retries: 10, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 };
    expect(retryDelays(s)).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60, 60]);
    expect(retryPlanText(s)).toBe(
      'Wiederholungen nach 1, 2, 4, 8, 16 und 32 Minuten, danach 4-mal alle 60 Minuten. Die letzte kommt etwa 5 Stunden nach dem ersten Versuch.',
    );
  });

  it('fester Abstand, eine, keine, ohne Obergrenze', () => {
    expect(retryPlanText({ retries: 10, firstDelayMinutes: 5, doubling: false, maxDelayMinutes: 60 })).toBe(
      '10 Wiederholungen alle 5 Minuten. Die letzte kommt 50 Minuten nach dem ersten Versuch.',
    );
    expect(retryPlanText({ retries: 1, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 })).toBe('Eine Wiederholung nach 1 Minute.');
    expect(retryPlanText({ retries: 0, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 })).toMatch(/^Keine Wiederholungen/);
    expect(retryPlanText({ retries: 3, firstDelayMinutes: 10, doubling: true, maxDelayMinutes: 1440 })).toBe(
      'Wiederholungen nach 10, 20 und 40 Minuten. Die letzte kommt etwa 1 Stunde nach dem ersten Versuch.',
    );
    expect(retryPlanText({ retries: 20, firstDelayMinutes: 60, doubling: true, maxDelayMinutes: 1440 })).toMatch(/etwa \d+ Tage/);
  });
});
