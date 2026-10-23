import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodPipe } from './zod.pipe';

describe('ZodPipe', () => {
  const schema = z
    .object({ name: z.string().min(1, 'Name fehlt'), a: z.number().optional(), b: z.number().optional() })
    .refine((v) => v.a !== undefined || v.b !== undefined, 'Bitte a oder b angeben');
  const message = (value: unknown) => {
    try {
      new ZodPipe(schema).transform(value);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  it('nennt das Feld bei Fehlern in einem Feld', () => {
    expect(message({ name: '', a: 1 })).toBe('Ungültige Eingabe bei «name»: Name fehlt');
  });

  it('zeigt die eigene Meldung von Prüfungen über mehrere Felder', () => {
    expect(message({ name: 'x' })).toBe('Bitte a oder b angeben');
  });

  it('sonst eine allgemeine Meldung', () => {
    expect(message('kein Objekt')).toBe('Ungültige Eingabe');
    expect(message({ name: 'x', a: 1 })).toBeNull();
  });
});
