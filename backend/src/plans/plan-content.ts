import { z } from 'zod';

/**
 * Inhalt eines Stockwerks (Pläne, Entscheid vom 20.11.2026): Räume, Beschriftungen und der Plan im Hintergrund. Masse in
 * Metern, Ursprung oben links. Gespeichert wird der ganze Inhalt auf einmal («Speichern» im Bearbeiten).
 */
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 200;
export const LABEL_MAX = 40;
/** Plan als Bild: höchstens so gross */
export const PLAN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PLAN_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const coordinate = z.number().finite().min(-10000).max(10000);
const point = z.tuple([coordinate, coordinate]);

/** Name von Standort, Gebäude und Stockwerk */
export const nodeNameSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(NAME_MAX, `Name: höchstens ${NAME_MAX} Zeichen`),
});

const roomSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Ein Raum hat keinen Namen').max(NAME_MAX, `Raumname: höchstens ${NAME_MAX} Zeichen`),
  description: z.string().trim().max(DESCRIPTION_MAX, `Beschreibung: höchstens ${DESCRIPTION_MAX} Zeichen`).default(''),
  points: z.array(point).min(3, 'Ein Raum braucht mindestens drei Ecken').max(200),
});

const labelSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1, 'Eine Beschriftung ist leer').max(LABEL_MAX, `Beschriftung: höchstens ${LABEL_MAX} Zeichen`),
  x: coordinate,
  y: coordinate,
});

/** Plan im Hintergrund; «replace»: das Bild kommt mit dieser Anfrage (neu hochgeladen) */
const planSchema = z.object({
  replace: z.boolean(),
  widthPx: z.number().int().min(1).max(40000),
  heightPx: z.number().int().min(1).max(40000),
  metersPerPx: z.number().positive().max(100),
  x: coordinate,
  y: coordinate,
  calibrated: z.boolean(),
});

export const floorContentSchema = z
  .object({
    rooms: z.array(roomSchema).max(1000),
    labels: z.array(labelSchema).max(1000),
    plan: planSchema.nullable(),
    /** Stand beim Laden: Hat inzwischen jemand anderes gespeichert, gilt das nicht einfach weiter */
    contentUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((content, ctx) => {
    const duplicates = duplicateNames(content.rooms.map((r) => r.name));
    if (duplicates.length) {
      ctx.addIssue({ code: 'custom', message: `Diese Namen gibt es im Stockwerk doppelt: «${duplicates.join('», «')}»` });
    }
    const tiny = content.rooms.find((r) => polygonArea(r.points) < 0.01);
    if (tiny) ctx.addIssue({ code: 'custom', message: `Der Raum «${tiny.name}» hat keine Fläche` });
  });
export type FloorContent = z.infer<typeof floorContentSchema>;

/** Namen, die mehrfach vorkommen (Gross-/Kleinschreibung egal), in der ersten Schreibweise */
export function duplicateNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) duplicates.set(key, seen.get(key)!);
    else seen.set(key, name.trim());
  }
  return [...duplicates.values()];
}

/** Fläche eines Vielecks in m² (Gausssche Trapezformel) */
export function polygonArea(points: [number, number][]): number {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}
