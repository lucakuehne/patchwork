import type { Entry } from '../db/schema';

/** So lange nach dem Erfassen bietet die Oberfläche «Bearbeiten» für eigene interne Notizen an. */
export const NOTE_EDIT_MINUTES = 3;

/** Zusätzliche Frist zum Speichern, damit eine rechtzeitig begonnene Bearbeitung nicht verloren geht. */
const SAVE_GRACE_MINUTES = 5;

/** Abweichung zwischen den Uhren von Browser und Server, die beim Anpassen der Zeit noch nicht als Zukunft gilt */
const FUTURE_GRACE_MS = 60_000;

/**
 * Prüft, ob jemand eine Notiz bearbeiten darf: nur eigene, in Patchwork erfasste interne Notizen
 * (keine per Mail eingegangenen) und nur kurz nach dem Erfassen. Eigene sind auch die, die ein Admin im eigenen Namen
 * erfasst hat, und für diesen Admin die, die er im Namen eines anderen erfasst hat. Hat ein Admin die Zeit angepasst,
 * zählt die Frist ab der ursprünglichen Zeit. Gibt den Grund zurück, falls nicht.
 */
export function noteEditRefusal(
  entry: Pick<Entry, 'kind' | 'authorId' | 'meta' | 'createdAt'> & {
    originalCreatedAt?: Date | null;
    recordedById?: string | null;
  },
  actorId: string,
  now: Date,
): { reason: 'kind' | 'author' | 'expired'; message: string } | null {
  if (entry.kind !== 'note' || entry.meta?.source) {
    return { reason: 'kind', message: 'Nur interne Notizen aus Patchwork lassen sich bearbeiten' };
  }
  if (entry.authorId !== actorId && entry.recordedById !== actorId) {
    return { reason: 'author', message: 'Nur eigene Notizen lassen sich bearbeiten' };
  }
  const created = entry.originalCreatedAt ?? entry.createdAt;
  if (now.getTime() - created.getTime() > (NOTE_EDIT_MINUTES + SAVE_GRACE_MINUTES) * 60_000) {
    return { reason: 'expired', message: `Notizen lassen sich nur in den ersten ${NOTE_EDIT_MINUTES} Minuten bearbeiten` };
  }
  return null;
}

/**
 * Zeit einer internen Notiz anpassen (nur Admins, Entscheid vom 27.10.2026): alle internen Notizen, auch per Mail
 * eingegangene, jederzeit; die neue Zeit darf in der Vergangenheit liegen, auch vor der Erfassung des Vorgangs, aber
 * nicht in der Zukunft. Gibt den Grund zurück, falls nicht.
 */
export function noteTimeRefusal(entry: Pick<Entry, 'kind'>, at: Date, now: Date): string | null {
  if (entry.kind !== 'note') return 'Nur bei internen Notizen lässt sich die Zeit anpassen';
  if (at.getTime() > now.getTime() + FUTURE_GRACE_MS) return 'Die Zeit darf nicht in der Zukunft liegen';
  return null;
}
