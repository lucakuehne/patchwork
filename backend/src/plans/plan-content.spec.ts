import { describe, expect, it } from 'vitest';
import { duplicateNames, floorContentSchema, polygonArea } from './plan-content';
import { pointInPolygon, segmentInPolygon, shapeInPolygon, type PlanPoint } from './plan-shapes';

const rect = (x: number, y: number, w: number, h: number): PlanPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
/** L-förmiger Umriss: 20 × 10 m, rechts oben 10 × 5 m ausgespart */
const L: PlanPoint[] = [
  [0, 0],
  [10, 0],
  [10, 5],
  [20, 5],
  [20, 10],
  [0, 10],
];
const area = (name: string, points = rect(0, 0, 4, 3), kind = 'room') => ({ id: crypto.randomUUID(), kind, name, description: '', points });
const wall = (a: PlanPoint, b: PlanPoint) => ({ id: crypto.randomUUID(), a, b, thickness: 0.2 });
const content = (parts: Record<string, unknown>) => ({
  outline: rect(-1, -1, 30, 20),
  areas: [],
  labels: [],
  plan: null,
  contentUpdatedAt: new Date().toISOString(),
  ...parts,
});
const message = (parts: Record<string, unknown>) => floorContentSchema.safeParse(content(parts)).error?.issues.map((i) => i.message).join(' | ');

describe('Geometrie: liegt im Umriss', () => {
  it('Punkte innen, auf dem Rand und aussen', () => {
    expect(pointInPolygon([5, 5], L)).toBe(true);
    expect(pointInPolygon([10, 2], L)).toBe(true);
    expect(pointInPolygon([15, 2], L)).toBe(false);
    expect(pointInPolygon([20.005, 7], L)).toBe(true);
  });

  it('Strecken quer durch die Aussparung sind aussen, auch wenn beide Enden innen liegen', () => {
    expect(segmentInPolygon([8, 1], [18, 7], L)).toBe(false);
    // Genau durch die einspringende Ecke: innen
    expect(segmentInPolygon([5, 2], [15, 8], L)).toBe(true);
    expect(segmentInPolygon([2, 8], [18, 8], L)).toBe(true);
    // Entlang des Rands
    expect(segmentInPolygon([0, 0], [10, 0], L)).toBe(true);
    expect(segmentInPolygon([10, 0], [10, 10], L)).toBe(true);
    // Über die einspringende Ecke hinaus
    expect(segmentInPolygon([10, 0], [20, 10], L)).toBe(false);
  });

  it('Vielecke und Linienzüge', () => {
    expect(shapeInPolygon(rect(1, 1, 8, 8), true, L)).toBe(true);
    expect(shapeInPolygon(rect(8, 1, 4, 3), true, L)).toBe(false);
    expect(shapeInPolygon([[1, 6], [19, 6], [19, 9]], false, L)).toBe(true);
  });
});

describe('Inhalt eines Stockwerks', () => {
  it('Fläche: Rechteck und L-Form', () => {
    expect(polygonArea(rect(0, 0, 4, 3))).toBe(12);
    expect(polygonArea(L)).toBe(150);
  });

  it('Namen eindeutig im Stockwerk, auch über die Arten; Flächen ohne Namen zählen nicht', () => {
    expect(duplicateNames(['Säntis', 'Pilatus', 'säntis ', 'Rigi', '', ''])).toEqual(['Säntis']);
    expect(message({ areas: [area('Säntis'), area('SÄNTIS', rect(5, 0, 2, 2), 'corridor')] })).toBe('Diese Namen gibt es im Stockwerk doppelt: «Säntis»');
    expect(message({ areas: [area('', rect(0, 0, 2, 2), 'corridor'), area('', rect(3, 0, 2, 2), 'stairs')] })).toBeUndefined();
  });

  it('Räume brauchen einen Namen, die anderen Arten nicht', () => {
    expect(message({ areas: [area(' ')] })).toBe('Ein Raum hat keinen Namen');
    expect(message({ areas: [area('', rect(0, 0, 4, 3), 'corridor')] })).toBeUndefined();
    expect(message({ areas: [area('Gang', rect(0, 0, 4, 3), 'garage')] })).toBeDefined();
    expect(message({ areas: [area('Strich', [[0, 0], [4, 0], [8, 0]])] })).toBe('Die Fläche «Strich» hat keine Fläche');
  });

  it('Umriss: Pflicht mit Inhalt, leer erlaubt; er umschliesst alles', () => {
    expect(message({ outline: null })).toBeUndefined();
    expect(message({ outline: null, areas: [area('Büro')] })).toBe('Das Stockwerk braucht einen Umriss');
    expect(message({ outline: L, areas: [area('Büro', rect(8, 1, 4, 3))] })).toBe(
      'Der Umriss muss alles im Stockwerk umschliessen, ausserhalb liegt: «Büro»',
    );
    expect(message({ outline: L, walls: [wall([8, 1], [18, 7])] })).toContain('eine Wand');
    expect(
      message({ outline: L, pillars: [{ id: crypto.randomUUID(), shape: 'round', x: 15, y: 2, width: 0.3, depth: 0.3, rotation: 0 }] }),
    ).toContain('eine Säule');
    expect(message({ outline: L, labels: [{ id: crypto.randomUUID(), text: 'Parkplatz', x: 15, y: 2 }] })).toContain('«Parkplatz»');
    // Wand auf dem Rand des Umrisses, Säule in der Ecke
    expect(
      message({
        outline: L,
        walls: L.map((p, i) => wall(p, L[(i + 1) % L.length]!)),
        pillars: [{ id: crypto.randomUUID(), shape: 'rect', x: 10, y: 5, width: 0.3, depth: 0.3, rotation: 45 }],
      }),
    ).toBeUndefined();
  });

  it('Türen und Fenster gehören zu einer Wand und passen in ihren Abschnitt', () => {
    const w = wall([0, 0], [5, 0]);
    const w2 = wall([5, 0], [5, 4]);
    const opening = (parts: Record<string, unknown>) => ({ id: crypto.randomUUID(), wallId: w.id, offset: 2, width: 0.9, kind: 'door', ...parts });
    const walls = [w, w2];
    expect(message({ walls, openings: [opening({}), opening({ wallId: w2.id, offset: 3.4, width: 1.2, kind: 'window' })] })).toBeUndefined();
    expect(message({ walls, openings: [opening({ wallId: crypto.randomUUID() })] })).toBe('Eine Tür gehört zu keiner Wand');
    expect(message({ walls, openings: [opening({ wallId: w2.id, offset: 3.8, width: 1.2, kind: 'window' })] })).toBe('Ein Fenster ist breiter als ihre Wand');
    expect(message({ walls, openings: [opening({ kind: 'garage' })] })).toBeDefined();
    // Zweiflüglig mit ungleichen Flügeln: 90 + 40 cm; ein Flügel unter 10 cm geht nicht
    expect(message({ walls, openings: [opening({ kind: 'double', width: 1.3, leaf: 0.9 })] })).toBeUndefined();
    expect(message({ walls, openings: [opening({ kind: 'double', width: 1.3, leaf: 1.25 })] })).toBe('Ein Flügel einer zweiflügligen Tür ist schmaler als 10 cm');
  });

  it('Wände: gerade Stücke mit Dicke in Grenzen, Lage mittig oder bündig', () => {
    expect(message({ walls: [{ ...wall([0, 0], [4, 0]), thickness: 0.01 }] })).toBe('Wanddicke: mindestens 2 cm');
    expect(message({ walls: [wall([1, 1], [1, 1])] })).toBe('Eine Wand hat keine Länge');
    expect(message({ walls: [{ ...wall([0, 0], [4, 0]), align: 'left' }, { ...wall([4, 0], [4, 3]), align: 'right' }] })).toBeUndefined();
    expect(message({ walls: [{ ...wall([0, 0], [4, 0]), align: 'oben' }] })).toBeDefined();
    expect(floorContentSchema.parse(content({ walls: [wall([0, 0], [4, 0])] })).walls[0]?.align).toBe('center');
  });
});
