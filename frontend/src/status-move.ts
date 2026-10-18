import { api, ApiError } from './api';
import { useConfirm } from './stores/confirm';

export interface MoveRequest {
  statusId: string;
  beforeId?: string | null;
  afterId?: string | null;
}

/**
 * Setzt den Status eines Vorgangs. Meldet der Server offene Checklisten-Punkte,
 * wird nachgefragt und bei Bestätigung erneut mit «force» gesendet.
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
