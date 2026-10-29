import { DEFAULT_PREFIX, itemRef, type ItemKey } from './item-ref';

/**
 * Verweise von Einträgen auf andere Vorgänge (Verknüpfungen, Duplikate, Zusammenführen). Ist der andere Vorgang für den
 * Betrachter gesperrt (Bereiche je Rolle), bleibt nur die Kennung: ohne Titel und mit «refHidden», damit die Oberfläche
 * keinen Link zeigt. Zur Nummer gehört ein Präfix (seit 29.10.2026); ältere Einträge ohne Präfix verweisen auf PW.
 */
const REFERENCE_FIELDS: { number: string; prefix: string; title: string | null }[] = [
  { number: 'otherNumber', prefix: 'otherPrefix', title: 'otherTitle' },
  { number: 'mergedFrom', prefix: 'mergedFromPrefix', title: 'mergedTitle' },
  { number: 'duplicateOf', prefix: 'duplicateOfPrefix', title: null },
  { number: 'viaDuplicate', prefix: 'viaDuplicatePrefix', title: null },
];

type Meta = Record<string, unknown> | null;

/** Felder für einen Verweis im Meta eines neuen Eintrags, z.B. { otherNumber: 12, otherPrefix: 'PW' } */
export function referenceMeta(field: 'other' | 'mergedFrom' | 'duplicateOf' | 'viaDuplicate', item: ItemKey) {
  return field === 'other'
    ? { otherNumber: item.number, otherPrefix: item.prefix }
    : { [field]: item.number, [`${field}Prefix`]: item.prefix };
}

const keyIn = (meta: Meta, field: (typeof REFERENCE_FIELDS)[number]): ItemKey | null => {
  const raw = meta?.[field.number];
  const value = Number(raw);
  if (raw === undefined || raw === null || !Number.isInteger(value) || value <= 0) return null;
  const prefix = meta?.[field.prefix];
  return { prefix: typeof prefix === 'string' && prefix ? prefix : DEFAULT_PREFIX, number: value };
};

/** Kennungen der Vorgänge, auf die die Einträge verweisen */
export function referencedKeys(metas: Meta[]): ItemKey[] {
  const found = new Map<string, ItemKey>();
  for (const meta of metas) {
    for (const field of REFERENCE_FIELDS) {
      const key = keyIn(meta, field);
      if (key) found.set(itemRef(key), key);
    }
  }
  return [...found.values()];
}

/**
 * Meta eines Eintrags mit dem Typ des Vorgangs, auf den er verweist («refType», null = Eingang), damit die Oberfläche ihn
 * je nach Einstellung als Seite oder Fenster öffnet; gesperrte Vorgänge zusätzlich ohne Titel (hideReferences). Schlüssel
 * von «hidden» und «types» ist die Kennung («PW-12»).
 */
export function annotateReferences(meta: Meta, hidden: ReadonlySet<string>, types: ReadonlyMap<string, string | null>): Meta {
  const masked = hideReferences(meta, hidden);
  if (!masked) return masked;
  const key = REFERENCE_FIELDS.map((f) => keyIn(masked, f)).find((k) => k !== null);
  const ref = key ? itemRef(key) : null;
  if (ref === null || !types.has(ref) || masked.refHidden) return masked;
  return { ...masked, refType: types.get(ref) };
}

/** Meta eines Eintrags ohne Titel gesperrter Vorgänge, mit «refHidden» */
export function hideReferences(meta: Meta, hidden: ReadonlySet<string>): Meta {
  if (!meta || hidden.size === 0) return meta;
  const refs = REFERENCE_FIELDS.filter((f) => {
    const key = keyIn(meta, f);
    return key !== null && hidden.has(itemRef(key));
  });
  if (refs.length === 0) return meta;
  const copy: Record<string, unknown> = { ...meta, refHidden: true };
  for (const f of refs) if (f.title) delete copy[f.title];
  return copy;
}
