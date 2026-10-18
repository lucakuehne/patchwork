import { describe, expect, it } from 'vitest';
import { noteEditRefusal } from './note-rules';

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

  it('lehnt öffentliche Antworten und per Mail eingegangene Notizen ab', () => {
    expect(noteEditRefusal({ ...note, kind: 'reply' }, 'ada', after(1))?.reason).toBe('kind');
    expect(noteEditRefusal({ ...note, meta: { source: 'mail', external: true } }, 'ada', after(1))?.reason).toBe('kind');
  });
});
