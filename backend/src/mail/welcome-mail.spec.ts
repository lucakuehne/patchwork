import { describe, expect, it } from 'vitest';
import { composeMail, templateByKey } from './mail-templates';
import { welcomeValues } from './welcome-mail';

const user = (fields: Partial<Parameters<typeof welcomeValues>[0]> = {}) => ({
  firstName: 'Ivan',
  lastName: 'Informatik',
  name: 'Ivan Informatik',
  email: 'ivan@firma.ch',
  role: 'it' as const,
  authSource: 'local' as const,
  ...fields,
});

describe('Willkommens-Mail', () => {
  it('lokales Konto: E-Mail-Adresse als Benutzername, Passwort separat, Link zu Patchwork', () => {
    expect(welcomeValues(user(), null, 'https://patchwork.firma.local/')).toEqual({
      Vorname: 'Ivan',
      Nachname: 'Informatik',
      Rolle: 'IT',
      Benutzername: 'ivan@firma.ch',
      Anmeldung: 'mit deiner E-Mail-Adresse und dem Passwort, das du separat erhältst',
      Link: 'https://patchwork.firma.local/',
    });
  });

  it('AD-Konto: Anmeldename aus dem Verzeichnis, sonst die E-Mail-Adresse; Rolle Admin', () => {
    const ad = user({ authSource: 'ldap', role: 'admin' });
    expect(welcomeValues(ad, 'iinformatik', 'https://pw').Benutzername).toBe('iinformatik');
    expect(welcomeValues(ad, null, 'https://pw').Benutzername).toBe('ivan@firma.ch');
    expect(welcomeValues(ad, null, 'https://pw').Anmeldung).toMatch(/Windows-Konto/);
    expect(welcomeValues(ad, null, 'https://pw').Rolle).toBe('Admin');
  });

  it('Standardtext ohne Passwort, mit Link', () => {
    const template = templateByKey('welcome')!;
    const { text, html } = composeMail({ body: template.body!, link: '', footer: '' }, welcomeValues(user(), null, 'https://pw'));
    expect(text).toContain('Hallo Ivan');
    expect(text).toContain('Benutzername: ivan@firma.ch');
    expect(text).toContain('Patchwork öffnen: https://pw/');
    expect(text).not.toMatch(/Passwort:/);
    expect(html).toContain('href="https://pw/"');
    expect(template.standalone).toBe(true);
  });
});
