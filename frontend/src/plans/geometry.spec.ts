import { describe, expect, it } from 'vitest';
import {
  bbox,
  centroid,
  duplicateNames,
  floorBounds,
  formatNumber,
  isRect,
  nextFloorName,
  niceLength,
  polygonArea,
  printScale,
  rectPoints,
  snapPoint,
} from './geometry';
import type { PlanPoint, PlanRoom } from '../types';

const L: PlanPoint[] = [
  [5, 13],
  [12, 13],
  [12, 20],
  [9, 20],
  [9, 16.5],
  [5, 16.5],
];
const room = (points: PlanPoint[]): PlanRoom => ({ id: 'r', name: 'Raum', description: '', points });

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

  it('Einrasten an Ecken anderer Räume, sonst am 10-cm-Raster', () => {
    const rooms = [room(rectPoints(0, 0, 4, 3))];
    expect(snapPoint([4.2, 3.1], rooms)).toEqual([4, 3]);
    const [x, y] = snapPoint([6.04, 7.96], rooms);
    expect([x.toFixed(2), y.toFixed(2)]).toEqual(['6.00', '8.00']);
    expect(snapPoint([4.2, 3.1], rooms, rooms[0])).toEqual([4.2, 3.1]);
  });

  it('Ausdehnung des Stockwerks mit Plan, leer die Vorgabe', () => {
    expect(floorBounds([], [], null)).toEqual({ x: 0, y: 0, w: 30, h: 18 });
    const plan = { url: '', widthPx: 1000, heightPx: 500, metersPerPx: 0.04, x: 0, y: 0, calibrated: true };
    expect(floorBounds([room(rectPoints(2, 2, 5, 5))], [{ id: 'l', text: 'Lift', x: 45, y: 1 }], plan)).toEqual({ x: 0, y: 0, w: 45, h: 20 });
  });

  it('Massstabsleiste und Druckmassstab auf A4 quer', () => {
    expect(niceLength(3.2)).toBe(5);
    expect(niceLength(0.3)).toBe(0.5);
    expect(printScale(36, 20)).toBe(200);
    expect(printScale(10, 6)).toBe(50);
    expect(printScale(120, 60)).toBe(500);
  });

  it('Name des neuen Stockwerks, doppelte Raumnamen, Zahlen mit Komma', () => {
    expect([nextFloorName(undefined), nextFloorName('EG'), nextFloorName('2. OG'), nextFloorName('Dach')]).toEqual(['EG', '1. OG', '3. OG', '']);
    expect(duplicateNames(['Säntis', 'säntis ', 'Rigi', ''])).toEqual(['Säntis']);
    expect(formatNumber(24.46)).toBe('24,5');
  });
});
