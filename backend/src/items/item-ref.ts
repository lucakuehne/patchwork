import { and, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { items } from '../db/schema';

/**
 * Kennung eines Vorgangs: Präfix und Nummer, z.B. PW-123 oder HS-17223 (Entscheid vom 29.10.2026). Jeder Präfix hat
 * seinen eigenen Nummernkreis; PW ist der von Patchwork, HS der aus HelpSpot übernommener Tickets.
 */
export const ITEM_PREFIXES = ['PW', 'HS'] as const;
export type ItemPrefix = (typeof ITEM_PREFIXES)[number];
export const DEFAULT_PREFIX: ItemPrefix = 'PW';
/** Aus HelpSpot übernommene Tickets: Ticket 17223 wird HS-17223 */
export const HELPSPOT_PREFIX: ItemPrefix = 'HS';

export interface ItemKey {
  prefix: string;
  number: number;
}

/** «PW-123» */
export const itemRef = (item: ItemKey) => `${item.prefix}-${item.number}`;

const MAX_NUMBER = 999_999_999;

/**
 * Kennung aus der Adresse, einem Parameter oder einer Eingabe: «PW-123», «hs-17223» oder nur «123» (dann PW, so
 * bleiben Links von vor dem Präfix gültig). null, wenn es keine gültige Kennung ist.
 */
export function parseItemRef(value: string | number | null | undefined): ItemKey | null {
  if (value === null || value === undefined) return null;
  const match = String(value)
    .trim()
    .match(/^(?:([a-z]{2})-?)?(\d{1,9})$/i);
  if (!match) return null;
  const prefix = (match[1] ?? DEFAULT_PREFIX).toUpperCase();
  const number = Number(match[2]);
  if (!(ITEM_PREFIXES as readonly string[]).includes(prefix) || number < 1 || number > MAX_NUMBER) return null;
  return { prefix, number };
}

/** Kennung in einer Eingabe (Text oder Zahl), z.B. «PW-12», «HS-17223» oder nur «12» (PW) */
export const itemRefSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const key = parseItemRef(value);
  if (!key) {
    ctx.addIssue({ code: 'custom', message: 'Ungültige Kennung, erwartet z.B. PW-123' });
    return z.NEVER;
  }
  return key;
});

/** Bedingung für genau diesen Vorgang */
export const byKey = (key: ItemKey): SQL => and(eq(items.prefix, key.prefix), eq(items.number, key.number))!;

const PREFIX_PATTERN = ITEM_PREFIXES.join('|');

/**
 * Kennung aus einem Betreff: «[PW-1234]» bzw. «[HS-17223]» von Patchwork, «Ticket:{17223}» aus Mails von HelpSpot
 * (gehört zum übernommenen Vorgang HS-17223).
 */
export function itemKeyFromSubject(subject: string | undefined): ItemKey | null {
  if (!subject) return null;
  const own = subject.match(new RegExp(`\\[(${PREFIX_PATTERN})-(\\d{1,9})\\]`, 'i'));
  if (own) return { prefix: own[1]!.toUpperCase(), number: Number(own[2]) };
  const helpSpot = subject.match(/Ticket:\s*\{(\d{1,9})\}/i);
  if (helpSpot) return { prefix: 'HS', number: Number(helpSpot[1]) };
  return null;
}
