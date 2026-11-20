import type { UserRole } from '../db/schema';

// Eigene Datei ohne Services: settings.service.ts braucht die Vorgabe, areas.ts den SettingsService (sonst Zirkelimport)
/**
 * Rechte je Rolle (Verwaltung → Rechte, Entscheid vom 20.11.2026; ersetzt die «Bereiche der IT» vom 23.10.2026).
 * Die Rollen bleiben Admin, IT und Standard. Admins haben immer alle Rechte, Standard-Benutzer keine (nur das Portal),
 * die Rechte der IT stellt man ein. «Verwaltung» umfasst alles unter Verwaltung und die übrigen Admin-Funktionen
 * (Hinweise oben, im Namen schreiben, Antworten simulieren, als dieser Benutzer arbeiten).
 *
 * Bereiche der Oberfläche folgen aus den Rechten: Eingang (Vorgänge ohne Typ), Störungen, Aufgaben und Pläne. Ohne
 * Zugriff ist ein Vorgang gesperrt, auch per Link, fehlt in Listen, Zählern, Suche und Verknüpfungen, und die Person
 * erhält dazu keine Mails. Zuständig und erwähnbar bleibt sie trotzdem.
 */
export const PERMISSIONS = ['inbox', 'incident', 'task', 'plansView', 'plansEdit', 'reports', 'admin'] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  inbox: 'Eingang sehen und bearbeiten',
  incident: 'Störungen sehen und bearbeiten',
  task: 'Aufgaben sehen und bearbeiten',
  plansView: 'Pläne ansehen',
  plansEdit: 'Pläne bearbeiten',
  reports: 'Auswertungen',
  admin: 'Verwaltung',
};
/** Rechte, die einen Bereich zeigen: die IT braucht mindestens eines davon */
export const AREA_PERMISSIONS: readonly Permission[] = ['inbox', 'incident', 'task', 'plansView'];

/** Rechte der Rolle IT */
export interface PermissionSettings {
  it: Permission[];
}
export const DEFAULT_PERMISSIONS: PermissionSettings = { it: ['inbox', 'incident', 'task'] };

/** Gespeicherte Rechte bereinigen: Reihenfolge wie in der Liste, «Pläne bearbeiten» schliesst «Pläne ansehen» ein */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const set = new Set(list);
  if (set.has('plansEdit')) set.add('plansView');
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Rechte einer Rolle: Admins alle, IT laut Einstellung, Standard-Benutzer keine */
export function permissionsOf(role: UserRole, settings: PermissionSettings): Permission[] {
  if (role === 'admin') return [...PERMISSIONS];
  if (role === 'it') return normalizePermissions(settings.it);
  return [];
}
