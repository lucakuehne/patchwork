import type { Status, StatusCategory } from './types';

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

/** Ausgangslage im Diagramm: Neu links, In Arbeit und darunter Wartend in der Mitte, Erledigt und darunter Abgelehnt rechts */
const COLUMN_X: Record<StatusCategory, number> = { new: 0, in_progress: 220, waiting: 220, done: 440, rejected: 440 };
const BELOW: Partial<Record<StatusCategory, StatusCategory>> = { waiting: 'in_progress', rejected: 'done' };
/** Abstand zweier Status untereinander, genug Platz für einen Pfeil dazwischen */
const ROW = 90;

/**
 * Lage eines Status im Ablaufdiagramm: gespeichert oder, falls noch nie verschoben, automatisch nach Kategorie und darin
 * nach Reihenfolge untereinander.
 */
export function diagramPosition(status: Status, all: Status[]): { x: number; y: number } {
  if (status.diagramX !== null && status.diagramY !== null) return { x: status.diagramX, y: status.diagramY };
  const inCategory = (category: StatusCategory) =>
    all.filter((s) => s.category === category).sort((a, b) => a.position - b.position);
  // Wartend bzw. Abgelehnt beginnen mit etwas Abstand unter den Status der Kategorie darüber
  const upper = BELOW[status.category];
  const top = upper ? Math.max(1, inCategory(upper).length) * ROW + ROW / 2 : 0;
  return { x: COLUMN_X[status.category], y: top + inCategory(status.category).indexOf(status) * ROW };
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
