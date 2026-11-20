import polygonClipping from 'polygon-clipping';
import type {
  PlanArea,
  PlanAreaKind,
  PlanBackground,
  PlanLabel,
  PlanOpening,
  PlanOpeningKind,
  PlanPillar,
  PlanPoint,
  PlanWall,
} from '../types';

/**
 * Pläne (Entscheide vom 20.11.2026): Masse in Metern, Ursprung oben links, y nach unten. Die Prüfung, ob etwas im
 * Umriss liegt, steht gleich im Backend (plans/plan-shapes.ts).
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Raster beim Zeichnen: 10 cm */
export const GRID_STEP = 0.1;
/** Ecken anderer Formen rasten bis zu diesem Abstand ein (Meter) */
export const VERTEX_SNAP = 0.35;
/** Grösse eines leeren Stockwerks für die erste Ansicht */
export const EMPTY_FLOOR: Box = { x: 0, y: 0, w: 30, h: 18 };
/** Toleranz beim Prüfen, ob etwas im Umriss liegt: 1 cm */
export const INSIDE_TOLERANCE = 0.01;

/* ---------- Arten und Vorgaben ---------- */

export const AREA_KINDS: PlanAreaKind[] = ['room', 'corridor', 'entrance', 'stairs', 'elevator', 'open', 'shaft', 'outdoor'];
export const AREA_KIND_LABELS: Record<PlanAreaKind, string> = {
  room: 'Raum',
  corridor: 'Gang/Flur',
  entrance: 'Eingang/Foyer',
  stairs: 'Treppenhaus',
  elevator: 'Lift',
  open: 'Offener Bereich',
  shaft: 'Schacht',
  outdoor: 'Aussenbereich',
};
export const AREA_KIND_PLURALS: Record<PlanAreaKind, string> = {
  room: 'Räume',
  corridor: 'Gänge/Flure',
  entrance: 'Eingänge/Foyers',
  stairs: 'Treppenhäuser',
  elevator: 'Lifte',
  open: 'Offene Bereiche',
  shaft: 'Schächte',
  outdoor: 'Aussenbereiche',
};
/** Ohne Fläche in m² im Plan */
export const AREA_WITHOUT_SIZE: PlanAreaKind[] = ['stairs', 'elevator', 'shaft'];
export const OPENING_LABELS: Record<PlanOpeningKind, string> = { door: 'Tür', double: 'Zweiflüglige Tür', opening: 'Öffnung', window: 'Fenster' };
export const OPENING_DEFAULT_WIDTH: Record<PlanOpeningKind, number> = { door: 0.9, double: 1.6, opening: 1, window: 1.2 };
export const DEFAULT_WALL_THICKNESS = 0.2;
export const DEFAULT_PILLAR_SIZE = 0.3;

/** Name einer Fläche für Listen und Hinweise: ohne Namen die Art */
export const areaTitle = (a: Pick<PlanArea, 'kind' | 'name'>) => a.name.trim() || AREA_KIND_LABELS[a.kind];

/* ---------- Grundlagen ---------- */

/** Am Raster ausrichten; gerundet, damit keine Werte wie 2.3000000000000003 entstehen */
export const snap = (v: number, step = GRID_STEP) => Number((Math.round(v / step) * step).toFixed(6));
export const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const same = (a: PlanPoint, b: PlanPoint) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
export const copyPoints = (points: PlanPoint[]) => points.map((p): PlanPoint => [p[0], p[1]]);

/** Zahl mit Komma, z.B. «24,5» */
export const formatNumber = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');

/** Fläche in m² (Gausssche Trapezformel) */
export function polygonArea(points: PlanPoint[]): number {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}

/** Schwerpunkt, für die Beschriftung der Fläche */
export function centroid(points: PlanPoint[]): PlanPoint {
  let a = 0;
  let cx = 0;
  let cy = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  });
  if (Math.abs(a) < 1e-9) return points[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(points: PlanPoint[]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Achsparalleles Rechteck (dann zeigt Patchwork Breite und Tiefe) */
export function isRect(points: PlanPoint[]): boolean {
  return (
    points.length === 4 &&
    points.every(([x, y], i) => {
      const [nx, ny] = points[(i + 1) % 4]!;
      return Math.abs(x - nx) < 1e-6 || Math.abs(y - ny) < 1e-6;
    })
  );
}

export const rectPoints = (x: number, y: number, w: number, h: number): PlanPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Abschnitte eines Linienzugs bzw. Vielecks als Paare von Ecken */
export function wallSegments(wall: Pick<PlanWall, 'points' | 'closed'>): [PlanPoint, PlanPoint][] {
  const segments: [PlanPoint, PlanPoint][] = [];
  for (let i = 0; i < wall.points.length - 1; i++) segments.push([wall.points[i]!, wall.points[i + 1]!]);
  if (wall.closed && wall.points.length > 2) segments.push([wall.points[wall.points.length - 1]!, wall.points[0]!]);
  return segments;
}
export const polylineLength = (points: PlanPoint[], closed: boolean) =>
  wallSegments({ points, closed }).reduce((s, [a, b]) => s + dist(a, b), 0);

/* ---------- Ausdehnung und Einrasten ---------- */

/** Formen eines Stockwerks, wie sie Ausdehnung, Einrasten und die Prüfung des Umrisses brauchen */
export interface FloorShapes {
  outline: PlanPoint[] | null;
  areas: PlanArea[];
  walls: PlanWall[];
  pillars: PlanPillar[];
  labels: PlanLabel[];
}

/** Ausdehnung des Stockwerks: Umriss, Flächen, Wände, Säulen, Beschriftungen und Plan; leer die Vorgabe */
export function floorBounds(c: FloorShapes, plan: PlanBackground | null): Box {
  const points: PlanPoint[] = [
    ...(c.outline ?? []),
    ...c.areas.flatMap((a) => a.points),
    ...c.walls.flatMap((w) => w.points),
    ...c.pillars.map((p): PlanPoint => [p.x, p.y]),
    ...c.labels.map((l): PlanPoint => [l.x, l.y]),
  ];
  if (plan) {
    points.push([plan.x, plan.y], [plan.x + plan.widthPx * plan.metersPerPx, plan.y + plan.heightPx * plan.metersPerPx]);
  }
  return points.length ? bbox(points) : EMPTY_FLOOR;
}

/** Ecken, an denen gezeichnete Ecken einrasten: Umriss, Flächen und Wände (ohne die gerade bearbeitete Form) */
export function snapCandidates(c: FloorShapes, except?: PlanPoint[]): PlanPoint[] {
  const lists = [c.outline ?? [], ...c.areas.map((a) => a.points), ...c.walls.map((w) => w.points)];
  return lists.filter((l) => l !== except).flat();
}

/** Einrasten: an der nächsten Ecke, sonst am Raster */
export function snapPoint(p: PlanPoint, candidates: PlanPoint[], threshold = VERTEX_SNAP): PlanPoint {
  let best: PlanPoint | null = null;
  let bestDistance = threshold;
  for (const q of candidates) {
    const d = dist(q, p);
    if (d < bestDistance) {
      best = q;
      bestDistance = d;
    }
  }
  return best ? [best[0], best[1]] : [snap(p[0]), snap(p[1])];
}

/* ---------- Im Umriss ---------- */

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

/** Liegt die Strecke ganz im Vieleck (Rand gilt als innen)? Auch bei einspringenden Ecken richtig. */
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
    for (const v of [p, q]) {
      if (distanceToSegment(v, a, b) <= tolerance) ts.push(((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / len2);
    }
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

/** Liegt das Vieleck bzw. der Linienzug ganz im Umriss? */
export function shapeInPolygon(points: PlanPoint[], closed: boolean, polygon: PlanPoint[]): boolean {
  if (points.length === 1) return pointInPolygon(points[0]!, polygon);
  return wallSegments({ points, closed }).every(([a, b]) => segmentInPolygon(a, b, polygon));
}

/** Was ausserhalb des Umrisses liegt, für den Hinweis; leer = alles drin */
export function outsideOutline(outline: PlanPoint[], c: Omit<FloorShapes, 'outline'>): string[] {
  return [
    ...c.areas.filter((a) => !shapeInPolygon(a.points, true, outline)).map((a) => `«${areaTitle(a)}»`),
    ...(c.walls.some((w) => !shapeInPolygon(w.points, w.closed, outline)) ? ['eine Wand'] : []),
    ...(c.pillars.some((p) => !pointInPolygon([p.x, p.y], outline)) ? ['eine Säule'] : []),
    ...c.labels.filter((l) => !pointInPolygon([l.x, l.y], outline)).map((l) => `«${l.text}»`),
  ];
}

/**
 * Ecken auf Millimeter runden, doppelte und überflüssige Ecken (auf einer Geraden) weglassen, z.B. nach dem Vereinigen.
 */
export function normalizeRing(ring: PlanPoint[]): PlanPoint[] {
  const rounded = ring.map(([x, y]): PlanPoint => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
  if (rounded.length > 1 && same(rounded[0]!, rounded[rounded.length - 1]!)) rounded.pop();
  let pts = rounded.filter((p, i) => i === 0 || !same(p, rounded[i - 1]!));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) < 1e-6) {
        pts = [...pts.slice(0, i), ...pts.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Umriss so erweitern, dass er die Fläche umschliesst (Entscheid vom 20.11.2026: er wächst mit). Liegt die Fläche
 * schon drin, bleibt er; berührt oder überlappt sie ihn nicht, gibt es null (ein Umriss bleibt ein Stück).
 */
export function growOutline(outline: PlanPoint[], area: PlanPoint[]): PlanPoint[] | null {
  if (shapeInPolygon(area, true, outline)) return outline;
  const result = polygonClipping.union([outline], [area]);
  if (result.length !== 1 || !result[0]![0]) return null;
  const grown = normalizeRing(result[0]![0]! as PlanPoint[]);
  return grown.length >= 3 ? grown : null;
}

/* ---------- Türen und Fenster ---------- */

export interface OpeningFrame {
  /** Mitte, Richtung der Wand (Einheitsvektor), Normale nach links, Wanddicke, Länge des Abschnitts */
  c: PlanPoint;
  u: PlanPoint;
  n: PlanPoint;
  t: number;
  len: number;
}

/** Lage einer Tür oder eines Fensters in ihrer Wand; null, wenn die Wand oder der Abschnitt fehlt */
export function openingFrame(o: Pick<PlanOpening, 'wallId' | 'segment' | 'offset'>, walls: PlanWall[]): OpeningFrame | null {
  const wall = walls.find((w) => w.id === o.wallId);
  const segment = wall ? wallSegments(wall)[o.segment] : undefined;
  if (!wall || !segment) return null;
  const [a, b] = segment;
  const len = dist(a, b);
  if (len === 0) return null;
  const u: PlanPoint = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { c: [a[0] + u[0] * o.offset, a[1] + u[1] * o.offset], u, n: [-u[1], u[0]], t: wall.thickness, len };
}

/** Zeichnung einer Tür oder eines Fensters: Lücke in der Wand, Türblätter mit Bogen, Linien des Fensters */
export function openingDrawing(o: Pick<PlanOpening, 'width' | 'kind' | 'hinge' | 'side'>, f: OpeningFrame, hitHalf = 0) {
  const at = (along: number, across: number): PlanPoint => [f.c[0] + f.u[0] * along + f.n[0] * across, f.c[1] + f.u[1] * along + f.n[1] * across];
  const h = o.width / 2;
  const half = f.t / 2;
  const gap = [at(-h, -half - 0.01), at(h, -half - 0.01), at(h, half + 0.01), at(-h, half + 0.01)];
  const hw = Math.max(half, hitHalf);
  const hit = [at(-h, -hw), at(h, -hw), at(h, hw), at(-h, hw)];
  const s = o.side === 'left' ? 1 : -1;
  const leaves: [PlanPoint, PlanPoint][] = [];
  const arcs: string[] = [];
  const lines: [PlanPoint, PlanPoint][] = [];
  const leaf = (hingeAlong: number, toAlong: number, r: number) => {
    const hinge = at(hingeAlong, s * half);
    const tip = at(hingeAlong, s * (half + r));
    const to = at(toAlong, s * half);
    leaves.push([hinge, tip]);
    const cross = (tip[0] - hinge[0]) * (to[1] - hinge[1]) - (tip[1] - hinge[1]) * (to[0] - hinge[0]);
    arcs.push(`M ${tip[0]} ${tip[1]} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${to[0]} ${to[1]}`);
  };
  if (o.kind === 'door') {
    const start = o.hinge === 'start' ? -h : h;
    leaf(start, -start, o.width);
  } else if (o.kind === 'double') {
    leaf(-h, 0, h);
    leaf(h, 0, h);
  } else if (o.kind === 'window') {
    lines.push([at(-h, -half), at(h, -half)], [at(-h, half), at(h, half)], [at(-h, 0), at(h, 0)], [at(-h, -half), at(-h, half)], [at(h, -half), at(h, half)]);
  }
  return { gap, hit, leaves, arcs, lines };
}

/** Nächstes Wandstück zu einem Punkt (bis maxDistance neben der Wand): für Türen und Fenster */
export function nearestWallSegment(p: PlanPoint, walls: PlanWall[], maxDistance: number) {
  let best: { wall: PlanWall; segment: number; along: number; length: number; distance: number } | null = null;
  for (const wall of walls) {
    wallSegments(wall).forEach(([a, b], segment) => {
      const d = distanceToSegment(p, a, b);
      if (d > maxDistance + wall.thickness / 2 || (best && d >= best.distance)) return;
      const length = dist(a, b);
      const along = length ? ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length : 0;
      best = { wall, segment, along, length, distance: d };
    });
  }
  return best as { wall: PlanWall; segment: number; along: number; length: number; distance: number } | null;
}

/** Mitte einer Öffnung auf dem Abschnitt: auf 5 cm, die Öffnung bleibt ganz im Abschnitt; null, wenn er zu kurz ist */
export function placeOnSegment(along: number, length: number, width: number): number | null {
  if (length + 1e-9 < width) return null;
  const min = width / 2;
  const max = length - width / 2;
  return Math.min(max, Math.max(min, snap(along, 0.05)));
}

/** Öffnung nach dem Ändern ihrer Wand: auf den nächsten Abschnitt bei ihrer alten Mitte; null, wenn sie nicht mehr passt */
export function refitOpening(o: PlanOpening, wall: PlanWall, center: PlanPoint): PlanOpening | null {
  const hit = nearestWallSegment(center, [wall], Infinity);
  if (!hit) return null;
  const offset = placeOnSegment(hit.along, hit.length, o.width);
  return offset === null ? null : { ...o, segment: hit.segment, offset };
}

/* ---------- Wände entlang einer Fläche ---------- */

/**
 * Wände auf den Kanten eines Vielecks (mittig): Kanten, auf denen schon eine Wand liegt, fallen weg. Sind alle Kanten
 * frei, gibt es eine geschlossene Wand, sonst je zusammenhängendes Stück einen Linienzug.
 */
export function wallsAlong(points: PlanPoint[], walls: PlanWall[]): { points: PlanPoint[]; closed: boolean }[] {
  const n = points.length;
  const covered = (a: PlanPoint, b: PlanPoint) =>
    walls.some((w) => wallSegments(w).some(([p, q]) => distanceToSegment(a, p, q) <= 0.01 && distanceToSegment(b, p, q) <= 0.01));
  const free = points.map((p, i) => !covered(p, points[(i + 1) % n]!));
  if (free.every(Boolean)) return [{ points: copyPoints(points), closed: true }];
  const start = free.findIndex((f) => !f);
  const chains: PlanPoint[][] = [];
  let chain: PlanPoint[] | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (free[i]) {
      if (!chain) chain = [[points[i]![0], points[i]![1]]];
      const next = points[(i + 1) % n]!;
      chain.push([next[0], next[1]]);
    } else if (chain) {
      chains.push(chain);
      chain = null;
    }
  }
  if (chain) chains.push(chain);
  return chains.map((c) => ({ points: c, closed: false }));
}

/* ---------- Zeichen in Flächen ---------- */

/** Treppenstriche alle 30 cm quer zur längsten Kante (der Laufrichtung) */
export function stairLines(points: PlanPoint[], step = 0.3): [PlanPoint, PlanPoint][] {
  let longest = 0;
  let u: PlanPoint = [1, 0];
  for (const [a, b] of wallSegments({ points, closed: true })) {
    const l = dist(a, b);
    if (l > longest) {
      longest = l;
      u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
  }
  const n: PlanPoint = [-u[1], u[0]];
  const along = points.map((p) => p[0] * u[0] + p[1] * u[1]);
  const across = points.map((p) => p[0] * n[0] + p[1] * n[1]);
  const [a0, a1, c0, c1] = [Math.min(...along), Math.max(...along), Math.min(...across), Math.max(...across)];
  const lines: [PlanPoint, PlanPoint][] = [];
  for (let s = a0 + step; s < a1 - 1e-6 && lines.length < 400; s += step) {
    lines.push([
      [u[0] * s + n[0] * c0, u[1] * s + n[1] * c0],
      [u[0] * s + n[0] * c1, u[1] * s + n[1] * c1],
    ]);
  }
  return lines;
}

/** Kreuz für Lift und Schacht: Diagonalen des Vierecks, sonst des umgebenden Rechtecks */
export function crossLines(points: PlanPoint[]): [PlanPoint, PlanPoint][] {
  if (points.length === 4) return [[points[0]!, points[2]!], [points[1]!, points[3]!]];
  const b = bbox(points);
  return [
    [[b.x, b.y], [b.x + b.w, b.y + b.h]],
    [[b.x + b.w, b.y], [b.x, b.y + b.h]],
  ];
}

/* ---------- Anzeige und Druck ---------- */

/** Länge der Massstabsleiste: eine runde Zahl Meter, ungefähr so lang wie verlangt */
export function niceLength(meters: number): number {
  for (const n of [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]) if (n >= meters) return n;
  return 1000;
}

/** Druck auf A4 quer: kleinster üblicher Massstab, bei dem das Stockwerk auf die Seite passt (277 × 170 mm) */
export function printScale(widthMeters: number, heightMeters: number): number {
  const needed = Math.max((widthMeters * 1000) / 277, (heightMeters * 1000) / 170);
  return [20, 50, 100, 200, 250, 500, 1000, 2000].find((s) => s >= needed) ?? 5000;
}

/** Schriftgrösse des Namens in Metern: passt in die Breite der Fläche */
export function labelSize(name: string, width: number): number {
  return Math.max(0.28, Math.min(0.62, (width * 0.92) / (Math.max(name.length, 1) * 0.56)));
}

/** Name des neuen obersten Stockwerks: nach «EG» das «1. OG», nach «2. OG» das «3. OG» */
export function nextFloorName(top: string | undefined): string {
  if (!top) return 'EG';
  if (top.trim() === 'EG') return '1. OG';
  const m = /^(\d+)\. OG$/.exec(top.trim());
  return m ? `${Number(m[1]) + 1}. OG` : '';
}

/** Namen, die im Stockwerk mehrfach vorkommen (Gross-/Kleinschreibung egal, leere zählen nicht) */
export function duplicateNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) duplicates.set(key, seen.get(key)!);
    else seen.set(key, name.trim());
  }
  return [...duplicates.values()];
}
