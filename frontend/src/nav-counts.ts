import type { ItemType, Status, StatusColor, StatusTargetsByType } from './types';

export interface CountSegment {
  statusId: string;
  label: string;
  color: StatusColor;
  count: number;
}

/**
 * Zähler je Status im Menü (Entscheid vom 03.11.2026): jeder offene Status des Typs in der Reihenfolge des Boards, bei
 * Aufgaben ohne den Start-Status (Backlog) wie der bisherige Zähler. Status ohne Vorgänge bleiben stehen (blasse 0),
 * damit die Reihenfolge fest bleibt.
 */
export function countSegments(
  type: ItemType,
  statuses: Status[],
  targets: StatusTargetsByType,
  byStatus: Record<string, number>,
): CountSegment[] {
  const backlog = type === 'task' ? targets.task.start : undefined;
  return statuses
    .filter((s) => s.type === type && !s.closed && s.id !== backlog)
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ statusId: s.id, label: s.label, color: s.color, count: byStatus[s.id] ?? 0 }));
}

/** Für Screenreader und als Text: «Neu 2, In Arbeit 7, Wartet auf Melder 0» */
export const segmentsText = (segments: CountSegment[]) => segments.map((s) => `${s.label} ${s.count}`).join(', ');
