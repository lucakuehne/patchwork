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

/** Farben zur Auswahl für Status (das Frontend kennt die Farbwerte, hell und dunkel) */
export const STATUS_COLORS = ['gray', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'brown'] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

/** Farbe eines neuen Status: die bisherige Farbe seiner Kategorie */
export const CATEGORY_COLORS: Record<StatusCategory, StatusColor> = {
  new: 'blue',
  in_progress: 'orange',
  waiting: 'gray',
  done: 'green',
  rejected: 'red',
};

export const DEFAULT_STATUSES: {
  type: ItemType;
  key: string;
  label: string;
  category: StatusCategory;
  position: number;
  color: StatusColor;
}[] = [
  { type: 'incident', key: 'new', label: 'Neu', category: 'new', position: 0, color: 'blue' },
  { type: 'incident', key: 'in_progress', label: 'In Arbeit', category: 'in_progress', position: 1, color: 'orange' },
  { type: 'incident', key: 'waiting', label: 'Wartet auf Melder', category: 'waiting', position: 2, color: 'gray' },
  { type: 'incident', key: 'resolved', label: 'Gelöst', category: 'done', position: 3, color: 'green' },
  { type: 'task', key: 'backlog', label: 'Backlog', category: 'new', position: 0, color: 'blue' },
  { type: 'task', key: 'planned', label: 'Geplant', category: 'new', position: 1, color: 'blue' },
  { type: 'task', key: 'in_progress', label: 'In Arbeit', category: 'in_progress', position: 2, color: 'orange' },
  { type: 'task', key: 'done', label: 'Erledigt', category: 'done', position: 3, color: 'green' },
  { type: 'task', key: 'rejected', label: 'Abgelehnt', category: 'rejected', position: 4, color: 'red' },
];

/**
 * Darf ein Vorgang von Hand von einem Status in einen anderen wechseln? Ist der Ablauf eines Typs nicht eingeschränkt,
 * ist jeder Wechsel erlaubt, sonst nur die festgelegten. Automatische Wechsel prüfen das nicht.
 */
export function transitionAllowed(
  restricted: boolean,
  transitions: { fromId: string; toId: string }[],
  fromId: string | null,
  toId: string,
): boolean {
  if (!restricted || !fromId || fromId === toId) return true;
  return transitions.some((t) => t.fromId === fromId && t.toId === toId);
}

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
