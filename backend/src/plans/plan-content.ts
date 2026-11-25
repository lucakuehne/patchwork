import { z } from 'zod';
import {
  AREA_KIND_LABELS,
  AREA_KINDS,
  OPENING_KINDS,
  WALL_ALIGNS,
  pointInPolygon,
  polygonArea,
  segmentInPolygon,
  shapeInPolygon,
  wallLength,
  type PlanPoint,
} from './plan-shapes';

export { polygonArea } from './plan-shapes';

/**
 * Inhalt eines Stockwerks (Pläne, Entscheide vom 20.11.2026): Umriss, Flächen, Bauteile (Wände, Säulen, Türen und
 * Fenster), Beschriftungen und der Plan im Hintergrund. Masse in Metern, Ursprung oben links. Gespeichert wird der ganze
 * Inhalt auf einmal («Speichern» im Bearbeiten).
 */
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 200;
export const LABEL_MAX = 40;
/** Plan als Bild: höchstens so gross */
export const PLAN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PLAN_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const coordinate = z.number().finite().min(-10000).max(10000);
const point = z.tuple([coordinate, coordinate]);
const meters = (min: number, max: number, what: string) =>
  z
    .number()
    .finite()
    .min(min, `${what}: mindestens ${Math.round(min * 100)} cm`)
    .max(max, `${what}: höchstens ${Math.round(max * 100)} cm`);

/** Name von Standort, Gebäude und Stockwerk */
export const nodeNameSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(NAME_MAX, `Name: höchstens ${NAME_MAX} Zeichen`),
});

const areaSchema = z.object({
  id: z.uuid(),
  kind: z.enum(AREA_KINDS).default('room'),
  /** Pflicht bei Räumen (unten geprüft), sonst freiwillig */
  name: z.string().trim().max(NAME_MAX, `Name: höchstens ${NAME_MAX} Zeichen`).default(''),
  description: z.string().trim().max(DESCRIPTION_MAX, `Beschreibung: höchstens ${DESCRIPTION_MAX} Zeichen`).default(''),
  points: z.array(point).min(3, 'Eine Fläche braucht mindestens drei Ecken').max(200),
});

/** Wand: ein gerades Stück (Entscheid vom 20.11.2026), mittig oder bündig auf ihrer Linie */
const wallSchema = z.object({
  id: z.uuid(),
  a: point,
  b: point,
  thickness: meters(0.02, 2, 'Wanddicke'),
  align: z.enum(WALL_ALIGNS).default('center'),
});

const pillarSchema = z.object({
  id: z.uuid(),
  shape: z.enum(['rect', 'round']),
  x: coordinate,
  y: coordinate,
  width: meters(0.05, 5, 'Säule'),
  depth: meters(0.05, 5, 'Säule'),
  rotation: z.number().finite().min(0).max(360).default(0),
});

const openingSchema = z.object({
  id: z.uuid(),
  wallId: z.uuid(),
  offset: z.number().finite().min(0),
  width: meters(0.2, 10, 'Breite'),
  kind: z.enum(OPENING_KINDS),
  hinge: z.enum(['start', 'end']).default('start'),
  side: z.enum(['left', 'right']).default('left'),
  /** Zweiflüglige Tür mit ungleichen Flügeln: Breite des ersten Flügels (Entscheid vom 25.11.2026) */
  leaf: z.number().finite().positive().optional(),
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

const areaName = (a: { kind: keyof typeof AREA_KIND_LABELS; name: string }) => a.name || AREA_KIND_LABELS[a.kind];

export const floorContentSchema = z
  .object({
    outline: z.array(point).min(3, 'Der Umriss braucht mindestens drei Ecken').max(500).nullable().default(null),
    areas: z.array(areaSchema).max(1000),
    walls: z.array(wallSchema).max(2000).default([]),
    pillars: z.array(pillarSchema).max(1000).default([]),
    openings: z.array(openingSchema).max(2000).default([]),
    /** Sichtbare Ebenen des Stockwerks, für alle (Entscheid vom 25.11.2026) */
    layers: z
      .object({ plan: z.boolean(), areas: z.boolean(), structure: z.boolean(), labels: z.boolean() })
      .default({ plan: true, areas: true, structure: true, labels: true }),
    labels: z.array(labelSchema).max(1000),
    plan: planSchema.nullable(),
    /** Stand beim Laden: Hat inzwischen jemand anderes gespeichert, gilt das nicht einfach weiter */
    contentUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    // Flächen: Räume brauchen einen Namen, Namen eindeutig, jede Fläche hat eine Fläche
    const unnamed = c.areas.filter((a) => a.kind === 'room' && !a.name).length;
    if (unnamed) issue(unnamed === 1 ? 'Ein Raum hat keinen Namen' : `${unnamed} Räume haben keinen Namen`);
    const duplicates = duplicateNames(c.areas.map((a) => a.name));
    if (duplicates.length) issue(`Diese Namen gibt es im Stockwerk doppelt: «${duplicates.join('», «')}»`);
    const tiny = c.areas.find((a) => polygonArea(a.points) < 0.01);
    if (tiny) issue(`Die Fläche «${areaName(tiny)}» hat keine Fläche`);

    // Wände haben eine Länge; Türen und Fenster passen in ihre Wand
    const walls = new Map(c.walls.map((w) => [w.id, w]));
    if (c.walls.some((w) => wallLength(w) < 0.01)) issue('Eine Wand hat keine Länge');
    for (const o of c.openings) {
      const wall = walls.get(o.wallId);
      if (!wall) {
        issue(`${o.kind === 'window' ? 'Ein Fenster' : 'Eine Tür'} gehört zu keiner Wand`);
        continue;
      }
      const length = wallLength(wall);
      if (o.offset - o.width / 2 < -0.01 || o.offset + o.width / 2 > length + 0.01) {
        issue(`${o.kind === 'window' ? 'Ein Fenster' : 'Eine Tür'} ist breiter als ihre Wand`);
      }
      if (o.kind === 'double' && o.leaf !== undefined && (o.leaf < 0.1 - 1e-9 || o.leaf > o.width - 0.1 + 1e-9)) {
        issue('Ein Flügel einer zweiflügligen Tür ist schmaler als 10 cm');
      }
    }

    // Umriss: Pflicht, sobald etwas im Stockwerk ist, und er umschliesst alles
    const empty = !c.areas.length && !c.walls.length && !c.pillars.length && !c.labels.length;
    if (!c.outline) {
      if (!empty) issue('Das Stockwerk braucht einen Umriss');
      return;
    }
    const outline = c.outline as PlanPoint[];
    if (polygonArea(outline) < 0.01) {
      issue('Der Umriss hat keine Fläche');
      return;
    }
    const outside = [
      ...c.areas.filter((a) => !shapeInPolygon(a.points, true, outline)).map((a) => `«${areaName(a)}»`),
      ...(c.walls.some((w) => !segmentInPolygon(w.a, w.b, outline)) ? ['eine Wand'] : []),
      ...(c.pillars.some((p) => !pointInPolygon([p.x, p.y], outline)) ? ['eine Säule'] : []),
      ...c.labels.filter((l) => !pointInPolygon([l.x, l.y], outline)).map((l) => `die Beschriftung «${l.text}»`),
    ];
    if (outside.length) issue(`Der Umriss muss alles im Stockwerk umschliessen, ausserhalb liegt: ${outside.slice(0, 5).join(', ')}`);
  });
export type FloorContent = z.infer<typeof floorContentSchema>;

/** Namen, die mehrfach vorkommen (Gross-/Kleinschreibung egal, leere zählen nicht), in der ersten Schreibweise */
export function duplicateNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) duplicates.set(key, seen.get(key)!);
    else seen.set(key, name.trim());
  }
  return [...duplicates.values()];
}
