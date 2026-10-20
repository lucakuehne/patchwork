import type { User, UserRole } from '../db/schema';

/** Rolle eines AD-Kontos bei der Anmeldung: von Hand festgelegt oder aus den AD-Gruppen. */
export function roleAtLogin(existing: Pick<User, 'role' | 'roleManual'> | undefined, fromGroups: UserRole): UserRole {
  return existing?.roleManual ? existing.role : fromGroups;
}

/**
 * Hindert das Anlegen eines AD-Kontos für eine E-Mail-Adresse, die es schon gibt? Kontakte ohne Login (aus Mails)
 * werden übernommen, wie beim ersten Login; Konten mit Login nicht.
 */
export function directoryConflict(existing: Pick<User, 'authSource' | 'passwordHash'> | undefined): string | null {
  if (!existing) return null;
  if (existing.authSource !== 'local') return 'Diese Person ist bereits als Benutzer mit Anmeldung über das AD eingetragen.';
  if (existing.passwordHash) return 'Für diese E-Mail-Adresse besteht bereits ein lokales Konto.';
  return null;
}
