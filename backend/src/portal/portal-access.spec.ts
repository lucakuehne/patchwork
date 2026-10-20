import { describe, expect, it } from 'vitest';
import type { PortalSettings } from '../settings/settings.service';
import { PortalAccessService } from './portal-access.service';

function setup(portal: PortalSettings, members: Record<string, boolean | null> = {}) {
  const checks: string[] = [];
  const settings = { get: async (key: string) => (key === 'portal' ? portal : { enabled: true }) };
  const ldap = {
    groupChecker: () => ({
      check: async (email: string) => {
        checks.push(email);
        // null = Verzeichnis antwortet nicht
        return email in members ? members[email]! : false;
      },
      close: async () => {},
    }),
  };
  return { service: new PortalAccessService(settings as never, ldap as never), checks };
}

const standard = (email: string) => ({ email, role: 'standard' as const });

describe('Portal freischalten', () => {
  it('lässt IT und Admins immer zu', async () => {
    const { service } = setup({ access: 'none', emails: [], groupDn: '' });
    expect(await service.allowed({ email: 'it@firma.ch', role: 'it' })).toBe(true);
    expect(await service.allowed({ email: 'admin@firma.ch', role: 'admin' })).toBe(true);
    expect(await service.allowed(standard('anna@firma.ch'))).toBe(false);
  });

  it('lässt bei «Für alle» alle zu', async () => {
    const { service } = setup({ access: 'all', emails: [], groupDn: '' });
    expect(await service.allowed(standard('anna@firma.ch'))).toBe(true);
  });

  it('lässt bei «Ausgewählte» die ausgewählten Personen und die Mitglieder der AD-Gruppe zu', async () => {
    const { service, checks } = setup(
      { access: 'selected', emails: ['anna@firma.ch'], groupDn: 'CN=Portal,DC=firma,DC=local' },
      { 'bob@firma.ch': true, 'carla@firma.ch': false },
    );
    expect(await service.allowed(standard('Anna@Firma.ch'))).toBe(true);
    expect(await service.allowed(standard('bob@firma.ch'))).toBe(true);
    expect(await service.allowed(standard('carla@firma.ch'))).toBe(false);
    // Das Ergebnis der Gruppe wird zwischengespeichert
    expect(await service.allowed(standard('bob@firma.ch'))).toBe(true);
    expect(checks).toEqual(['bob@firma.ch', 'carla@firma.ch']);
    service.forget();
    await service.allowed(standard('bob@firma.ch'));
    expect(checks).toEqual(['bob@firma.ch', 'carla@firma.ch', 'bob@firma.ch']);
  });

  it('lässt niemanden zu, wenn das Verzeichnis nicht antwortet, und fragt beim nächsten Mal neu', async () => {
    const { service, checks } = setup({ access: 'selected', emails: [], groupDn: 'CN=Portal' }, { 'dora@firma.ch': null });
    expect(await service.allowed(standard('dora@firma.ch'))).toBe(false);
    expect(await service.allowed(standard('dora@firma.ch'))).toBe(false);
    expect(checks).toEqual(['dora@firma.ch', 'dora@firma.ch']);
  });

  it('fragt ohne AD-Gruppe nicht im Verzeichnis nach', async () => {
    const { service, checks } = setup({ access: 'selected', emails: ['anna@firma.ch'], groupDn: '' });
    expect(await service.allowed(standard('bob@firma.ch'))).toBe(false);
    expect(checks).toEqual([]);
  });
});
