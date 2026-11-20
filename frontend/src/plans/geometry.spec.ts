import { describe, expect, it } from 'vitest';
import {
  bbox,
  centroid,
  crossLines,
  duplicateNames,
  floorBounds,
  formatNumber,
  growOutline,
  isRect,
  nextFloorName,
  niceLength,
  normalizeRing,
  openingDrawing,
  openingFrame,
  outsideOutline,
  placeOnSegment,
  polygonArea,
  printScale,
  rectPoints,
  refitOpening,
  segmentInPolygon,
  snapCandidates,
  snapPoint,
  stairLines,
  wallsAlong,
  type FloorShapes,
} from './geometry';
import type { PlanArea, PlanOpening, PlanPoint, PlanWall } from '../types';

const L: PlanPoint[] = [
  [5, 13],
  [12, 13],
  [12, 20],
  [9, 20],
  [9, 16.5],
  [5, 16.5],
];
const area = (points: PlanPoint[], kind: PlanArea['kind'] = 'room'): PlanArea => ({ id: 'a', kind, name: 'Raum', description: '', points });
const wall = (points: PlanPoint[], closed = false, id = 'w'): PlanWall => ({ id, points, closed, thickness: 0.2 });
const shapes = (parts: Partial<FloorShapes>): FloorShapes => ({ outline: null, areas: [], walls: [], pillars: [], labels: [], ...parts });
const round = (points: PlanPoint[]) => points.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);

describe('Geometrie der Pläne', () => {
  it('Fläche, Schwerpunkt, Ausdehnung', () => {
    expect(polygonArea(rectPoints(0, 0, 4, 3))).toBe(12);
    expect(polygonArea(L)).toBe(35);
    const [cx, cy] = centroid(L);
    expect([cx.toFixed(2), cy.toFixed(2)]).toEqual(['9.10', '15.80']);
    expect(bbox(L)).toEqual({ x: 5, y: 13, w: 7, h: 7 });
    expect(isRect(rectPoints(1, 2, 3, 4))).toBe(true);
    expect(isRect(L)).toBe(false);
  });

  it('Einrasten an Ecken von Umriss, Flächen und Wänden, sonst am 10-cm-Raster', () => {
    const own = rectPoints(10, 10, 2, 2);
    const c = shapes({ outline: rectPoints(-1, -1, 30, 20), areas: [area(rectPoints(0, 0, 4, 3)), area(own)], walls: [wall([[6, 6], [8, 6]])] });
    const candidates = snapCandidates(c, own);
    expect(snapPoint([4.2, 3.1], candidates)).toEqual([4, 3]);
    expect(snapPoint([7.9, 6.1], candidates)).toEqual([8, 6]);
    expect(snapPoint([10.1, 10.1], candidates)).toEqual([10.1, 10.1]);
    const [x, y] = snapPoint([6.04, 7.96], candidates);
    expect([x.toFixed(2), y.toFixed(2)]).toEqual(['6.00', '8.00']);
  });

  it('Ausdehnung des Stockwerks mit Umriss und Plan, leer die Vorgabe', () => {
    expect(floorBounds(shapes({}), null)).toEqual({ x: 0, y: 0, w: 30, h: 18 });
    const plan = { url: '', widthPx: 1000, heightPx: 500, metersPerPx: 0.04, x: 0, y: 0, calibrated: true };
    expect(floorBounds(shapes({ outline: rectPoints(2, 2, 5, 5), labels: [{ id: 'l', text: 'Lift', x: 45, y: 1 }] }), plan)).toEqual({ x: 0, y: 0, w: 45, h: 20 });
  });

  it('Massstabsleiste und Druckmassstab auf A4 quer', () => {
    expect(niceLength(3.2)).toBe(5);
    expect(niceLength(0.3)).toBe(0.5);
    expect(printScale(36, 20)).toBe(200);
    expect(printScale(10, 6)).toBe(50);
    expect(printScale(120, 60)).toBe(500);
  });

  it('Name des neuen Stockwerks, doppelte Namen, Zahlen mit Komma', () => {
    expect([nextFloorName(undefined), nextFloorName('EG'), nextFloorName('2. OG'), nextFloorName('Dach')]).toEqual(['EG', '1. OG', '3. OG', '']);
    expect(duplicateNames(['Säntis', 'säntis ', 'Rigi', '', ''])).toEqual(['Säntis']);
    expect(formatNumber(24.46)).toBe('24,5');
  });
});

describe('Umriss', () => {
  const outline = rectPoints(0, 0, 10, 8);

  it('Strecken durch eine einspringende Ecke: innen nur, wenn sie den Umriss nicht verlassen', () => {
    expect(segmentInPolygon([6, 13.5], [12, 19.5], L)).toBe(true);
    expect(segmentInPolygon([6, 16], [10, 19], L)).toBe(false);
  });

  it('wächst mit einer Fläche, die über ihn hinausgeht; ganz ausserhalb geht nicht', () => {
    expect(growOutline(outline, rectPoints(2, 2, 3, 3))).toBe(outline);
    // Anbau rechts: L-förmiger Umriss
    const grown = growOutline(outline, rectPoints(8, 4, 6, 4))!;
    expect(polygonArea(grown)).toBe(80 + 6 * 4 - 2 * 4);
    expect(grown).toHaveLength(6);
    // Bündig angesetzt (gemeinsame Kante): ein Stück
    expect(polygonArea(growOutline(outline, rectPoints(10, 0, 4, 8))!)).toBe(112);
    // Ohne Berührung
    expect(growOutline(outline, rectPoints(12, 0, 2, 2))).toBeNull();
  });

  it('Ecken auf Millimeter, ohne doppelte und überflüssige', () => {
    expect(round(normalizeRing([[0, 0], [5.0000004, 0], [10, 0], [10, 8], [0, 8], [0, 0]]))).toEqual([
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ]);
  });

  it('nennt, was ausserhalb liegt', () => {
    const c = {
      areas: [area(rectPoints(1, 1, 2, 2)), { ...area(rectPoints(9, 1, 3, 2)), name: 'Lager' }],
      walls: [wall([[1, 7], [12, 7]])],
      pillars: [{ id: 'p', shape: 'rect' as const, x: 9.9, y: 7.9, width: 0.3, depth: 0.3, rotation: 0 }],
      labels: [{ id: 'l', text: 'Parkplatz', x: 15, y: 1 }],
    };
    expect(outsideOutline(outline, c)).toEqual(['«Lager»', 'eine Wand', '«Parkplatz»']);
  });
});

describe('Türen und Fenster', () => {
  const w = wall([[0, 0], [5, 0], [5, 4]]);
  const door: PlanOpening = { id: 'o', wallId: 'w', segment: 0, offset: 2, width: 0.9, kind: 'door', hinge: 'start', side: 'left' };

  it('Lage in der Wand und Zeichnung mit Türblatt und Bogen', () => {
    const f = openingFrame(door, [w])!;
    expect(f.c).toEqual([2, 0]);
    expect(f.len).toBe(5);
    const d = openingDrawing(door, f);
    expect(round(d.gap)).toEqual([[1.55, -0.11], [2.45, -0.11], [2.45, 0.11], [1.55, 0.11]]);
    expect(round(d.leaves[0]!)).toEqual([[1.55, 0.1], [1.55, 1]]);
    expect(d.arcs[0]).toMatch(/^M 1\.55 1(\.0+\d*)? A 0\.9 0\.9 0 0 [01] 2\.45 0\.1/);
    expect(openingDrawing({ ...door, kind: 'double', width: 1.6 }, f).leaves).toHaveLength(2);
    expect(openingDrawing({ ...door, kind: 'window' }, f).lines).toHaveLength(5);
    expect(openingFrame({ ...door, segment: 2 }, [w])).toBeNull();
  });

  it('bleibt ganz im Wandstück, auf 5 cm', () => {
    expect(placeOnSegment(0.1, 5, 0.9)).toBe(0.45);
    expect(placeOnSegment(2.32, 5, 0.9)).toBe(2.3);
    expect(placeOnSegment(4.9, 5, 0.9)).toBe(4.55);
    expect(placeOnSegment(1, 0.8, 0.9)).toBeNull();
  });

  it('wandert mit, wenn sich die Wand ändert', () => {
    // Ecke eingefügt: die Tür liegt danach auf dem zweiten Abschnitt
    const changed = wall([[0, 0], [1, 0], [5, 0], [5, 4]]);
    expect(refitOpening(door, changed, [2, 0])).toEqual({ ...door, segment: 1, offset: 1 });
    // Abschnitt zu kurz: fällt weg
    expect(refitOpening(door, wall([[0, 0], [0.5, 0]]), [2, 0])).toBeNull();
  });
});

describe('Wände entlang einer Fläche', () => {
  const room = rectPoints(0, 0, 4, 3);

  it('alle Kanten frei: eine geschlossene Wand', () => {
    expect(wallsAlong(room, [])).toEqual([{ points: room, closed: true }]);
  });

  it('Kanten mit Wand fallen weg, der Rest als zusammenhängende Linienzüge', () => {
    // Obere Kante liegt schon auf einer längeren Wand
    expect(wallsAlong(room, [wall([[-2, 0], [6, 0]])])).toEqual([
      {
        points: [
          [4, 0],
          [4, 3],
          [0, 3],
          [0, 0],
        ],
        closed: false,
      },
    ]);
    expect(wallsAlong(room, [wall(room, true)])).toEqual([]);
  });
});

describe('Zeichen in Flächen', () => {
  it('Treppenstriche quer zur Laufrichtung, Kreuz für Lift und Schacht', () => {
    const lines = stairLines(rectPoints(0, 0, 3, 1.2));
    expect(lines).toHaveLength(9);
    expect(lines.every(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9)).toBe(true);
    expect(crossLines(rectPoints(0, 0, 2, 2))).toEqual([
      [[0, 0], [2, 2]],
      [[2, 0], [0, 2]],
    ]);
  });
});
