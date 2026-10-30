import { describe, expect, it } from 'vitest';
import { blockText, blockTriggers, circlesText, deliveryBlock, testModeText } from './test-mode';
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

  it('abweichende Auslöser je Block, gleiche Wahl wie der Block zählt nicht', () => {
    expect(
      testModeText({
        general: live,
        incident: { ...none, triggers: { reply: 'all', assigned: 'selected', confirmation: 'none' } },
        task: { ...live, triggers: { confirmation: 'none', reply: 'all' } },
      }),
    ).toBe(
      'Generell: alle Mails. Störungen: keine Mails, abweichend Öffentliche Antwort an alle, Zugewiesen nur an ausgewählte. ' +
        'Aufgaben: alle Mails, abweichend Eingangsbestätigung an niemanden.',
    );
    // «an alle» in einem Block, der ohnehin an alle geht, ist normaler Betrieb
    expect(testModeText({ general: live, incident: { ...live, triggers: { reply: 'all' } }, task: live })).toBeNull();
    // Gleiche Blöcke mit Abweichung: je Block, damit die Abweichung sichtbar bleibt
    const same = { ...live, triggers: { done: 'none' as const } };
    expect(testModeText({ general: live, incident: same, task: same })).toBe(
      'Generell: alle Mails. Störungen: alle Mails, abweichend Abgeschlossen an niemanden. Aufgaben: alle Mails, abweichend Abgeschlossen an niemanden.',
    );
  });

  it('Auslöser je Block: nur die, die dort vorkommen', () => {
    const keys = (b: 'general' | 'incident' | 'task') => blockTriggers(b).map((t) => t.value);
    expect(keys('general')).toContain('welcome');
    expect(keys('general')).not.toContain('done');
    expect(keys('incident')).not.toContain('dueReminder');
    expect(keys('task')).toContain('dueReminder');
    expect(keys('task')).not.toContain('welcome');
    expect(blockText('general', { ...live, triggers: { done: 'none' } })).toBe('alle Mails');
  });

  it('Block nach dem Typ des Vorgangs, im Eingang «Generell»', () => {
    expect(deliveryBlock('incident')).toBe('incident');
    expect(deliveryBlock('task')).toBe('task');
    expect(deliveryBlock(null)).toBe('general');
  });
});
