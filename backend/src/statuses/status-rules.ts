import type { ItemType, StatusCategory } from '../db/schema';

export interface StatusLike {
  id: string;
  type: ItemType;
  category: StatusCategory;
  position: number;
}

export const CLOSED_CATEGORIES: readonly StatusCategory[] = ['done', 'rejected'];

/** Kategorien, die pro Typ mindestens einmal vorhanden sein müssen. */
export const REQUIRED_CATEGORIES: readonly StatusCategory[] = ['new', 'in_progress', 'done'];

/** Ersatz, wenn der Zieltyp eine Kategorie nicht kennt. */
const CATEGORY_FALLBACK: Partial<Record<StatusCategory, StatusCategory>> = {
  waiting: 'in_progress',
  rejected: 'done',
};

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  new: 'Neu',
  in_progress: 'In Arbeit',
  waiting: 'Wartend',
  done: 'Erledigt',
  rejected: 'Abgelehnt',
};

export const DEFAULT_STATUSES: {
  type: ItemType;
  key: string;
  label: string;
  category: StatusCategory;
  position: number;
}[] = [
  { type: 'incident', key: 'new', label: 'Neu', category: 'new', position: 0 },
  { type: 'incident', key: 'in_progress', label: 'In Arbeit', category: 'in_progress', position: 1 },
  { type: 'incident', key: 'waiting', label: 'Wartet auf Melder', category: 'waiting', position: 2 },
  { type: 'incident', key: 'resolved', label: 'Gelöst', category: 'done', position: 3 },
  { type: 'task', key: 'backlog', label: 'Backlog', category: 'new', position: 0 },
  { type: 'task', key: 'planned', label: 'Geplant', category: 'new', position: 1 },
  { type: 'task', key: 'in_progress', label: 'In Arbeit', category: 'in_progress', position: 2 },
  { type: 'task', key: 'done', label: 'Erledigt', category: 'done', position: 3 },
  { type: 'task', key: 'rejected', label: 'Abgelehnt', category: 'rejected', position: 4 },
];

export function isClosedCategory(category: StatusCategory): boolean {
  return CLOSED_CATEGORIES.includes(category);
}

/** Erster Status (nach Reihenfolge) einer Kategorie in einem Typ. */
export function firstOfCategory<T extends StatusLike>(
  all: readonly T[],
  type: ItemType,
  category: StatusCategory,
): T | undefined {
  return all
    .filter((s) => s.type === type && s.category === category)
    .sort((a, b) => a.position - b.position)[0];
}

/**
 * Zielstatus beim Typwechsel: erster Status derselben Kategorie im Zieltyp,
 * sonst über die Ersatzkategorie.
 */
export function mapStatusForTypeChange<T extends StatusLike>(
  all: readonly T[],
  current: StatusLike,
  targetType: ItemType,
): T {
  let category: StatusCategory | undefined = current.category;
  while (category) {
    const match = firstOfCategory(all, targetType, category);
    if (match) return match;
    category = CATEGORY_FALLBACK[category];
  }
  // Durch REQUIRED_CATEGORIES ist «Neu» immer vorhanden
  const fallback = firstOfCategory(all, targetType, 'new');
  if (!fallback) throw new Error(`Für Typ ${targetType} ist kein Status der Kategorie «Neu» definiert`);
  return fallback;
}

/** Prüft, ob die Statusliste eines Typs alle Pflichtkategorien enthält. Gibt fehlende Kategorien zurück. */
export function missingCategories(all: readonly StatusLike[], type: ItemType): StatusCategory[] {
  return REQUIRED_CATEGORIES.filter((c) => !all.some((s) => s.type === type && s.category === c));
}
