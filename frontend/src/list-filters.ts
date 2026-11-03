import type { LocationQuery } from 'vue-router';
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

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ListFilterValues)[];

export const activeFilters = (filters: ListFilterValues) => FILTER_KEYS.filter((key) => filters[key] !== '').length;

export const sameFilters = (a: ListFilterValues, b: ListFilterValues) => FILTER_KEYS.every((key) => a[key] === b[key]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filter in der Adresse (Entscheid vom 03.11.2026), z.B. `/incidents?priority=high&assignee=none`: Priorität als
 * high/normal/low, Zuständig, Status und Meldeweg als ID («none» = ohne). Ungültige Werte fallen weg; null, wenn die
 * Adresse keinen gültigen Filter enthält.
 */
export function filtersFromQuery(query: LocationQuery): ListFilterValues | null {
  const value = (key: keyof ListFilterValues) => {
    const v = query[key];
    return typeof v === 'string' ? v : '';
  };
  const id = (v: string) => (UUID.test(v) ? v : '');
  const idOrNone = (v: string) => (v === 'none' ? v : id(v));
  const priority = value('priority');
  const filters: ListFilterValues = {
    priority: priority === 'high' || priority === 'normal' || priority === 'low' ? priority : '',
    assignee: idOrNone(value('assignee')),
    status: id(value('status')),
    channel: idOrNone(value('channel')),
  };
  return activeFilters(filters) ? filters : null;
}

/** Adresse mit diesen Filtern: übrige Parameter (z.B. `?item=PW-12`) bleiben, leere Filter fehlen */
export function queryWithFilters(query: LocationQuery, filters: ListFilterValues): LocationQuery {
  const result: LocationQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (!FILTER_KEYS.includes(key as keyof ListFilterValues)) result[key] = value;
  }
  for (const key of FILTER_KEYS) {
    if (filters[key]) result[key] = filters[key];
  }
  return result;
}

/** Die Filter-Parameter einer Adresse als Text, um zu erkennen, ob sie sich geändert haben */
export const filterPart = (query: LocationQuery) => JSON.stringify(FILTER_KEYS.map((key) => query[key] ?? null));

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
