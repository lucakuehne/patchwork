import { describe, expect, it } from 'vitest';
import { incomingResultText } from './incoming';

const item = { number: 12, title: 'VPN', type: 'incident' as const };

describe('incomingResultText', () => {
  it('nennt den Vorgang', () => {
    expect(incomingResultText({ result: 'created', reason: null, item })).toBe('neuer Vorgang PW-12');
    expect(incomingResultText({ result: 'reply', reason: null, item })).toBe('Antwort in PW-12');
    expect(incomingResultText({ result: 'note', reason: null, item })).toBe('interne Notiz in PW-12');
  });

  it('nennt bei ignorierten Mails und Fehlern den Grund', () => {
    expect(incomingResultText({ result: 'ignored', reason: 'eigene Adresse', item: null })).toBe('ignoriert (eigene Adresse)');
    expect(incomingResultText({ result: 'failed', reason: 'Datenbank nicht erreichbar', item: null })).toBe(
      'Fehler (Datenbank nicht erreichbar)',
    );
  });
});
