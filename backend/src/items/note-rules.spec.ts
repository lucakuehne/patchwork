import { describe, expect, it } from 'vitest';
import { noteEditRefusal, noteTimeRefusal } from './note-rules';

const created = new Date('2026-10-15T10:00:00Z');
const note = { kind: 'note' as const, authorId: 'ada', meta: null, createdAt: created };
const after = (minutes: number) => new Date(created.getTime() + minutes * 60_000);

describe('noteEditRefusal', () => {
  it('erlaubt die eigene Notiz in den ersten Minuten', () => {
    expect(noteEditRefusal(note, 'ada', after(4))).toBeNull();
  });

  it('lässt eine begonnene Bearbeitung noch kurz nach Ablauf speichern', () => {
    expect(noteEditRefusal(note, 'ada', after(9))).toBeNull();
  });

  it('lehnt nach Ablauf der Frist ab', () => {
    expect(noteEditRefusal(note, 'ada', after(11))?.reason).toBe('expired');
  });

  it('lehnt fremde Notizen ab', () => {
    expect(noteEditRefusal(note, 'ivan', after(1))?.reason).toBe('author');
  });

  it('im Namen eines anderen erfasst: Autor und erfassender Admin dürfen, sonst niemand', () => {
    const onBehalf = { ...note, authorId: 'ivan', recordedById: 'ada' };
    expect(noteEditRefusal(onBehalf, 'ivan', after(1))).toBeNull();
    expect(noteEditRefusal(onBehalf, 'ada', after(1))).toBeNull();
    expect(noteEditRefusal(onBehalf, 'carla', after(1))?.reason).toBe('author');
    expect(noteEditRefusal(onBehalf, 'ada', after(11))?.reason).toBe('expired');
  });

  it('lehnt öffentliche Antworten und per Mail eingegangene Notizen ab', () => {
    expect(noteEditRefusal({ ...note, kind: 'reply' }, 'ada', after(1))?.reason).toBe('kind');
    expect(noteEditRefusal({ ...note, meta: { source: 'mail', external: true } }, 'ada', after(1))?.reason).toBe('kind');
  });

  it('zählt die Frist ab der ursprünglichen Zeit, wenn ein Admin die Zeit angepasst hat', () => {
    const moved = { ...note, createdAt: new Date('2026-10-14T08:00:00Z'), originalCreatedAt: created };
    expect(noteEditRefusal(moved, 'ada', after(4))).toBeNull();
    expect(noteEditRefusal(moved, 'ada', after(11))?.reason).toBe('expired');
  });
});

describe('noteTimeRefusal', () => {
  const now = new Date('2026-10-27T09:00:00Z');

  it('erlaubt jede Zeit in der Vergangenheit, auch lange zurück', () => {
    expect(noteTimeRefusal({ kind: 'note' }, new Date('2026-10-27T08:59:00Z'), now)).toBeNull();
    expect(noteTimeRefusal({ kind: 'note' }, new Date('2025-01-01T00:00:00Z'), now)).toBeNull();
  });

  it('lässt eine knappe Abweichung der Uhren zu, lehnt die Zukunft ab', () => {
    expect(noteTimeRefusal({ kind: 'note' }, new Date('2026-10-27T09:00:30Z'), now)).toBeNull();
    expect(noteTimeRefusal({ kind: 'note' }, new Date('2026-10-27T09:05:00Z'), now)).toMatch(/Zukunft/);
  });

  it('nur bei internen Notizen', () => {
    expect(noteTimeRefusal({ kind: 'reply' }, new Date('2026-10-27T08:00:00Z'), now)).toMatch(/internen Notizen/);
    expect(noteTimeRefusal({ kind: 'status' }, new Date('2026-10-27T08:00:00Z'), now)).not.toBeNull();
  });
});
