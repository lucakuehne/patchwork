/**
 * Kennung eines Vorgangs: Präfix und Nummer, z.B. PW-123 oder HS-17223 (Entscheid vom 29.10.2026). Jeder Präfix hat
 * seinen eigenen Nummernkreis; PW ist der von Patchwork, HS der aus HelpSpot übernommener Tickets.
 */
export const ITEM_PREFIXES = ['PW', 'HS'] as const;
export const DEFAULT_PREFIX = 'PW';

export interface ItemKey {
  prefix: string;
  number: number;
}

/** «PW-123» */
export const itemRef = (item: ItemKey) => `${item.prefix}-${item.number}`;

/** Gleicher Vorgang? */
export const sameItem = (a: ItemKey | null | undefined, b: ItemKey | null | undefined) =>
  !!a && !!b && a.prefix === b.prefix && a.number === b.number;

/**
 * Kennung aus Adresse oder Eingabe: «PW-123», «hs-17223» oder nur «123» (dann PW, so bleiben Links von vor dem Präfix
 * gültig). null, wenn es keine gültige Kennung ist.
 */
export function parseItemRef(value: unknown): ItemKey | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value)
    .trim()
    .match(/^(?:([a-z]{2})-?)?(\d{1,9})$/i);
  if (!match) return null;
  const prefix = (match[1] ?? DEFAULT_PREFIX).toUpperCase();
  const number = Number(match[2]);
  if (!(ITEM_PREFIXES as readonly string[]).includes(prefix) || number < 1) return null;
  return { prefix, number };
}

/** Kennungen im Text, z.B. «siehe PW-12 und HS-17223»: Stellen und Kennung, für Links im Text */
export function itemRefsInText(text: string): { index: number; length: number; key: ItemKey }[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${ITEM_PREFIXES.join('|')})-(\\d{1,9})(?![\\p{L}\\p{N}_-])`, 'gu');
  return [...text.matchAll(pattern)].map((m) => ({
    index: m.index!,
    length: m[0].length,
    key: { prefix: m[1]!, number: Number(m[2]) },
  }));
}
