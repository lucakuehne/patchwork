import { describe, expect, it } from 'vitest';
import { legacyLocation } from './legacy-urls';

describe('Frühere deutsche Adressen', () => {
  it('Pfade der Oberfläche', () => {
    expect(legacyLocation('/eingang', {})).toEqual({ path: '/inbox', query: {} });
    expect(legacyLocation('/stoerungen/geloest', {})).toEqual({ path: '/incidents/resolved', query: {} });
    expect(legacyLocation('/aufgaben/', {})).toEqual({ path: '/tasks', query: {} });
    expect(legacyLocation('/admin/e-mail-vorlagen', {})).toEqual({ path: '/admin/mail-templates', query: {} });
    expect(legacyLocation('/admin/status', {})).toEqual({ path: '/admin/statuses', query: {} });
    expect(legacyLocation('/portal/neu', {})).toEqual({ path: '/portal/new', query: {} });
  });

  it('Vorgang als Seite, auch aus Links in versendeten Mails', () => {
    expect(legacyLocation('/v/123', {})).toEqual({ path: '/items/PW-123', query: {} });
    expect(legacyLocation('/portal/v/7', {})).toEqual({ path: '/portal/items/PW-7', query: {} });
    // Ohne Präfix (bis 29.10.2026) bzw. klein geschrieben: volle Kennung
    expect(legacyLocation('/items/123', {})).toEqual({ path: '/items/PW-123', query: {} });
    expect(legacyLocation('/items/hs-5', {})).toEqual({ path: '/items/HS-5', query: {} });
    expect(legacyLocation('/portal/items/7', {})).toEqual({ path: '/portal/items/PW-7', query: {} });
    expect(legacyLocation('/items/PW-5', {})).toBeNull();
    expect(legacyLocation('/items/HS-17223', {})).toBeNull();
  });

  it('Parameter und Werte der Filter', () => {
    expect(legacyLocation('/aufgaben', { vorgang: '5' })).toEqual({ path: '/tasks', query: { item: 'PW-5' } });
    expect(legacyLocation('/tasks', { vorgang: '5' })).toEqual({ path: '/tasks', query: { item: 'PW-5' } });
    expect(legacyLocation('/tasks', { item: '5' })).toEqual({ path: '/tasks', query: { item: 'PW-5' } });
    expect(legacyLocation('/login', { weiter: '/aufgaben' })).toEqual({ path: '/login', query: { next: '/aufgaben' } });
    expect(legacyLocation('/admin/eingehende-mails', { ergebnis: 'fehler', herkunft: 'simuliert' })).toEqual({
      path: '/admin/incoming-mails',
      query: { result: 'failed', origin: 'simulated' },
    });
    expect(legacyLocation('/admin/ausgehende-mails', { status: 'nicht-versendet' })).toEqual({
      path: '/admin/outgoing-mails',
      query: { status: 'withheld' },
    });
    expect(legacyLocation('/admin/nicht-versendet', {})).toEqual({ path: '/admin/outgoing-mails', query: { status: 'withheld' } });
  });

  it('neue Adressen bleiben', () => {
    expect(legacyLocation('/tasks', { item: 'PW-5' })).toBeNull();
    expect(legacyLocation('/tasks', { item: 'HS-17223' })).toBeNull();
    expect(legacyLocation('/admin/outgoing-mails', { status: 'withheld' })).toBeNull();
    expect(legacyLocation('/search', { q: 'Drucker' })).toBeNull();
  });
});
