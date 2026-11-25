import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { usePlanEditor } from './editor';
import { doubleLeaves, openingDrawing, openingFrame, rectPoints } from './geometry';
import type { PlanFloor } from '../types';

const floor = (): PlanFloor => ({
  id: 'f',
  name: 'EG',
  site: { id: 's', name: 'Hauptsitz' },
  building: { id: 'b', name: 'Gebäude A' },
  outline: null,
  areas: [],
  walls: [],
  pillars: [],
  openings: [],
  labels: [],
  plan: null,
  layers: { plan: true, areas: true, structure: true, labels: true },
  contentUpdatedAt: '2026-11-25T10:00:00.000Z',
});
/**
 * Der Verlauf hält Änderungen nach einem Augenblick als Schritt fest: erst läuft der Beobachter (nextTick), dann dessen
 * Zeitgeber. Mit kontrollierter Zeit statt echtem Warten, sonst hängt die Reihenfolge von der Last des Rechners ab.
 */
const settle = async () => {
  await nextTick();
  vi.runAllTimers();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Rückgängig und Wiederholen', () => {
  it('jede Änderung ein Schritt, rückwärts und vorwärts', async () => {
    const e = usePlanEditor();
    e.show(floor());
    e.startEdit();
    await settle();
    expect([e.canUndo.value, e.canRedo.value]).toEqual([false, false]);

    e.addArea(rectPoints(0, 0, 4, 3));
    await settle();
    e.state.options.areaKind = 'corridor';
    e.addArea(rectPoints(4, 0, 2, 3));
    await settle();
    expect(e.state.history.undo).toBe(2);

    e.undo();
    expect(e.state.draft!.areas.map((a) => a.kind)).toEqual(['room']);
    e.undo();
    expect(e.state.draft!.areas).toEqual([]);
    expect(e.state.draft!.outline).toBeNull();
    expect([e.canUndo.value, e.canRedo.value]).toEqual([false, true]);
    e.redo();
    expect(e.state.draft!.areas).toHaveLength(1);
    expect(e.state.draft!.outline).not.toBeNull();

    // Eine neue Änderung nach Rückgängig: Wiederholen geht nicht mehr
    e.addLabel([1, 1]);
    await settle();
    expect(e.canRedo.value).toBe(false);
  });

  it('Ziehen bzw. Tippen wird ein Schritt beim Loslassen, die Auswahl ohne Element fällt weg', async () => {
    const e = usePlanEditor();
    e.show(floor());
    e.startEdit();
    e.addArea(rectPoints(0, 0, 4, 3));
    await settle();
    const before = e.state.history.undo;
    e.hold(true);
    const area = e.state.draft!.areas[0]!;
    for (const x of [1, 2, 3]) area.points[2] = [4 + x / 10, 3];
    await settle();
    expect(e.state.history.undo).toBe(before);
    e.hold(false);
    expect(e.state.history.undo).toBe(before + 1);
    e.undo();
    expect(e.state.draft!.areas[0]!.points[2]).toEqual([4, 3]);
    // Fläche ausgewählt, dann zurück vor die Fläche: keine Auswahl mehr
    e.select('area', area.id);
    e.undo();
    expect(e.state.selection).toBeNull();
  });

  it('nach Verwerfen beginnt der Verlauf neu', async () => {
    const e = usePlanEditor();
    e.show(floor());
    e.startEdit();
    e.addArea(rectPoints(0, 0, 4, 3));
    await settle();
    e.discard();
    e.startEdit();
    await settle();
    expect([e.canUndo.value, e.state.history.undo, e.state.history.redo]).toEqual([false, 0, 0]);
  });
});

describe('Ebenen und Ausschnitt', () => {
  it('beim Ansehen vorübergehend, beim Bearbeiten im Entwurf (gespeichert für alle)', () => {
    const e = usePlanEditor();
    e.show({ ...floor(), layers: { plan: false, areas: true, structure: true, labels: true } });
    expect(e.layers.value.plan).toBe(false);
    e.layers.value.areas = false;
    expect([e.state.layers.areas, e.dirty.value]).toEqual([false, false]);
    e.startEdit();
    expect(e.layers.value.areas).toBe(true);
    e.layers.value.labels = false;
    expect([e.state.draft!.layers.labels, e.dirty.value]).toEqual([false, true]);
  });

  it('ganzes Stockwerk: der Umriss, ohne Umriss der Plan', () => {
    const e = usePlanEditor();
    const plan = { url: '', widthPx: 1000, heightPx: 500, metersPerPx: 0.05, x: -10, y: -5, calibrated: true };
    e.show({ ...floor(), plan });
    expect(e.bounds.value).toEqual({ x: -10, y: -5, w: 50, h: 25 });
    e.show({ ...floor(), plan, outline: rectPoints(0, 0, 12, 8) });
    expect(e.bounds.value).toEqual({ x: 0, y: 0, w: 12, h: 8 });
  });
});

describe('Zweiflüglige Tür', () => {
  it('gleiche oder ungleiche Flügel, die sich in der Öffnung treffen', () => {
    expect(doubleLeaves({ width: 1.6 })).toEqual([0.8, 0.8]);
    expect(doubleLeaves({ width: 1.3, leaf: 0.9 })).toEqual([0.9, 0.4]);
    const wall = { id: 'w', a: [0, 0] as [number, number], b: [5, 0] as [number, number], thickness: 0.2, align: 'center' as const };
    const door = { wallId: 'w', offset: 2, width: 1.3, leaf: 0.9, kind: 'double' as const, hinge: 'start' as const, side: 'left' as const };
    const d = openingDrawing(door, openingFrame(door, [wall])!);
    // Erster Flügel 90 cm ab 1.35, zweiter 40 cm ab 2.65; beide Bögen enden bei 2.25
    expect(d.arcs[0]).toMatch(/A 0\.9 0\.9 0 0 [01] 2\.25 0\.1$/);
    expect(d.arcs[1]).toMatch(/A 0\.4 0\.4 0 0 [01] 2\.25 0\.1$/);
  });
});
