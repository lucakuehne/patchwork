import type { ItemType } from '../db/schema';
import { STATUS_COLORS, type StatusColor, type TargetsByType } from '../statuses/status-rules';

/** Status, wie ihn der Melder im Portal sieht (seit 20.10.2026 der interne Statusname mit seiner Farbe). */
export interface PortalStatus {
  /** Interner Statusname, im Eingang «Eingegangen» */
  label: string;
  color: StatusColor;
  /** Abgeschlossen: erscheint unter «Abgeschlossen» */
  closed: boolean;
  /** Wartet-Status des Typs: Der Melder ist am Zug, das Portal hebt ihn hervor */
  waiting: boolean;
}

/** Im Eingang (noch ohne Typ und Status) */
export const RECEIVED: PortalStatus = { label: 'Eingegangen', color: 'blue', closed: false, waiting: false };

const isStatusColor = (color: string): color is StatusColor => (STATUS_COLORS as readonly string[]).includes(color);

/** Portal-Status eines Vorgangs; ohne Status (Eingang) «Eingegangen». */
export function portalStatus(
  status: { id: string; type: ItemType; label: string; color: string; closed: boolean } | null,
  targets: TargetsByType,
): PortalStatus {
  if (!status) return { ...RECEIVED };
  return {
    label: status.label,
    color: isStatusColor(status.color) ? status.color : 'gray',
    closed: status.closed,
    waiting: status.id === targets[status.type].waiting,
  };
}
