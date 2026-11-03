import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  EMPTY_FILTERS,
  filterPart,
  filtersFromQuery,
  listParams,
  nextSort,
  queryWithFilters,
  sameFilters,
  validFilters,
} from './list-filters';

describe('Filter und Sortierung der Listen', () => {
  it('Parameter nur für gesetzte Filter; «Alter» sortiert nach dem Erfassungsdatum umgekehrt', () => {
    expect(listParams(EMPTY_FILTERS, null)).toEqual({});
    expect(listParams({ ...EMPTY_FILTERS, priority: 'high', assignee: 'none' }, { field: 'title', dir: 'desc' })).toEqual({
      priority: 'high',
      assignee: 'none',
      sort: 'title',
      dir: 'desc',
    });
    expect(listParams(EMPTY_FILTERS, { field: 'age', dir: 'asc' })).toEqual({ sort: 'created', dir: 'desc' });
  });

  it('Klick auf den Spaltenkopf: aufsteigend, absteigend, dann ohne', () => {
    expect(nextSort(null, 'priority')).toEqual({ field: 'priority', dir: 'asc' });
    expect(nextSort({ field: 'priority', dir: 'asc' }, 'priority')).toEqual({ field: 'priority', dir: 'desc' });
    expect(nextSort({ field: 'priority', dir: 'desc' }, 'priority')).toBeNull();
    expect(nextSort({ field: 'priority', dir: 'desc' }, 'title')).toEqual({ field: 'title', dir: 'asc' });
  });

  it('nicht mehr vorhandene Werte gelten als «alle», «none» bleibt', () => {
    const known = { assignee: ['u1'], status: ['s1'], channel: ['c1'] };
    expect(validFilters({ priority: 'high', assignee: 'weg', status: 'weg', channel: 'none' }, known)).toEqual({
      priority: 'high',
      assignee: '',
      status: '',
      channel: 'none',
    });
    expect(activeFilters({ priority: 'high', assignee: 'u1', status: '', channel: '' })).toBe(2);
  });
});

describe('Filter in der Adresse', () => {
  const ID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

  it('liest gültige Werte, ungültige fallen weg; ohne gültigen Filter null', () => {
    expect(filtersFromQuery({ priority: 'high', assignee: 'none', status: ID, channel: ID, item: 'PW-1' })).toEqual({
      priority: 'high',
      assignee: 'none',
      status: ID,
      channel: ID,
    });
    expect(filtersFromQuery({ priority: 'dringend', assignee: ID, status: 'none', channel: ['none'] })).toEqual({
      ...EMPTY_FILTERS,
      assignee: ID,
    });
    expect(filtersFromQuery({})).toBeNull();
    expect(filtersFromQuery({ item: 'PW-1', priority: 'irgendwas' })).toBeNull();
  });

  it('setzt nur die gesetzten Filter, übrige Parameter bleiben', () => {
    const query = { item: 'PW-1', priority: 'low', status: ID };
    expect(queryWithFilters(query, { ...EMPTY_FILTERS, assignee: 'none' })).toEqual({ item: 'PW-1', assignee: 'none' });
    expect(queryWithFilters(query, EMPTY_FILTERS)).toEqual({ item: 'PW-1' });
  });

  it('erkennt Änderungen nur an den Filtern', () => {
    expect(filterPart({ priority: 'high', item: 'PW-1' })).toBe(filterPart({ priority: 'high' }));
    expect(filterPart({ priority: 'high' })).not.toBe(filterPart({ priority: 'low' }));
    expect(sameFilters({ ...EMPTY_FILTERS, channel: ID }, { ...EMPTY_FILTERS, channel: ID })).toBe(true);
    expect(sameFilters({ ...EMPTY_FILTERS, channel: ID }, EMPTY_FILTERS)).toBe(false);
  });
});
