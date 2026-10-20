import { describe, expect, it } from 'vitest';
import { directoryConflict, roleAtLogin } from './user-roles';

describe('roleAtLogin', () => {
  it('nimmt die Rolle aus den AD-Gruppen, ausser sie ist von Hand festgelegt', () => {
    expect(roleAtLogin(undefined, 'it')).toBe('it');
    expect(roleAtLogin({ role: 'standard', roleManual: false }, 'it')).toBe('it');
    expect(roleAtLogin({ role: 'it', roleManual: false }, 'standard')).toBe('standard');
    expect(roleAtLogin({ role: 'it', roleManual: true }, 'standard')).toBe('it');
    expect(roleAtLogin({ role: 'standard', roleManual: true }, 'admin')).toBe('standard');
  });
});

describe('directoryConflict', () => {
  it('übernimmt Kontakte ohne Login, aber keine Konten mit Login', () => {
    expect(directoryConflict(undefined)).toBeNull();
    expect(directoryConflict({ authSource: 'local', passwordHash: null })).toBeNull();
    expect(directoryConflict({ authSource: 'local', passwordHash: 'hash' })).toMatch(/lokales Konto/);
    expect(directoryConflict({ authSource: 'ldap', passwordHash: null })).toMatch(/bereits/);
  });
});
