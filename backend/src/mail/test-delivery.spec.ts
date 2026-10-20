import { describe, expect, it } from 'vitest';
import type { MailSettings } from '../settings/settings.service';
import { deliveryFilter, isLive } from './test-delivery';

const staff = new Set(['ivan@firma.ch', 'ada@firma.ch']);
const settings = (patch: Partial<MailSettings>): MailSettings => ({
  staff: 'none',
  others: 'none',
  staffEmails: [],
  otherEmails: [],
  ...patch,
});
const receivers = (s: MailSettings) =>
  ['ivan@firma.ch', 'ada@firma.ch', 'anna@kunde.ch', 'bob@kunde.ch'].filter(deliveryFilter(s, staff));

describe('Testbetrieb: Empfängerkreise', () => {
  it('beide Kreise «alle» ist der normale Betrieb', () => {
    expect(isLive({ staff: 'all', others: 'all' })).toBe(true);
    expect(isLive({ staff: 'all', others: 'selected' })).toBe(false);
  });

  it('niemand, ausgewählte oder alle – je für IT-Mitarbeitende und die übrigen', () => {
    expect(receivers(settings({}))).toEqual([]);
    expect(receivers(settings({ staff: 'selected', staffEmails: ['Ivan@Firma.ch'] }))).toEqual(['ivan@firma.ch']);
    expect(receivers(settings({ staff: 'all' }))).toEqual(['ivan@firma.ch', 'ada@firma.ch']);
    expect(receivers(settings({ staff: 'all', others: 'selected', otherEmails: ['anna@kunde.ch'] }))).toEqual([
      'ivan@firma.ch',
      'ada@firma.ch',
      'anna@kunde.ch',
    ]);
    expect(receivers(settings({ others: 'all' }))).toEqual(['anna@kunde.ch', 'bob@kunde.ch']);
  });

  it('massgebend ist der Empfänger: eine ausgewählte Kundenadresse gilt nicht für IT-Mitarbeitende', () => {
    const s = settings({ others: 'selected', otherEmails: ['ivan@firma.ch', 'bob@kunde.ch'] });
    expect(receivers(s)).toEqual(['bob@kunde.ch']);
    expect(deliveryFilter(s, staff)(' BOB@kunde.ch ')).toBe(true);
  });
});
