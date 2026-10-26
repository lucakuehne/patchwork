import { describe, expect, it } from 'vitest';
import { activeFilters, EMPTY_FILTERS, listParams, nextSort, validFilters } from './list-filters';

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
