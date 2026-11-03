import { describe, expect, it } from 'vitest';
import { checklistItemAction, itemChangeAction, itemLabel, likePattern, resultLabel, toggled, userChangeAction } from './audit-text';

describe('Texte im Aktionsprotokoll', () => {
  it('Vorgang bearbeitet: die geänderten Felder', () => {
    expect(itemChangeAction({ priority: 'high' })).toBe('Priorität geändert');
    expect(itemChangeAction({ title: 'Neu', description: 'Text' })).toBe('Titel, Beschreibung geändert');
    // null (z.B. Zuständig entfernt) zählt als Änderung, fehlende Felder nicht
    expect(itemChangeAction({ assigneeId: null })).toBe('Zuständig geändert');
    expect(itemChangeAction({})).toBe('Vorgang bearbeitet');
  });

  it('Checklisten-Punkt und Benutzer', () => {
    expect(checklistItemAction({ done: true })).toBe('Checklisten-Punkt abgehakt');
    expect(checklistItemAction({ done: false })).toBe('Checklisten-Punkt wieder offen');
    expect(checklistItemAction({ text: 'Neu', done: true })).toBe('Checklisten-Punkt geändert');
    expect(userChangeAction({ role: 'it', active: false })).toBe('Benutzer geändert: Rolle, Aktiv');
    expect(userChangeAction({ name: 'Anna', password: 'geheim123456' })).toBe('Benutzer geändert: Name/E-Mail, Passwort gesetzt');
    expect(userChangeAction({ password: '' })).toBe('Benutzer geändert: Passwort entfernt');
    expect(toggled(true, 'an', 'aus')).toBe('an');
    expect(toggled(undefined, 'an', 'aus')).toBe('aus');
  });

  it('Objekte und Suche', () => {
    expect(itemLabel({ prefix: 'PW', number: 12, title: 'Drucker' })).toBe('PW-12 «Drucker»');
    expect(resultLabel({ id: 'x', name: 'Anna Muster' })).toBe('Anna Muster');
    expect(resultLabel({ label: 'Telefon' })).toBe('Telefon');
    expect(resultLabel({ name: '  ', title: 'Server' })).toBe('Server');
    expect(resultLabel(undefined)).toBe('');
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});
