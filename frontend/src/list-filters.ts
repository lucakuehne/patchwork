import type { Priority } from './types';

/**
 * Filter und Sortierung der Listen (Entscheid vom 26.10.2026): Priorität, Zuständig, Status und Meldeweg, jeweils
 * «alle» (leer) oder ein Wert; «none» = ohne Zuständigen bzw. ohne Meldeweg. Sortieren per Klick auf den Spaltenkopf:
 * aufsteigend, absteigend, dann wieder die Reihenfolge der Ansicht.
 */
export interface ListFilterValues {
  priority: Priority | '';
  assignee: string;
  status: string;
  channel: string;
}

export const EMPTY_FILTERS: ListFilterValues = { priority: '', assignee: '', status: '', channel: '' };

/** «age» ist die Spalte «Alter»: aufsteigend = die jüngsten zuerst (Erfassungsdatum absteigend) */
export type SortField = 'number' | 'title' | 'status' | 'priority' | 'channel' | 'reporter' | 'assignee' | 'age' | 'closed';

export interface ListSort {
  field: SortField;
  dir: 'asc' | 'desc';
}

export const activeFilters = (filters: ListFilterValues) =>
  (Object.keys(EMPTY_FILTERS) as (keyof ListFilterValues)[]).filter((key) => filters[key] !== '').length;

/** Parameter für /items */
export function listParams(filters: ListFilterValues, sort: ListSort | null): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof ListFilterValues)[]) {
    if (filters[key]) params[key] = filters[key];
  }
  if (sort) {
    if (sort.field === 'age') {
      params.sort = 'created';
      params.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      params.sort = sort.field;
      params.dir = sort.dir;
    }
  }
  return params;
}

/** Nächster Zustand beim Klick auf einen Spaltenkopf: aufsteigend → absteigend → keine Sortierung */
export function nextSort(current: ListSort | null, field: SortField): ListSort | null {
  if (!current || current.field !== field) return { field, dir: 'asc' };
  return current.dir === 'asc' ? { field, dir: 'desc' } : null;
}

/** Gespeicherte Werte, die es nicht mehr gibt (z.B. gelöschter Status), gelten als «alle» */
export function validFilters(
  filters: ListFilterValues,
  known: { assignee: string[]; status: string[]; channel: string[] },
): ListFilterValues {
  const keep = (value: string, list: string[]) => (value === '' || value === 'none' || list.includes(value) ? value : '');
  return {
    priority: ['high', 'normal', 'low'].includes(filters.priority) ? filters.priority : '',
    assignee: keep(filters.assignee, known.assignee),
    status: filters.status === '' || known.status.includes(filters.status) ? filters.status : '',
    channel: keep(filters.channel, known.channel),
  };
}
