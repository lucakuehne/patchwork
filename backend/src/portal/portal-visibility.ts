import type { Entry } from '../db/schema';

/**
 * Sieht der Melder einen Anhang im Portal? Ja bei der Meldung selbst (ohne Eintrag), bei öffentlichen Antworten und bei
 * der Begründung einer Ablehnung, über die er informiert wurde (Bilder im Text).
 */
export function visibleInPortal(entryId: string | null, entryKind: Entry['kind'] | null, entryMeta: Entry['meta'] | null): boolean {
  if (!entryId) return true;
  return entryKind === 'reply' || (entryKind === 'status' && !!entryMeta?.rejected && !!entryMeta?.notified);
}
