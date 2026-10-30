import { describe, expect, it } from 'vitest';
import type { DeliveryCircles } from '../settings/settings.service';
import { deliveryBlock, deliveryFilter, isBlockLive, isLive, triggerCircles } from './test-delivery';

const staff = new Set(['ivan@firma.ch', 'ada@firma.ch']);
const circles = (patch: Partial<DeliveryCircles>): DeliveryCircles => ({
  staff: 'none',
  others: 'none',
  staffEmails: [],
  otherEmails: [],
  ...patch,
});
const receivers = (c: DeliveryCircles) =>
  ['ivan@firma.ch', 'ada@firma.ch', 'anna@kunde.ch', 'bob@kunde.ch'].filter(deliveryFilter(c, staff));

describe('Testbetrieb: Empfängerkreise', () => {
  it('beide Kreise «alle» ist der normale Betrieb des Blocks', () => {
    expect(isBlockLive({ staff: 'all', others: 'all' })).toBe(true);
    expect(isBlockLive({ staff: 'all', others: 'selected' })).toBe(false);
  });

  it('normaler Betrieb erst, wenn alle drei Blöcke «alle / alle» sind', () => {
    const live = { staff: 'all', others: 'all' } as const;
    expect(isLive({ general: live, incident: live, task: live })).toBe(true);
    expect(isLive({ general: live, incident: { staff: 'selected', others: 'none' }, task: live })).toBe(false);
    expect(isLive({ general: { staff: 'all', others: 'none' }, incident: live, task: live })).toBe(false);
  });

  it('Block nach dem Typ des Vorgangs, ohne Typ oder ohne Vorgang «Generell»', () => {
    expect(deliveryBlock('incident')).toBe('incident');
    expect(deliveryBlock('task')).toBe('task');
    expect(deliveryBlock(null)).toBe('general');
    expect(deliveryBlock(undefined)).toBe('general');
  });

  it('niemand, ausgewählte oder alle – je für IT-Mitarbeitende und die übrigen', () => {
    expect(receivers(circles({}))).toEqual([]);
    expect(receivers(circles({ staff: 'selected', staffEmails: ['Ivan@Firma.ch'] }))).toEqual(['ivan@firma.ch']);
    expect(receivers(circles({ staff: 'all' }))).toEqual(['ivan@firma.ch', 'ada@firma.ch']);
    expect(receivers(circles({ staff: 'all', others: 'selected', otherEmails: ['anna@kunde.ch'] }))).toEqual([
      'ivan@firma.ch',
      'ada@firma.ch',
      'anna@kunde.ch',
    ]);
    expect(receivers(circles({ others: 'all' }))).toEqual(['anna@kunde.ch', 'bob@kunde.ch']);
  });

  it('massgebend ist der Empfänger: eine ausgewählte Kundenadresse gilt nicht für IT-Mitarbeitende', () => {
    const c = circles({ others: 'selected', otherEmails: ['ivan@firma.ch', 'bob@kunde.ch'] });
    expect(receivers(c)).toEqual(['bob@kunde.ch']);
    expect(deliveryFilter(c, staff)(' BOB@kunde.ch ')).toBe(true);
  });
});

describe('Testbetrieb je Auslöser', () => {
  const live = { staff: 'all', others: 'all' } as const;

  it('ohne Abweichung (auch ohne Vorlage oder ältere Einstellung) gelten die Kreise des Blocks', () => {
    const block = circles({ staff: 'selected', staffEmails: ['ivan@firma.ch'] });
    expect(triggerCircles(block, 'reply')).toBe(block);
    expect(triggerCircles(block, null)).toBe(block);
    expect(triggerCircles({ ...block, triggers: { confirmation: 'none' } }, 'reply')).toEqual({ ...block, triggers: { confirmation: 'none' } });
  });

  it('abweichender Auslöser gilt für beide Kreise, «ausgewählte» mit den Personen des Blocks', () => {
    const block = circles({ staffEmails: ['ivan@firma.ch'], otherEmails: ['anna@kunde.ch'], triggers: { reply: 'all', assigned: 'selected' } });
    expect(receivers(block)).toEqual([]);
    expect(receivers(triggerCircles(block, 'reply'))).toEqual(['ivan@firma.ch', 'ada@firma.ch', 'anna@kunde.ch', 'bob@kunde.ch']);
    expect(receivers(triggerCircles(block, 'assigned'))).toEqual(['ivan@firma.ch', 'anna@kunde.ch']);
    const open = circles({ staff: 'all', others: 'all', triggers: { confirmation: 'none' } });
    expect(receivers(triggerCircles(open, 'confirmation'))).toEqual([]);
    expect(receivers(triggerCircles(open, 'done'))).toHaveLength(4);
  });

  it('normaler Betrieb nur, wenn kein Auslöser weniger als «an alle» bekommt', () => {
    expect(isLive({ general: live, incident: { ...live, triggers: { reply: 'all' } }, task: live })).toBe(true);
    expect(isLive({ general: live, incident: { ...live, triggers: { confirmation: 'none' } }, task: live })).toBe(false);
    expect(isLive({ general: live, incident: live, task: { ...live, triggers: { dueReminder: 'selected' } } })).toBe(false);
  });
});
