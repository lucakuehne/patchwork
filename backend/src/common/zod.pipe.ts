import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Validiert Request-Daten mit einem zod-Schema. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path.join('.');
      if (path) throw new BadRequestException(`Ungültige Eingabe bei «${path}»: ${first.message}`);
      // Eigene Prüfungen über mehrere Felder (refine/superRefine ohne Pfad) haben eine verständliche Meldung
      throw new BadRequestException(first?.code === 'custom' ? first.message : 'Ungültige Eingabe');
    }
    return result.data;
  }
}

export const uuidParam = z.uuid();

/** Optionale UUID, leerer String wird zu null. */
export const nullableUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable());

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Ungültige E-Mail-Adresse'));
