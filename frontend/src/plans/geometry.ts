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
  PlanWallAlign,
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

/** Raster beim Zeichnen: 5 cm (Entscheid vom 20.11.2026, vorher 10 cm); nah herangezoomt 1 cm (24.11.2026) */
export const GRID_STEP = 0.05;
export const FINE_GRID_STEP = 0.01;
/** Ab so vielen Bildpunkten pro Meter gilt das feine Raster */
export const FINE_GRID_FROM_PX = 150;
/** Raster bei dieser Ansicht */
export const gridStepFor = (pxPerMeter: number) => (pxPerMeter >= FINE_GRID_FROM_PX ? FINE_GRID_STEP : GRID_STEP);
/** Mit gedrückter Alt-Taste: frei, auf den Millimeter */
export const FREE_STEP = 0.001;
/** Ecken und Kanten anderer Formen rasten höchstens bis zu diesem Abstand ein (Meter); näher gezoomt weniger */
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
export const WALL_ALIGN_LABELS: Record<PlanWallAlign, string> = { center: 'Mittig', left: 'Bündig', right: 'Bündig' };
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

/** Kanten eines Linienzugs bzw. Vielecks als Paare von Ecken */
export function edges(points: PlanPoint[], closed: boolean): [PlanPoint, PlanPoint][] {
  const list: [PlanPoint, PlanPoint][] = [];
  for (let i = 0; i < points.length - 1; i++) list.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) list.push([points[points.length - 1]!, points[0]!]);
  return list;
}
export const wallLength = (w: Pick<PlanWall, 'a' | 'b'>) => dist(w.a, w.b);

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
    ...c.walls.flatMap((w) => [w.a, w.b]),
    ...c.pillars.map((p): PlanPoint => [p.x, p.y]),
    ...c.labels.map((l): PlanPoint => [l.x, l.y]),
  ];
  if (plan) {
    points.push([plan.x, plan.y], [plan.x + plan.widthPx * plan.metersPerPx, plan.y + plan.heightPx * plan.metersPerPx]);
  }
  return points.length ? bbox(points) : EMPTY_FLOOR;
}

/**
 * Ausschnitt «Ganzes Stockwerk» (Entscheid vom 25.11.2026): der Umriss mit allem darin, ohne den Plan im Hintergrund;
 * ohne Umriss wie bisher mit dem Plan
 */
export function focusBounds(c: FloorShapes, plan: PlanBackground | null): Box {
  return c.outline ? floorBounds(c, null) : floorBounds(c, plan);
}

/** Ecken, an denen gezeichnete Ecken einrasten: Umriss, Flächen und Enden der Wände (ohne die gerade bearbeiteten) */
export function snapCandidates(c: FloorShapes, except: PlanPoint[][] = []): PlanPoint[] {
  const lists = [c.outline ?? [], ...c.areas.map((a) => a.points), ...c.walls.map((w) => [w.a, w.b])];
  return lists.filter((l) => !except.includes(l)).flat().filter((p) => !except.some((e) => e.includes(p)));
}

/** Kanten, an denen gezeichnete Ecken einrasten: Umriss, Flächen und Wände (ohne die gerade bearbeiteten Formen) */
export function snapEdges(c: FloorShapes, exceptLists: PlanPoint[][] = [], exceptWallIds: string[] = []): [PlanPoint, PlanPoint][] {
  return [
    ...(c.outline && !exceptLists.includes(c.outline) ? edges(c.outline, true) : []),
    ...c.areas.filter((a) => !exceptLists.includes(a.points)).flatMap((a) => edges(a.points, true)),
    ...c.walls.filter((w) => !exceptWallIds.includes(w.id)).map((w): [PlanPoint, PlanPoint] => [w.a, w.b]),
  ];
}

/** Ergebnis des Einrastens: der Punkt und woran er eingerastet ist (für die Anzeige) */
export interface SnapResult {
  p: PlanPoint;
  vertex?: PlanPoint;
  edge?: [PlanPoint, PlanPoint];
}

/**
 * Einrasten: an der nächsten Ecke, sonst auf der nächsten Kante (bei waagrechten und senkrechten Kanten die andere
 * Richtung am Raster), sonst am Raster.
 */
export function snapDetail(
  p: PlanPoint,
  candidates: PlanPoint[],
  threshold = VERTEX_SNAP,
  lines: [PlanPoint, PlanPoint][] = [],
  step = GRID_STEP,
): SnapResult {
  let best: PlanPoint | null = null;
  let bestDistance = threshold;
  for (const q of candidates) {
    const d = dist(q, p);
    if (d < bestDistance) {
      best = q;
      bestDistance = d;
    }
  }
  if (best) return { p: [best[0], best[1]], vertex: best };
  let onLine: SnapResult | null = null;
  bestDistance = threshold * 0.7;
  for (const [a, b] of lines) {
    const d = distanceToSegment(p, a, b);
    if (d >= bestDistance) continue;
    bestDistance = d;
    let q: PlanPoint;
    if (Math.abs(a[1] - b[1]) < 1e-6) q = [snap(p[0], step), a[1]];
    else if (Math.abs(a[0] - b[0]) < 1e-6) q = [a[0], snap(p[1], step)];
    else {
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2));
      q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    onLine = { p: q, edge: [a, b] };
  }
  return onLine ?? { p: [snap(p[0], step), snap(p[1], step)] };
}

/** Einrasten, nur der Punkt */
export function snapPoint(p: PlanPoint, candidates: PlanPoint[], threshold = VERTEX_SNAP, lines: [PlanPoint, PlanPoint][] = [], step = GRID_STEP): PlanPoint {
  return snapDetail(p, candidates, threshold, lines, step).p;
}

/* ---------- Rechtwinklig ---------- */

/** Bis zu so vielen Grad Abweichung rastet eine Wand rechtwinklig bzw. in Flucht ein */
export const ANGLE_SNAP_DEG = 5;

/** Rechtwinklig eingerastet: Punkt, Richtung ab «from» und die Bezugsrichtung, falls rechtwinklig zu ihr */
export interface AngleSnap {
  p: PlanPoint;
  dir: PlanPoint;
  /** Bezugsrichtung (vom Eckpunkt weg), wenn die neue Richtung rechtwinklig dazu ist: für das Winkelzeichen */
  rightTo?: PlanPoint;
}

/**
 * Rechtwinklig einrasten (Entscheid vom 25.11.2026): Liegt die Richtung von «from» zum Zeiger nahe an einer
 * Bezugsrichtung (in Flucht) oder rechtwinklig dazu, gilt genau diese Richtung; die Länge folgt dem Raster. Ohne
 * Bezugsrichtungen gelten waagrecht und senkrecht.
 */
export function angleSnap(from: PlanPoint, p: PlanPoint, refs: PlanPoint[], step = GRID_STEP, tolDeg = ANGLE_SNAP_DEG): AngleSnap | null {
  const v: PlanPoint = [p[0] - from[0], p[1] - from[1]];
  const len = Math.hypot(v[0], v[1]);
  if (len < 0.05) return null;
  const bases: PlanPoint[] = refs.length ? refs : [[1, 0]];
  const cosTol = Math.cos((tolDeg * Math.PI) / 180);
  let best: { dir: PlanPoint; c: number; rightTo?: PlanPoint } | null = null;
  for (const r of bases) {
    const rl = Math.hypot(r[0], r[1]);
    if (rl < 1e-9) continue;
    const u: PlanPoint = [r[0] / rl, r[1] / rl];
    const options: [PlanPoint, boolean][] = [
      [u, false],
      [[-u[0], -u[1]], false],
      [[-u[1], u[0]], true],
      [[u[1], -u[0]], true],
    ];
    for (const [dir, perpendicular] of options) {
      const c = (v[0] * dir[0] + v[1] * dir[1]) / len;
      if (c >= cosTol && (!best || c > best.c)) best = { dir, c, rightTo: perpendicular && refs.length ? u : undefined };
    }
  }
  if (!best) return null;
  const along = snap(len * best.c, step);
  const q: PlanPoint = [Number((from[0] + best.dir[0] * along).toFixed(6)), Number((from[1] + best.dir[1] * along).toFixed(6))];
  return { p: q, dir: best.dir, rightTo: best.rightTo };
}

/** Schnittpunkt der Geraden ab «from» in Richtung «dir» mit der Strecke a–b; null, wenn keiner auf der Strecke liegt */
export function rayHitsSegment(from: PlanPoint, dir: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint | null {
  const e: PlanPoint = [b[0] - a[0], b[1] - a[1]];
  const den = dir[0] * e[1] - dir[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const w: PlanPoint = [a[0] - from[0], a[1] - from[1]];
  const t = (w[0] * e[1] - w[1] * e[0]) / den;
  const u = (w[0] * dir[1] - w[1] * dir[0]) / den;
  if (t <= 0 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [Number((from[0] + dir[0] * t).toFixed(6)), Number((from[1] + dir[1] * t).toFixed(6))];
}

/**
 * Bezugsrichtungen für eine Wand ab diesem Punkt: Wände, die hier enden (Richtung zu ihrem anderen Ende), und Wände,
 * auf deren Linie der Punkt liegt.
 */
export function wallDirectionsAt(walls: PlanWall[], p: PlanPoint, exceptIds: string[] = []): PlanPoint[] {
  const dirs: PlanPoint[] = [];
  for (const w of walls) {
    if (exceptIds.includes(w.id)) continue;
    if (dist(w.a, p) < 0.005) dirs.push([w.b[0] - p[0], w.b[1] - p[1]]);
    else if (dist(w.b, p) < 0.005) dirs.push([w.a[0] - p[0], w.a[1] - p[1]]);
    else if (distanceToSegment(p, w.a, w.b) < 0.01) dirs.push([w.b[0] - w.a[0], w.b[1] - w.a[1]]);
  }
  return dirs;
}

/* ---------- Andocken ---------- */

/** Umriss einer eckigen Säule (gedreht um ihre Mitte) */
export function pillarPolygon(p: Pick<PlanPillar, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): PlanPoint[] {
  const r = (p.rotation * Math.PI) / 180;
  const [c, sn] = [Math.cos(r), Math.sin(r)];
  return [
    [-p.width / 2, -p.depth / 2],
    [p.width / 2, -p.depth / 2],
    [p.width / 2, p.depth / 2],
    [-p.width / 2, p.depth / 2],
  ].map(([x, y]): PlanPoint => [p.x + x! * c - y! * sn, p.y + x! * sn + y! * c]);
}

/** Ecken und Kanten, an denen etwas einrastet oder andockt */
export interface SnapTargets {
  points: PlanPoint[];
  lines: [PlanPoint, PlanPoint][];
}

/**
 * Ziele zum Einrasten: Ecken und Kanten von Umriss, Flächen und der Linie der Wände; mit «faces» auch die Seiten und
 * Ecken der Wände und eckigen Säulen (zum Andocken von Flächen und Säulen). Ohne die gerade bearbeiteten Formen.
 */
export function snapTargets(
  c: FloorShapes,
  opts: { faces: boolean; exceptLists?: PlanPoint[][]; exceptWallIds?: string[]; exceptAreaId?: string; exceptPillarId?: string },
): SnapTargets {
  const exceptLists = [...(opts.exceptLists ?? []), ...c.areas.filter((a) => a.id === opts.exceptAreaId).map((a) => a.points)];
  const exceptWallIds = opts.exceptWallIds ?? [];
  const points = snapCandidates(c, exceptLists);
  const lines = snapEdges(c, exceptLists, exceptWallIds);
  if (opts.faces) {
    const polygons = wallPolygons(c.walls);
    for (const w of c.walls) {
      if (exceptWallIds.includes(w.id)) continue;
      const poly = polygons.get(w.id);
      if (!poly) continue;
      points.push(...poly);
      lines.push(...edges(poly, true));
    }
    for (const p of c.pillars) {
      if (p.id === opts.exceptPillarId || p.shape !== 'rect') continue;
      const poly = pillarPolygon(p);
      points.push(...poly);
      lines.push(...edges(poly, true));
    }
  }
  return { points, lines };
}

/** Andocken: Verschiebung und die Kanten, an denen angedockt wurde */
export interface Dock {
  dx: number;
  dy: number;
  lines: [PlanPoint, PlanPoint][];
}
interface DockCandidate {
  shift: PlanPoint;
  distance: number;
  n: PlanPoint;
  line: [PlanPoint, PlanPoint];
}
/** Die nächste Andockstelle und, quer dazu, eine zweite (für Ecken) */
function bestDock(candidates: DockCandidate[]): Dock {
  const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
  const first = sorted[0];
  if (!first) return { dx: 0, dy: 0, lines: [] };
  const second = sorted.find((c) => Math.abs(c.n[0] * first.n[0] + c.n[1] * first.n[1]) < 0.02);
  return {
    dx: first.shift[0] + (second?.shift[0] ?? 0),
    dy: first.shift[1] + (second?.shift[1] ?? 0),
    lines: second ? [first.line, second.line] : [first.line],
  };
}

/**
 * Andocken einer Form an Kanten: Liegt eine Kante der Form nahe und parallel zu einer Zielkante (und überlappen sie),
 * wird die Form so verschoben, dass beide aufeinander liegen. Danach dasselbe quer dazu, damit sie in Ecken passt.
 */
export function dockShift(shapeEdges: [PlanPoint, PlanPoint][], targets: [PlanPoint, PlanPoint][], threshold: number): Dock {
  const candidates: DockCandidate[] = [];
  for (const [s1, s2] of shapeEdges) {
    const sl = dist(s1, s2);
    if (sl < 1e-6) continue;
    const sd: PlanPoint = [(s2[0] - s1[0]) / sl, (s2[1] - s1[1]) / sl];
    for (const line of targets) {
      const [t1, t2] = line;
      const tl = dist(t1, t2);
      if (tl < 1e-6) continue;
      const td: PlanPoint = [(t2[0] - t1[0]) / tl, (t2[1] - t1[1]) / tl];
      if (Math.abs(sd[0] * td[1] - sd[1] * td[0]) > 0.02) continue;
      const n: PlanPoint = [-td[1], td[0]];
      const dn = (s1[0] - t1[0]) * n[0] + (s1[1] - t1[1]) * n[1];
      if (Math.abs(dn) > threshold) continue;
      const a0 = (s1[0] - t1[0]) * td[0] + (s1[1] - t1[1]) * td[1];
      const a1 = (s2[0] - t1[0]) * td[0] + (s2[1] - t1[1]) * td[1];
      const overlap = Math.min(Math.max(a0, a1), tl) - Math.max(Math.min(a0, a1), 0);
      if (overlap < -threshold) continue;
      candidates.push({ shift: [-n[0] * dn, -n[1] * dn], distance: Math.abs(dn), n, line });
    }
  }
  return bestDock(candidates);
}

/** Andocken einer runden Säule: ihr Rand an nahe Kanten */
export function dockCircle(center: PlanPoint, radius: number, targets: [PlanPoint, PlanPoint][], threshold: number): Dock {
  const candidates: DockCandidate[] = [];
  for (const line of targets) {
    const [t1, t2] = line;
    const tl = dist(t1, t2);
    if (tl < 1e-6) continue;
    const td: PlanPoint = [(t2[0] - t1[0]) / tl, (t2[1] - t1[1]) / tl];
    const along = (center[0] - t1[0]) * td[0] + (center[1] - t1[1]) * td[1];
    if (along < -radius || along > tl + radius) continue;
    let n: PlanPoint = [-td[1], td[0]];
    let d = (center[0] - t1[0]) * n[0] + (center[1] - t1[1]) * n[1];
    if (d < 0) {
      n = [-n[0], -n[1]];
      d = -d;
    }
    const gap = d - radius;
    if (Math.abs(gap) > threshold) continue;
    candidates.push({ shift: [-n[0] * gap, -n[1] * gap], distance: Math.abs(gap), n, line });
  }
  return bestDock(candidates);
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
  return edges(points, closed).every(([a, b]) => segmentInPolygon(a, b, polygon));
}

/** Was ausserhalb des Umrisses liegt, für den Hinweis; leer = alles drin */
export function outsideOutline(outline: PlanPoint[], c: Omit<FloorShapes, 'outline'>): string[] {
  return [
    ...c.areas.filter((a) => !shapeInPolygon(a.points, true, outline)).map((a) => `«${areaTitle(a)}»`),
    ...(c.walls.some((w) => !segmentInPolygon(w.a, w.b, outline)) ? ['eine Wand'] : []),
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

/* ---------- Wände ---------- */

/** Querschnitt einer Wand: Richtung u, Normale n (links), Länge, Dicke von lo bis hi quer zur Linie */
export function wallBand(w: Pick<PlanWall, 'a' | 'b' | 'thickness' | 'align'>) {
  const len = dist(w.a, w.b) || 1e-9;
  const u: PlanPoint = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const n: PlanPoint = [-u[1], u[0]];
  const t = w.thickness;
  const [lo, hi] = w.align === 'left' ? [0, t] : w.align === 'right' ? [-t, 0] : [-t / 2, t / 2];
  return { u, n, len, lo, hi };
}

const add = (p: PlanPoint, v: PlanPoint, k = 1): PlanPoint => [p[0] + v[0] * k, p[1] + v[1] * k];
const dot = (a: PlanPoint, b: PlanPoint) => a[0] * b[0] + a[1] * b[1];
const cross = (a: PlanPoint, b: PlanPoint) => a[0] * b[1] - a[1] * b[0];
/** Schnittpunkt zweier Geraden (Punkt und Richtung); null, wenn sie fast parallel sind */
function intersect(p: PlanPoint, d: PlanPoint, q: PlanPoint, e: PlanPoint): PlanPoint | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross([q[0] - p[0], q[1] - p[1]], e) / den;
  return add(p, d, t);
}
/** Liegt der Punkt im Querschnitt der Wand (mit Toleranz)? */
function inWall(p: PlanPoint, w: PlanWall, tolerance = 0.01): boolean {
  const { u, n, len, lo, hi } = wallBand(w);
  const rel: PlanPoint = [p[0] - w.a[0], p[1] - w.a[1]];
  const along = dot(rel, u);
  const across = dot(rel, n);
  return along >= -tolerance && along <= len + tolerance && across >= lo - tolerance && across <= hi + tolerance;
}
/** Enden anderer Wände an diesem Punkt (sie hängen zusammen und wandern beim Ziehen mit) */
export function connectedEnds(walls: PlanWall[], p: PlanPoint, exceptId?: string): { id: string; end: 'a' | 'b' }[] {
  const list: { id: string; end: 'a' | 'b' }[] = [];
  for (const w of walls) {
    if (w.id === exceptId) continue;
    if (dist(w.a, p) < 0.005) list.push({ id: w.id, end: 'a' });
    else if (dist(w.b, p) < 0.005) list.push({ id: w.id, end: 'b' });
  }
  return list;
}

/**
 * Umriss jeder Wand als Viereck, mit sauberen Ecken: Treffen genau zwei Wände mit ihren Enden aufeinander, bekommen
 * beide eine Gehrung (die Kanten schneiden sich, auch bei verschiedener Dicke). Endet eine Wand an oder in einer anderen
 * (T-Stoss, mehr als zwei Wände), reicht sie bis zu deren Rückseite. Freie Enden sind gerade abgeschnitten.
 */
export function wallPolygons(walls: PlanWall[]): Map<string, PlanPoint[]> {
  const result = new Map<string, PlanPoint[]>();
  for (const w of walls) {
    const { u, n, len, lo, hi } = wallBand(w);
    if (len < 0.005) continue;
    // Ecken am Ende: [Seite lo, Seite hi]
    const endCorners = (end: 'a' | 'b'): [PlanPoint, PlanPoint] => {
      const p = end === 'a' ? w.a : w.b;
      const away: PlanPoint = end === 'a' ? u : [-u[0], -u[1]];
      let cornerLo = add(p, n, lo);
      let cornerHi = add(p, n, hi);
      const ends = connectedEnds(walls, p, w.id);
      const touching = walls.filter((o) => o.id !== w.id && !ends.some((e) => e.id === o.id) && inWall(p, o));
      if (ends.length === 1 && !touching.length) {
        // Gehrung: gleichnamige Kanten schneiden (innen mit innen, aussen mit aussen)
        const o = walls.find((x) => x.id === ends[0]!.id)!;
        const ob = wallBand(o);
        const oAway: PlanPoint = ends[0]!.end === 'a' ? ob.u : [-ob.u[0], -ob.u[1]];
        if (Math.abs(cross(away, oAway)) > 0.05) {
          const otherOnHi = dot(oAway, n) > 0;
          const meOnHi = dot(away, ob.n) > 0;
          const oInner = add(o.a, ob.n, meOnHi ? ob.hi : ob.lo);
          const oOuter = add(o.a, ob.n, meOnHi ? ob.lo : ob.hi);
          const inner = intersect(add(w.a, n, otherOnHi ? hi : lo), u, oInner, ob.u);
          const outer = intersect(add(w.a, n, otherOnHi ? lo : hi), u, oOuter, ob.u);
          const limit = 3 * Math.max(w.thickness, o.thickness);
          if (inner && outer && dist(inner, p) < limit && dist(outer, p) < limit) {
            return otherOnHi ? [outer, inner] : [inner, outer];
          }
        }
      }
      // Stoss an andere Wände: bis zu deren Rückseite verlängern
      let ext = 0;
      const outward: PlanPoint = [-away[0], -away[1]];
      for (const o of [...touching, ...ends.map((e) => walls.find((x) => x.id === e.id)!)]) {
        const ob = wallBand(o);
        const rate = dot(outward, ob.n);
        if (Math.abs(rate) < 0.1) continue;
        const c0 = dot([p[0] - o.a[0], p[1] - o.a[1]], ob.n);
        const s = ((rate > 0 ? ob.hi : ob.lo) - c0) / rate;
        if (s > ext) ext = Math.min(s, 2);
      }
      if (ext > 0) {
        cornerLo = add(cornerLo, outward, ext);
        cornerHi = add(cornerHi, outward, ext);
      }
      return [cornerLo, cornerHi];
    };
    const [aLo, aHi] = endCorners('a');
    const [bLo, bHi] = endCorners('b');
    result.set(w.id, [aLo, bLo, bHi, aHi]);
  }
  return result;
}

/** Lage der Wände entlang einer Fläche: mittig auf den Kanten, bündig innen oder bündig aussen */
export type AlongSide = 'center' | 'inside' | 'outside';
export const ALONG_SIDE_LABELS: Record<AlongSide, string> = { center: 'Mittig', inside: 'Innen bündig', outside: 'Aussen bündig' };

/**
 * Wände auf den Kanten eines Vielecks: eine je Kante, ohne Kanten, auf denen schon eine Wand liegt. Mittig auf der
 * Kante oder bündig, die Dicke innen bzw. aussen (beim Umriss innen: die Aussenkante ist der Umriss).
 */
export function wallsAlong(points: PlanPoint[], walls: PlanWall[], side: AlongSide): { a: PlanPoint; b: PlanPoint; align: PlanWallAlign }[] {
  const covered = (a: PlanPoint, b: PlanPoint) => walls.some((w) => distanceToSegment(a, w.a, w.b) <= 0.01 && distanceToSegment(b, w.a, w.b) <= 0.01);
  const alignOf = (a: PlanPoint, b: PlanPoint): PlanWallAlign => {
    if (side === 'center') return 'center';
    const inner = sideInside(a, b, points);
    return side === 'inside' ? inner : inner === 'left' ? 'right' : 'left';
  };
  return edges(points, true)
    .filter(([a, b]) => dist(a, b) > 0.01 && !covered(a, b))
    .map(([a, b]) => ({ a: [a[0], a[1]], b: [b[0], b[1]], align: alignOf(a, b) }));
}

/** Auf welcher Seite der Kante (in Richtung a nach b) liegt das Innere des Vielecks? */
export function sideInside(a: PlanPoint, b: PlanPoint, polygon: PlanPoint[]): 'left' | 'right' {
  const { n } = wallBand({ a, b, thickness: 0, align: 'center' });
  const m: PlanPoint = [(a[0] + b[0]) / 2 + n[0] * 0.02, (a[1] + b[1]) / 2 + n[1] * 0.02];
  return pointInPolygon(m, polygon, 0) ? 'left' : 'right';
}

/* ---------- Türen und Fenster ---------- */

export interface OpeningFrame {
  /** Mitte (in der Mitte der Wanddicke), Richtung der Wand, Normale nach links, Wanddicke, Länge der Wand */
  c: PlanPoint;
  u: PlanPoint;
  n: PlanPoint;
  t: number;
  len: number;
}

/** Lage einer Tür oder eines Fensters in ihrer Wand; null, wenn die Wand fehlt */
export function openingFrame(o: Pick<PlanOpening, 'wallId' | 'offset'>, walls: PlanWall[]): OpeningFrame | null {
  const wall = walls.find((w) => w.id === o.wallId);
  if (!wall) return null;
  const { u, n, len, lo, hi } = wallBand(wall);
  if (len < 0.005) return null;
  return { c: add(add(wall.a, u, o.offset), n, (lo + hi) / 2), u, n, t: wall.thickness, len };
}

/** Zeichnung einer Tür oder eines Fensters: Lücke in der Wand, Türblätter mit Bogen, Linien des Fensters */
export function openingDrawing(o: Pick<PlanOpening, 'width' | 'kind' | 'hinge' | 'side' | 'leaf'>, f: OpeningFrame, hitHalf = 0) {
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
    const c = (tip[0] - hinge[0]) * (to[1] - hinge[1]) - (tip[1] - hinge[1]) * (to[0] - hinge[0]);
    arcs.push(`M ${tip[0]} ${tip[1]} A ${r} ${r} 0 0 ${c > 0 ? 1 : 0} ${to[0]} ${to[1]}`);
  };
  if (o.kind === 'door') {
    const start = o.hinge === 'start' ? -h : h;
    leaf(start, -start, o.width);
  } else if (o.kind === 'double') {
    // Zwei Flügel, auch verschieden breit: sie treffen sich dort, wo der erste aufhört
    const first = doubleLeaves(o)[0];
    leaf(-h, -h + first, first);
    leaf(h, -h + first, o.width - first);
  } else if (o.kind === 'window') {
    lines.push([at(-h, -half), at(h, -half)], [at(-h, half), at(h, half)], [at(-h, 0), at(h, 0)], [at(-h, -half), at(-h, half)], [at(h, -half), at(h, half)]);
  }
  return { gap, hit, leaves, arcs, lines };
}

/** Breiten der beiden Flügel einer zweiflügligen Tür; ohne Angabe gleich breit */
export function doubleLeaves(o: Pick<PlanOpening, 'width' | 'leaf'>): [number, number] {
  const first = Math.min(o.width - 0.01, Math.max(0.01, o.leaf ?? o.width / 2));
  return [first, Number((o.width - first).toFixed(6))];
}

/** Nächste Wand zu einem Punkt (bis maxDistance neben ihr): für Türen und Fenster */
export function nearestWall(p: PlanPoint, walls: PlanWall[], maxDistance: number) {
  let best: { wall: PlanWall; along: number; length: number; distance: number } | null = null;
  for (const wall of walls) {
    const { u, n, len, lo, hi } = wallBand(wall);
    const mid = (lo + hi) / 2;
    const a = add(wall.a, n, mid);
    const b = add(wall.b, n, mid);
    const d = distanceToSegment(p, a, b);
    if (d > maxDistance + wall.thickness / 2 || (best && d >= best.distance)) continue;
    best = { wall, along: dot([p[0] - wall.a[0], p[1] - wall.a[1]], u), length: len, distance: d };
  }
  return best;
}

/** Mitte einer Öffnung in der Wand: am Raster, die Öffnung bleibt ganz in der Wand; null, wenn sie zu kurz ist */
export function placeOnSegment(along: number, length: number, width: number, step = GRID_STEP): number | null {
  if (length + 1e-9 < width) return null;
  const min = width / 2;
  const max = length - width / 2;
  return Number(Math.min(max, Math.max(min, snap(along, step))).toFixed(6));
}

/** Öffnung nach dem Ändern ihrer Wand: an die Stelle ihrer alten Mitte; null, wenn sie nicht mehr passt */
export function refitOpening(o: PlanOpening, wall: PlanWall, center: PlanPoint): PlanOpening | null {
  const { u, len } = wallBand(wall);
  const offset = placeOnSegment(dot([center[0] - wall.a[0], center[1] - wall.a[1]], u), len, o.width);
  return offset === null ? null : { ...o, wallId: wall.id, offset };
}

/* ---------- Zeichen in Flächen ---------- */

/** Treppenstriche alle 30 cm quer zur längsten Kante (der Laufrichtung) */
export function stairLines(points: PlanPoint[], step = 0.3): [PlanPoint, PlanPoint][] {
  let longest = 0;
  let u: PlanPoint = [1, 0];
  for (const [a, b] of edges(points, true)) {
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

/** Massstäbe beim Drucken: Vielfache davon */
export const PRINT_SCALE_STEP = 50;

/** Druck auf A4 quer: kleinster Massstab in 50er-Schritten, bei dem das Stockwerk auf die Seite passt (277 × 170 mm) */
export function printScale(widthMeters: number, heightMeters: number): number {
  const needed = Math.max((widthMeters * 1000) / 277, (heightMeters * 1000) / 170);
  // In 50er-Schritten (1:50, 1:100, 1:150 …), damit der Plan die Seite fast füllt und der Massstab rund bleibt
  // (Entscheid vom 25.11.2026)
  return Math.max(PRINT_SCALE_STEP, Math.ceil(needed / PRINT_SCALE_STEP - 1e-9) * PRINT_SCALE_STEP);
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
