import { api, ApiError } from './api';
import { itemRef, type ItemKey } from './item-ref';
import { useAssigneePrompt } from './stores/assignee-prompt';
import { useConfirm } from './stores/confirm';
import type { ItemType, StatusTargets, StatusTargetsByType } from './types';

export interface MoveRequest {
  statusId: string;
  beforeId?: string | null;
  afterId?: string | null;
}

/** Zusatzangaben eines Statuswechsels von Hand, nach Rückfrage */
export interface StatusExtra {
  /** Zuständig, falls der neue Status einen verlangt und der Vorgang keinen hat (Entscheid vom 04.11.2026) */
  assigneeId?: string;
  /** Abschliessen trotz offener Checklisten-Punkte bestätigt */
  force?: boolean;
}

/**
 * Statuswechsel von Hand senden: Board, Statusauswahl, Typwechsel, Antworten und Notizen mit Status. Verlangt der neue
 * Status einen Zuständigen und hat der Vorgang keinen, fragt das Fenster «Wer ist zuständig?»; meldet der Server offene
 * Checklisten-Punkte, wird nachgefragt. Danach sendet «send» erneut mit den Zusatzangaben. Ergebnis: false, wenn
 * abgebrochen wurde (dann ist nichts gespeichert).
 */
export async function sendStatusChange(send: (extra: StatusExtra) => Promise<unknown>): Promise<boolean> {
  const extra: StatusExtra = {};
  for (;;) {
    try {
      await send({ ...extra });
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'ASSIGNEE_REQUIRED' && !extra.assigneeId) {
        const assigneeId = await useAssigneePrompt().ask(err.message);
        if (!assigneeId) return false;
        extra.assigneeId = assigneeId;
      } else if (err.code === 'OPEN_CHECKLIST' && !extra.force) {
        const ok = await useConfirm().ask({
          title: 'Checkliste nicht vollständig',
          message: `${err.message} Trotzdem abschliessen?`,
          confirmLabel: 'Trotzdem abschliessen',
        });
        if (!ok) return false;
        extra.force = true;
      } else {
        throw err;
      }
    }
  }
}

/** Setzt den Status eines Vorgangs (Board, Statusauswahl), mit den Rückfragen von sendStatusChange. */
export function moveItem(item: ItemKey, request: MoveRequest): Promise<boolean> {
  return sendStatusChange((extra) => api.post(`/items/${itemRef(item)}/move`, { ...request, ...extra }));
}

/**
 * Status zur Wahl beim Wechsel von Hand (Status-Feld, Board, Neu-Dialog): die Status des Typs in ihrer Reihenfolge ohne
 * den Ablehnen-Status (nur über «Ablehnen» erreichbar), dazu nur, was der Ablauf aus dem aktuellen Status erlaubt. Der
 * aktuelle Status bleibt in der Auswahl, ausser es ist der Ablehnen-Status.
 */
export function manualStatusChoices<T extends { id: string }>(
  statuses: T[],
  targets: StatusTargets,
  currentId: string | null,
  allowed: (toId: string) => boolean = () => true,
): T[] {
  return statuses.filter((s) => s.id !== targets.reject && (s.id === currentId || allowed(s.id)));
}

/**
 * Status zur Wahl beim Typwechsel von Hand: alle Status des Zieltyps (der Ablauf gilt hier nicht), ohne dessen
 * Ablehnen-Status. Zur Störung gibt es ihn, wenn der Vorgang im Ablehnen-Status der Aufgaben steht; zur Aufgabe nie
 * (seit 23.10.2026). «current» null: aus dem Eingang.
 */
export function typeChangeChoices<T extends { id: string }>(
  targetStatuses: T[],
  targets: StatusTargetsByType,
  current: { id: string; type: ItemType } | null,
  targetType: ItemType,
): T[] {
  const fromReject = targetType === 'incident' && !!current && current.id === targets[current.type].reject;
  return targetStatuses.filter((s) => fromReject || s.id !== targets[targetType].reject);
}
