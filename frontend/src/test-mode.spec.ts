import { describe, expect, it } from 'vitest';
import { circlesText, deliveryBlock, testModeText } from './test-mode';
import type { DeliveryScopes } from './types';

const live: DeliveryScopes = { staff: 'all', others: 'all' };
const none: DeliveryScopes = { staff: 'none', others: 'none' };
const selectedStaff: DeliveryScopes = { staff: 'selected', others: 'none' };

describe('Testbetrieb: Hinweis', () => {
  it('normaler Betrieb ohne Hinweis', () => {
    expect(testModeText({ general: live, incident: live, task: live })).toBeNull();
    expect(testModeText(undefined)).toBeNull();
  });

  it('alle Blöcke gleich: ein Satz wie bisher', () => {
    expect(testModeText({ general: none, incident: none, task: none })).toBe('Es werden keine Mails versendet.');
    expect(testModeText({ general: selectedStaff, incident: selectedStaff, task: selectedStaff })).toBe(
      'Es werden nur Mails an ausgewählte IT-Mitarbeitende versendet, die übrigen nicht.',
    );
  });

  it('Blöcke verschieden: je Block in der Reihenfolge der Einstellungen', () => {
    expect(testModeText({ general: none, incident: selectedStaff, task: live })).toBe(
      'Generell: keine Mails. Störungen: nur an ausgewählte IT-Mitarbeitende. Aufgaben: alle Mails.',
    );
  });

  it('kurzer Text je Block', () => {
    expect(circlesText({ staff: 'all', others: 'selected' })).toBe('nur an IT-Mitarbeitende und an ausgewählte Melder und Beteiligte');
    expect(circlesText(none)).toBe('keine Mails');
    expect(circlesText(live)).toBe('alle Mails');
  });

  it('Block nach dem Typ des Vorgangs, im Eingang «Generell»', () => {
    expect(deliveryBlock('incident')).toBe('incident');
    expect(deliveryBlock('task')).toBe('task');
    expect(deliveryBlock(null)).toBe('general');
  });
});
