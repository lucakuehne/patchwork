import { describe, expect, it } from 'vitest';
import { duplicateNames, floorContentSchema, polygonArea } from './plan-content';

const room = (name: string, points: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]]) => ({
  id: crypto.randomUUID(),
  name,
  description: '',
  points,
});
const content = (rooms: ReturnType<typeof room>[]) => ({ rooms, labels: [], plan: null, contentUpdatedAt: new Date().toISOString() });

describe('Inhalt eines Stockwerks', () => {
  it('Fläche: Rechteck und L-Form', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12);
    expect(polygonArea([[5, 13], [12, 13], [12, 20], [9, 20], [9, 16.5], [5, 16.5]])).toBe(35);
  });

  it('Namen eindeutig im Stockwerk, Gross-/Kleinschreibung egal', () => {
    expect(duplicateNames(['Säntis', 'Pilatus', 'säntis ', 'Rigi'])).toEqual(['Säntis']);
    const result = floorContentSchema.safeParse(content([room('Säntis'), room('SÄNTIS')]));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Diese Namen gibt es im Stockwerk doppelt: «Säntis»');
  });

  it('Raum ohne Namen, ohne Fläche oder mit zu wenigen Ecken', () => {
    expect(floorContentSchema.safeParse(content([room(' ')])).success).toBe(false);
    expect(floorContentSchema.safeParse(content([room('Strich', [[0, 0], [4, 0], [8, 0]])])).error?.issues[0]?.message).toBe(
      'Der Raum «Strich» hat keine Fläche',
    );
    expect(floorContentSchema.safeParse(content([room('Zwei', [[0, 0], [4, 0]])])).success).toBe(false);
    expect(floorContentSchema.safeParse(content([room('Büro'), room('Lager')])).success).toBe(true);
  });
});
