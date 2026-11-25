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
  snapEdges,
  snapPoint,
  angleSnap,
  rayHitsSegment,
  wallDirectionsAt,
  snapDetail,
  snapTargets,
  dockShift,
  dockCircle,
  pillarPolygon,
  gridStepFor,
  edges,
  stairLines,
  wallPolygons,
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
const wall = (a: PlanPoint, b: PlanPoint, parts: Partial<PlanWall> = {}): PlanWall => ({ id: 'w', a, b, thickness: 0.2, align: 'center', ...parts });
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

  it('Einrasten an Ecken von Umriss, Flächen und Wänden, sonst am 5-cm-Raster', () => {
    const own = rectPoints(10, 10, 2, 2);
    const c = shapes({ outline: rectPoints(-1, -1, 30, 20), areas: [area(rectPoints(0, 0, 4, 3)), area(own)], walls: [wall([6, 6], [8, 6])] });
    const candidates = snapCandidates(c, [own]);
    expect(snapPoint([4.2, 3.1], candidates)).toEqual([4, 3]);
    expect(snapPoint([7.9, 6.1], candidates)).toEqual([8, 6]);
    expect(snapPoint([10.1, 10.1], candidates)).toEqual([10.1, 10.1]);
    // Auf einer Kante: auf der Linie, entlang der Kante am Raster
    const lines = snapEdges(c, [own]);
    expect(snapPoint([2.03, 3.12], candidates, 0.35, lines)).toEqual([2.05, 3]);
    expect(snapPoint([7.03, 5.9], candidates, 0.35, lines)).toEqual([7.05, 6]);
    expect(snapPoint([11.03, 10.1], candidates, 0.35, lines)).toEqual([11.05, 10.1]);
    expect(snapPoint([6.04, 7.96], candidates)).toEqual([6.05, 7.95]);
    expect(snapPoint([6.02, 7.98], candidates)).toEqual([6, 8]);
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
      walls: [wall([1, 7], [12, 7])],
      pillars: [{ id: 'p', shape: 'rect' as const, x: 9.9, y: 7.9, width: 0.3, depth: 0.3, rotation: 0 }],
      labels: [{ id: 'l', text: 'Parkplatz', x: 15, y: 1 }],
    };
    expect(outsideOutline(outline, c)).toEqual(['«Lager»', 'eine Wand', '«Parkplatz»']);
  });
});

describe('Türen und Fenster', () => {
  const w = wall([0, 0], [5, 0]);
  const door: PlanOpening = { id: 'o', wallId: 'w', offset: 2, width: 0.9, kind: 'door', hinge: 'start', side: 'left' };

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
    expect(openingFrame({ ...door, wallId: 'x' }, [w])).toBeNull();
    // Bündige Wand: die Öffnung sitzt in der Mitte der Dicke
    expect(round([openingFrame(door, [{ ...w, align: 'left' }])!.c])).toEqual([[2, 0.1]]);
  });

  it('bleibt ganz in der Wand, auf 5 cm', () => {
    expect(placeOnSegment(0.1, 5, 0.9)).toBe(0.45);
    expect(placeOnSegment(2.32, 5, 0.9)).toBe(2.3);
    expect(placeOnSegment(4.9, 5, 0.9)).toBe(4.55);
    expect(placeOnSegment(1, 0.8, 0.9)).toBeNull();
  });

  it('wandert mit, wenn sich die Wand ändert', () => {
    expect(refitOpening(door, wall([1, 0], [5, 0]), [2, 0])).toEqual({ ...door, offset: 1 });
    // Zu kurz: fällt weg
    expect(refitOpening(door, wall([0, 0], [0.5, 0]), [2, 0])).toBeNull();
  });
});

describe('Wände', () => {
  const room = rectPoints(0, 0, 4, 3);

  it('entlang einer Fläche: eine je Kante, mittig; Kanten mit Wand fallen weg', () => {
    const pieces = wallsAlong(room, [], 'center');
    expect(pieces.map((p) => [p.a, p.b, p.align])).toEqual([
      [[0, 0], [4, 0], 'center'],
      [[4, 0], [4, 3], 'center'],
      [[4, 3], [0, 3], 'center'],
      [[0, 3], [0, 0], 'center'],
    ]);
    expect(wallsAlong(room, [wall([-2, 0], [6, 0])], 'center')).toHaveLength(3);
  });

  it('entlang einer Fläche bündig: die Dicke innen oder aussen', () => {
    const within = (side: 'inside' | 'outside') =>
      wallsAlong(room, [], side).map((p) => {
        const poly = wallPolygons([{ id: 'x', a: p.a, b: p.b, thickness: 0.2, align: p.align }]).get('x')!;
        return poly.every(([x, y]) => x >= -1e-9 && x <= 4 + 1e-9 && y >= -1e-9 && y <= 3 + 1e-9);
      });
    expect(within('inside')).toEqual([true, true, true, true]);
    expect(within('outside')).toEqual([false, false, false, false]);
  });

  it('entlang des Umrisses: bündig innen, egal in welcher Richtung er gezeichnet ist', () => {
    const inside = (points: PlanPoint[]) =>
      wallsAlong(points, [], 'inside').map((p) => {
        const poly = wallPolygons([{ id: 'x', a: p.a, b: p.b, thickness: 0.3, align: p.align }]).get('x')!;
        return poly.every(([x, y]) => x >= -1e-9 && x <= 4 + 1e-9 && y >= -1e-9 && y <= 3 + 1e-9);
      });
    expect(inside(room)).toEqual([true, true, true, true]);
    expect(inside([...room].reverse())).toEqual([true, true, true, true]);
  });

  it('Ecken: Gehrung bei zwei Wänden, auch verschieden dick; T-Stoss bis zur Rückseite; freie Enden gerade', () => {
    // L-Ecke: 30 cm aussen (bündig innen = unten), 10 cm innen (mittig)
    const outer = wall([0, 0], [6, 0], { id: 'o', thickness: 0.3, align: 'left' });
    const inner = wall([0, 0], [0, 4], { id: 'i', thickness: 0.1 });
    const polys = wallPolygons([outer, inner]);
    // Die Aussenwand liegt zwischen y = 0 und 0.3 (Seite der Normalen, bei y nach unten also unten); die Innenwand stösst an
    expect(round(polys.get('o')!)).toEqual([[-0.05, 0], [6, 0], [6, 0.3], [0.05, 0.3]]);
    expect(round(polys.get('i')!)).toEqual([[0.05, 0.3], [0.05, 4], [-0.05, 4], [-0.05, 0]]);
    // T-Stoss: Wand endet an der Mitte einer anderen und reicht bis zu deren Rückseite
    const t = wall([3, 2], [3, 0.15], { id: 't', thickness: 0.1 });
    expect(round(wallPolygons([outer, inner, t]).get('t')!)).toEqual([[2.95, 2], [2.95, 0], [3.05, 0], [3.05, 2]]);
    // Freies Ende: gerade abgeschnitten
    expect(round(wallPolygons([wall([0, 0], [2, 0])]).get('w')!)).toEqual([[0, -0.1], [2, -0.1], [2, 0.1], [0, 0.1]]);
  });
});

describe('Raster, Einrasten und Andocken', () => {
  // Zwei Wände 20 cm dick (mittig): oben von (0,0) nach (6,0), links von (0,0) nach (0,4); Innenseiten bei y = 0.1 und x = 0.1
  const top = wall([0, 0], [6, 0], { id: 'top' });
  const left = wall([0, 0], [0, 4], { id: 'left' });
  const floor = shapes({ outline: rectPoints(-1, -1, 10, 10), walls: [top, left] });

  it('Raster 5 cm, nah herangezoomt 1 cm', () => {
    expect(gridStepFor(26)).toBe(0.05);
    expect(gridStepFor(150)).toBe(0.01);
    expect(snapPoint([1.234, 2.346], [], 0.35, [], 0.01)).toEqual([1.23, 2.35]);
  });

  it('sagt, woran der Punkt einrastet', () => {
    const t = snapTargets(floor, { faces: true });
    expect(snapDetail([0.12, 0.09], t.points, 0.05, t.lines).vertex).toEqual([0.1, 0.1]);
    const onFace = snapDetail([2.02, 0.12], t.points, 0.05, t.lines, 0.01);
    expect(onFace.p).toEqual([2.02, 0.1]);
    expect(onFace.edge).toBeDefined();
    // Ohne Seiten der Wände nur die Linie der Wand
    const axis = snapTargets(floor, { faces: false });
    expect(snapDetail([2.02, 0.03], axis.points, 0.05, axis.lines, 0.01).p).toEqual([2.02, 0]);
  });

  it('eckige Säule dockt an eine Wandseite, in der Ecke an beide', () => {
    const lines = snapTargets(floor, { faces: true }).lines;
    // 30 cm, Mitte 3 cm unter der Wand: die Oberkante (y = 0.27 - 0.15 = 0.12) dockt an die Seite bei y = 0.1
    const near = dockShift(edges(pillarPolygon({ x: 3, y: 0.27, width: 0.3, depth: 0.3, rotation: 0 }), true), lines, 0.1);
    expect([near.dx, Number(near.dy.toFixed(6))]).toEqual([0, -0.02]);
    expect(near.lines).toHaveLength(1);
    // In der Ecke: an beide Wände
    const corner = dockShift(edges(pillarPolygon({ x: 0.3, y: 0.28, width: 0.3, depth: 0.3, rotation: 0 }), true), lines, 0.1);
    expect([Number(corner.dx.toFixed(6)), Number(corner.dy.toFixed(6))]).toEqual([-0.05, -0.03]);
    expect(corner.lines).toHaveLength(2);
    // Zu weit weg oder schräg: nichts
    expect(dockShift(edges(pillarPolygon({ x: 3, y: 0.6, width: 0.3, depth: 0.3, rotation: 0 }), true), lines, 0.1).lines).toEqual([]);
    expect(dockShift(edges(pillarPolygon({ x: 3, y: 0.3, width: 0.3, depth: 0.3, rotation: 30 }), true), lines, 0.1).lines).toEqual([]);
  });

  it('runde Säule dockt mit ihrem Rand an', () => {
    const lines = snapTargets(floor, { faces: true }).lines;
    const dock = dockCircle([3, 0.35], 0.2, lines, 0.1);
    expect([dock.dx, Number(dock.dy.toFixed(6))]).toEqual([0, -0.05]);
  });

  it('Fläche dockt mit ihrer Kante an eine Wandseite', () => {
    const lines = snapTargets(floor, { faces: true }).lines;
    const dock = dockShift(edges(rectPoints(0.16, 0.13, 3, 2), true), lines, 0.1);
    expect([Number(dock.dx.toFixed(6)), Number(dock.dy.toFixed(6))]).toEqual([-0.06, -0.03]);
  });

  it('Säule im Umriss eckig gedreht', () => {
    expect(pillarPolygon({ x: 1, y: 1, width: 0.4, depth: 0.2, rotation: 90 }).map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])).toEqual([
      [1.1, 0.8],
      [1.1, 1.2],
      [0.9, 1.2],
      [0.9, 0.8],
    ]);
  });
});

describe('Wände rechtwinklig', () => {
  it('rastet rechtwinklig oder in Flucht zur Bezugsrichtung ein, die Länge am Raster', () => {
    // Vorherige Wand geht von (0,0) nach (4,0), weiter ab (4,0): Bezug zeigt zurück nach (0,0)
    const back: PlanPoint = [-4, 0];
    const down = angleSnap([4, 0], [4.12, 2.53], [back]);
    expect(down?.p).toEqual([4, 2.55]);
    expect(down?.rightTo).toEqual([-1, 0]);
    const straight = angleSnap([4, 0], [6.02, 0.1], [back]);
    expect(straight?.p).toEqual([6, 0]);
    expect(straight?.rightTo).toBeUndefined();
    // Zu schräg: nichts
    expect(angleSnap([4, 0], [5, 1], [back])).toBeNull();
    // Schräge Bezugswand (45°): rechtwinklig dazu
    const skew = angleSnap([0, 0], [1.02, -0.98], [[1, 1]], 0.01);
    expect(skew?.dir.map((v) => Number(v.toFixed(4)))).toEqual([0.7071, -0.7071]);
    // Ohne Bezug: waagrecht oder senkrecht
    expect(angleSnap([1, 1], [1.08, 3.2], [])?.p).toEqual([1, 3.2]);
  });

  it('trifft eine Kante, Bezugsrichtungen an einem Punkt', () => {
    expect(rayHitsSegment([0, 0], [0, 1], [-1, 2], [1, 2])).toEqual([0, 2]);
    expect(rayHitsSegment([0, 0], [0, 1], [1, 2], [3, 2])).toBeNull();
    const walls = [wall([0, 0], [4, 0], { id: 'a' }), wall([4, 0], [4, 3], { id: 'b' }), wall([2, -1], [2, 1], { id: 'c' })];
    expect(wallDirectionsAt(walls, [4, 0])).toEqual([[-4, 0], [0, 3]]);
    expect(wallDirectionsAt(walls, [2, 0.5], ['a'])).toEqual([[0, 2]]);
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
