/**
 * Formen eines Stockwerks (Pläne, Entscheid vom 20.11.2026): Arten der Flächen, Bauteile (Wände, Säulen, Türen und
 * Fenster) und die Geometrie, mit der das Speichern prüft, ob alles im Umriss liegt. Masse in Metern, y nach unten.
 * Dieselbe Geometrie steht im Frontend in plans/geometry.ts.
 */
export type PlanPoint = [number, number];

/** Arten der Flächen, feste Liste */
export const AREA_KINDS = ['room', 'corridor', 'entrance', 'stairs', 'elevator', 'open', 'shaft', 'outdoor'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  room: 'Raum',
  corridor: 'Gang/Flur',
  entrance: 'Eingang/Foyer',
  stairs: 'Treppenhaus',
  elevator: 'Lift',
  open: 'Offener Bereich',
  shaft: 'Schacht',
  outdoor: 'Aussenbereich',
};

/** Lage der Wand zu ihrer Linie: mittig oder bündig, die Dicke links bzw. rechts (in Richtung von a nach b) */
export const WALL_ALIGNS = ['center', 'left', 'right'] as const;
export type WallAlign = (typeof WALL_ALIGNS)[number];
/** Wand: ein gerades Stück von a nach b mit eigener Dicke (Entscheid vom 20.11.2026) */
export interface PlanWall {
  id: string;
  a: PlanPoint;
  b: PlanPoint;
  thickness: number;
  align: WallAlign;
}
/** Säule: eckig (Breite × Tiefe, gedreht um die Mitte) oder rund (Durchmesser = Breite) */
export interface PlanPillar {
  id: string;
  shape: 'rect' | 'round';
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}
export const OPENING_KINDS = ['door', 'double', 'opening', 'window'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
/**
 * Tür oder Fenster in einer Wand: Mitte «offset» Meter nach dem Anfang a der Wand. Anschlag («hinge»): am Anfang oder
 * Ende der Öffnung; Aufschlag («side»): links oder rechts der Wand in Zeichenrichtung.
 */
export interface PlanOpening {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  kind: OpeningKind;
  hinge: 'start' | 'end';
  side: 'left' | 'right';
}

/** Toleranz beim Prüfen, ob etwas im Umriss liegt: 1 cm */
export const INSIDE_TOLERANCE = 0.01;

/** Fläche in m² (Gausssche Trapezformel) */
export function polygonArea(points: PlanPoint[]): number {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}

/** Kanten eines Linienzugs bzw. Vielecks als Paare von Ecken */
export function edges(points: PlanPoint[], closed: boolean): [PlanPoint, PlanPoint][] {
  const list: [PlanPoint, PlanPoint][] = [];
  for (let i = 0; i < points.length - 1; i++) list.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) list.push([points[points.length - 1]!, points[0]!]);
  return list;
}

export const wallLength = (w: Pick<PlanWall, 'a' | 'b'>) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** Abstand eines Punkts zu einer Strecke */
export function distanceToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Liegt der Punkt im Vieleck oder auf seinem Rand (bis zur Toleranz)? */
export function pointInPolygon(p: PlanPoint, polygon: PlanPoint[], tolerance = INSIDE_TOLERANCE): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (distanceToSegment(p, a, b) <= tolerance) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Liegt die Strecke ganz im Vieleck (Rand gilt als innen)? Beide Enden innen und zwischen allen Stellen, an denen die
 * Strecke den Rand trifft oder berührt, ebenfalls innen. Gilt so auch für Vielecke mit einspringenden Ecken.
 */
export function segmentInPolygon(a: PlanPoint, b: PlanPoint, polygon: PlanPoint[], tolerance = INSIDE_TOLERANCE): boolean {
  if (!pointInPolygon(a, polygon, tolerance) || !pointInPolygon(b, polygon, tolerance)) return false;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return true;
  const ts = [0, 1];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    // Ecken des Vielecks auf der Strecke
    for (const v of [p, q]) {
      if (distanceToSegment(v, a, b) <= tolerance) ts.push(((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / len2);
    }
    // Schnittpunkt mit der Kante
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / denom;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / denom;
    if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  const sorted = ts.filter((t) => t >= 0 && t <= 1).sort((x, y) => x - y);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1]! - sorted[i]! < 1e-9) continue;
    const m = (sorted[i]! + sorted[i + 1]!) / 2;
    if (!pointInPolygon([a[0] + dx * m, a[1] + dy * m], polygon, tolerance)) return false;
  }
  return true;
}

/** Liegt das Vieleck (bzw. der Linienzug) ganz im Umriss? Alle Kanten innen genügt, weil der Umriss keine Löcher hat. */
export function shapeInPolygon(points: PlanPoint[], closed: boolean, polygon: PlanPoint[], tolerance = INSIDE_TOLERANCE): boolean {
  if (points.length === 1) return pointInPolygon(points[0]!, polygon, tolerance);
  return edges(points, closed).every(([a, b]) => segmentInPolygon(a, b, polygon, tolerance));
}
