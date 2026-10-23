import type { User } from '../db/schema';

/** Rollen in der Willkommens-Mail ({{Rolle}}) */
export const WELCOME_ROLES: Record<'admin' | 'it', string> = { admin: 'Admin', it: 'IT' };

/**
 * Platzhalter der Willkommens-Mail: Name, Rolle, Benutzername und Art der Anmeldung, Link zu Patchwork. Nie ein Passwort.
 * AD-Konten melden sich mit dem Anmeldenamen aus dem Verzeichnis an (ohne den mit der E-Mail-Adresse), lokale Konten mit
 * der E-Mail-Adresse und einem Passwort, das sie separat erhalten.
 */
export function welcomeValues(
  user: Pick<User, 'firstName' | 'lastName' | 'name' | 'email' | 'role' | 'authSource'>,
  loginName: string | null,
  publicUrl: string,
): Record<string, string> {
  const ad = user.authSource === 'ldap';
  return {
    Vorname: user.firstName.trim() || user.name,
    Nachname: user.lastName.trim(),
    Rolle: user.role === 'admin' || user.role === 'it' ? WELCOME_ROLES[user.role] : '',
    Benutzername: (ad && loginName) || user.email,
    Anmeldung: ad
      ? 'mit deinem Windows-Konto (gleiches Passwort wie am Computer)'
      : 'mit deiner E-Mail-Adresse und dem Passwort, das du separat erhältst',
    Link: `${publicUrl.replace(/\/+$/, '')}/`,
  };
}
