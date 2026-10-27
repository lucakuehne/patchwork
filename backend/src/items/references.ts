/**
 * Verweise von Einträgen auf andere Vorgänge (Verknüpfungen, Duplikate, Zusammenführen). Ist der andere Vorgang für den
 * Betrachter gesperrt (Bereiche je Rolle), bleibt nur die Nummer: ohne Titel und mit «refHidden», damit die Oberfläche
 * keinen Link zeigt.
 */
const REFERENCE_FIELDS: { number: string; title: string | null }[] = [
  { number: 'otherNumber', title: 'otherTitle' },
  { number: 'mergedFrom', title: 'mergedTitle' },
  { number: 'duplicateOf', title: null },
  { number: 'viaDuplicate', title: null },
];

type Meta = Record<string, unknown> | null;

const numberIn = (meta: Meta, field: string): number | null => {
  const value = Number(meta?.[field]);
  return meta?.[field] !== undefined && meta[field] !== null && Number.isInteger(value) && value > 0 ? value : null;
};

/** Nummern der Vorgänge, auf die die Einträge verweisen */
export function referencedNumbers(metas: Meta[]): number[] {
  const found = new Set<number>();
  for (const meta of metas) {
    for (const field of REFERENCE_FIELDS) {
      const n = numberIn(meta, field.number);
      if (n !== null) found.add(n);
    }
  }
  return [...found];
}

/**
 * Meta eines Eintrags mit dem Typ des Vorgangs, auf den er verweist («refType», null = Eingang), damit die Oberfläche ihn
 * je nach Einstellung als Seite oder Fenster öffnet; gesperrte Vorgänge zusätzlich ohne Titel (hideReferences).
 */
export function annotateReferences(meta: Meta, hidden: ReadonlySet<number>, types: ReadonlyMap<number, string | null>): Meta {
  const masked = hideReferences(meta, hidden);
  if (!masked) return masked;
  const field = REFERENCE_FIELDS.find((f) => numberIn(masked, f.number) !== null);
  const number = field ? numberIn(masked, field.number) : null;
  if (number === null || !types.has(number) || masked.refHidden) return masked;
  return { ...masked, refType: types.get(number) };
}

/** Meta eines Eintrags ohne Titel gesperrter Vorgänge, mit «refHidden» */
export function hideReferences(meta: Meta, hidden: ReadonlySet<number>): Meta {
  if (!meta || hidden.size === 0) return meta;
  const refs = REFERENCE_FIELDS.filter((f) => {
    const n = numberIn(meta, f.number);
    return n !== null && hidden.has(n);
  });
  if (refs.length === 0) return meta;
  const copy: Record<string, unknown> = { ...meta, refHidden: true };
  for (const f of refs) if (f.title) delete copy[f.title];
  return copy;
}
