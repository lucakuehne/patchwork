import type { ItemType, Status, StatusTarget, StatusTargets, StatusTargetsByType } from './types';

/** Ziel-Status: Bezeichnung, Pflicht, offen bzw. abgeschlossen (wie im Backend, status-rules.ts) */
export const STATUS_TARGETS: StatusTarget[] = ['start', 'reply', 'close', 'reject', 'waiting'];
export const REQUIRED_TARGETS: StatusTarget[] = ['start', 'reply', 'close'];
export const TARGET_CLOSED: Record<StatusTarget, boolean> = {
  start: false,
  reply: false,
  close: true,
  reject: true,
  waiting: false,
};
export const TARGET_LABELS: Record<StatusTarget, string> = {
  start: 'Neuer Vorgang erhält',
  reply: 'Antwort des Melders führt in',
  close: 'Automatisch schliessen in',
  reject: '«Ablehnen» führt in',
  waiting: 'Wartet auf den Melder',
};

/** Darf ein Vorgang von Hand von «fromId» nach «toId» wechseln? Wie im Backend (status-rules.ts). */
export function transitionAllowed(
  restricted: boolean,
  transitions: { fromId: string; toId: string }[],
  fromId: string | null,
  toId: string,
): boolean {
  if (!restricted || !fromId || fromId === toId) return true;
  return transitions.some((t) => t.fromId === fromId && t.toId === toId);
}

/**
 * Ist «Ablehnen» aus diesem Status möglich? Nur mit Ablehnen-Ziel, nicht aus dem Ablehnen-Status selbst und, bei
 * eingeschränktem Ablauf, nur mit einem Pfeil in den Ablehnen-Status. Wie im Backend.
 */
export function rejectAllowed(
  restricted: boolean,
  transitions: { fromId: string; toId: string }[],
  rejectId: string | undefined,
  currentId: string | null,
): boolean {
  if (!rejectId || currentId === rejectId) return false;
  return transitionAllowed(restricted, transitions, currentId, rejectId);
}

/**
 * Wechsel von Hand, der einen Vorgang erledigt (Mail «Erledigt», Rückfrage bei offenen Checklisten-Punkten): in einen
 * abgeschlossenen Status ausser Ablehnen, aus einem offenen Status oder aus dem Ablehnen-Status. Wie im Backend.
 */
export function isCompleting(
  targets: StatusTargets,
  from: { id: string; closed: boolean } | null | undefined,
  to: { id: string; closed: boolean },
): boolean {
  if (!to.closed || to.id === targets.reject) return false;
  return !from || !from.closed || from.id === targets.reject;
}

/**
 * Vorschlag für den Status nach einem Typwechsel, nach der Rolle des bisherigen Status (wie im Backend): Start → Start,
 * Wartet → Wartet (sonst «nach Antwort»), übrige offene → «nach Antwort», Ablehnen → Ablehnen (sonst Schliessen),
 * übrige abgeschlossene → Schliessen. Ohne bisherigen Status: Start.
 */
export function suggestTypeChangeStatus(
  targets: StatusTargetsByType,
  current: { id: string; type: ItemType; closed: boolean } | null,
  targetType: ItemType,
): string | undefined {
  const to = targets[targetType];
  if (!current) return to.start;
  const from = targets[current.type];
  if (current.id === from.start) return to.start;
  if (current.id === from.waiting) return to.waiting ?? to.reply;
  if (current.id === from.reject) return to.reject ?? to.close;
  return current.closed ? to.close : to.reply;
}

/** Abstand zweier Status untereinander, genug Platz für einen Pfeil dazwischen */
const ROW = 90;

/**
 * Lage eines Status im Ablaufdiagramm: gespeichert oder, falls noch nie verschoben, automatisch: Start links, übrige
 * offene in der Mitte, abgeschlossene rechts, jeweils unter den Status, die dort schon stehen.
 */
export function diagramPosition(status: Status, all: Status[], targets: StatusTargets): { x: number; y: number } {
  if (status.diagramX !== null && status.diagramY !== null) return { x: status.diagramX, y: status.diagramY };
  const column = (s: Status) => (s.id === targets.start ? 0 : s.closed ? 440 : 220);
  const x = column(status);
  const ofType = all.filter((s) => s.type === status.type);
  const placed = ofType.filter((s) => s.diagramX !== null && s.diagramY !== null && Math.abs(s.diagramX - x) < 110);
  const open = ofType
    .filter((s) => (s.diagramX === null || s.diagramY === null) && column(s) === x)
    .sort((a, b) => a.position - b.position);
  const top = placed.length ? Math.max(...placed.map((s) => s.diagramY!)) + ROW : 0;
  return { x, y: top + open.indexOf(status) * ROW };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Point = { x: number; y: number };

/** Abstand der Biegung vom geraden Weg; die Kurve selbst liegt etwa halb so weit daneben */
const BEND = 30;

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Punkt auf dem Rand von «box» auf dem Weg von dessen Mitte zu «toward» */
function borderPoint(box: Box, toward: Point): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const round = (n: number) => Math.round(n * 10) / 10;
const point = (p: Point) => `${round(p.x)},${round(p.y)}`;

/**
 * SVG-Pfad eines Pfeils von Rand zu Rand zweier Status. Gibt es auch den Gegenpfeil («curved»), biegen sich beide zu
 * ihrer rechten Seite in Pfeilrichtung, so liegen Hin- und Rückweg nebeneinander statt übereinander.
 */
export function edgePath(source: Box, target: Box, curved: boolean): string {
  const s = center(source);
  const t = center(target);
  const length = Math.hypot(t.x - s.x, t.y - s.y);
  if (!length) return '';
  if (!curved) return `M ${point(borderPoint(source, t))} L ${point(borderPoint(target, s))}`;
  // Senkrecht zur Richtung, auf dem Bildschirm (y nach unten) die rechte Seite
  const control = {
    x: (s.x + t.x) / 2 - ((t.y - s.y) / length) * BEND,
    y: (s.y + t.y) / 2 + ((t.x - s.x) / length) * BEND,
  };
  return `M ${point(borderPoint(source, control))} Q ${point(control)} ${point(borderPoint(target, control))}`;
}
