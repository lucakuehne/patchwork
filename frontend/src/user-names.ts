export interface PersonNames {
  firstName: string;
  lastName: string;
}

/** Wie initcap in PostgreSQL (Migration 0024): Anfang jedes Wortteils gross, Rest klein, z.B. «anna-maria» → «Anna-Maria» */
const initcap = (s: string) =>
  s.toLowerCase().replace(/(^|[^\p{L}\p{N}])([\p{L}\p{N}])/gu, (_all, before: string, first: string) => before + first.toUpperCase());

/**
 * Vor- und Nachname aus einem Anzeigenamen schätzen (Vorbelegung beim Anlegen eines lokalen Kontos):
 * «Muster, Anna» → Anna / Muster; «Anna Maria Muster» → Anna Maria / Muster; «anna.muster» → Anna / Muster; ein
 * einzelnes Wort gilt als Vorname. Gleiche Regeln wie splitName im Backend (backend/src/users/user-names.ts).
 */
export function splitName(name: string): PersonNames {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastName: '' };
  const comma = trimmed.indexOf(',');
  if (comma >= 0) {
    return { firstName: trimmed.slice(comma + 1).trim(), lastName: trimmed.slice(0, comma).trim() };
  }
  const words = trimmed.split(' ');
  if (words.length > 1) return { firstName: words.slice(0, -1).join(' '), lastName: words.at(-1)! };
  const parts = trimmed.split(/[._]+/).filter(Boolean);
  if (parts.length > 1 && !trimmed.includes('@')) {
    const capitalized = parts.map(initcap);
    return { firstName: capitalized.slice(0, -1).join(' '), lastName: capitalized.at(-1)! };
  }
  return { firstName: trimmed, lastName: '' };
}

/**
 * Vor- und Nachname, nachdem der Name geändert wurde: Felder, die man nicht selbst geändert hat («manual»), folgen dem
 * Namen, die übrigen bleiben.
 */
export function followName(name: string, current: PersonNames, manual: Record<keyof PersonNames, boolean>): PersonNames {
  const split = splitName(name);
  return {
    firstName: manual.firstName ? current.firstName : split.firstName,
    lastName: manual.lastName ? current.lastName : split.lastName,
  };
}
