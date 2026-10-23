import { api, ApiError } from './api';
import { useConfirm } from './stores/confirm';
import type { ItemType, StatusTargets, StatusTargetsByType } from './types';

export interface MoveRequest {
  statusId: string;
  beforeId?: string | null;
  afterId?: string | null;
}

/**
 * Setzt den Status eines Vorgangs. Meldet der Server offene Checklisten-Punkte (Wechsel von Hand in einen
 * abgeschlossenen Status ausser dem Ablehnen-Status), wird nachgefragt und bei Bestätigung erneut mit «force» gesendet.
 * Ergebnis: false, wenn abgebrochen wurde.
 */
export async function moveItem(number: number, request: MoveRequest): Promise<boolean> {
  try {
    await api.post(`/items/${number}/move`, { ...request });
    return true;
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'OPEN_CHECKLIST') throw err;
    const ok = await useConfirm().ask({
      title: 'Checkliste nicht vollständig',
      message: `${err.message} Trotzdem abschliessen?`,
      confirmLabel: 'Trotzdem abschliessen',
    });
    if (!ok) return false;
    await api.post(`/items/${number}/move`, { ...request, force: true });
    return true;
  }
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
