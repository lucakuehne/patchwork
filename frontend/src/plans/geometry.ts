import type { PlanBackground, PlanLabel, PlanPoint, PlanRoom } from '../types';

/** Pläne (Entscheid vom 20.11.2026): Masse in Metern, Ursprung oben links, y nach unten */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Raster beim Zeichnen: 10 cm */
export const GRID_STEP = 0.1;
/** Ecken anderer Räume rasten bis zu diesem Abstand ein (Meter) */
export const VERTEX_SNAP = 0.35;
/** Grösse eines leeren Stockwerks für die erste Ansicht */
export const EMPTY_FLOOR: Box = { x: 0, y: 0, w: 30, h: 18 };

export const snap = (v: number) => Math.round(v / GRID_STEP) * GRID_STEP;
export const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);

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

/** Schwerpunkt, für die Beschriftung des Raums */
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

/** Ausdehnung des Stockwerks: Räume, Beschriftungen und Plan; leer die Vorgabe */
export function floorBounds(rooms: PlanRoom[], labels: PlanLabel[], plan: PlanBackground | null): Box {
  const points: PlanPoint[] = [...rooms.flatMap((r) => r.points), ...labels.map((l): PlanPoint => [l.x, l.y])];
  if (plan) {
    points.push([plan.x, plan.y], [plan.x + plan.widthPx * plan.metersPerPx, plan.y + plan.heightPx * plan.metersPerPx]);
  }
  return points.length ? bbox(points) : EMPTY_FLOOR;
}

/** Einrasten: an Ecken anderer Räume, sonst am Raster */
export function snapPoint(p: PlanPoint, rooms: PlanRoom[], except?: PlanRoom, threshold = VERTEX_SNAP): PlanPoint {
  let best: PlanPoint | null = null;
  let bestDistance = threshold;
  for (const room of rooms) {
    if (room === except) continue;
    for (const q of room.points) {
      const d = dist(q, p);
      if (d < bestDistance) {
        best = q;
        bestDistance = d;
      }
    }
  }
  return best ? [best[0], best[1]] : [snap(p[0]), snap(p[1])];
}

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

/** Schriftgrösse des Raumnamens in Metern: passt in die Breite des Raums */
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

/** Namen, die im Stockwerk mehrfach vorkommen (Gross-/Kleinschreibung egal) */
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
