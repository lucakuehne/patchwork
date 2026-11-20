import { describe, expect, it } from 'vitest';
import { areaOf, areasOf, normalizePermissions, permissionsOf } from './areas';

describe('Rechte je Rolle', () => {
  const onlyTasks = { it: ['task' as const] };

  it('Admins haben immer alle Rechte, die IT laut Einstellung, Standard-Benutzer keine', () => {
    expect(permissionsOf('admin', onlyTasks)).toEqual(['inbox', 'incident', 'task', 'plansView', 'plansEdit', 'reports', 'admin']);
    expect(permissionsOf('it', onlyTasks)).toEqual(['task']);
    expect(permissionsOf('standard', { it: ['inbox', 'admin'] })).toEqual([]);
  });

  it('«Pläne bearbeiten» schliesst «Pläne ansehen» ein; Reihenfolge wie in der Liste', () => {
    expect(normalizePermissions(['reports', 'plansEdit', 'inbox', 'inbox'])).toEqual(['inbox', 'plansView', 'plansEdit', 'reports']);
  });

  it('Bereiche folgen aus den Rechten', () => {
    expect(areasOf('admin', onlyTasks)).toEqual(['inbox', 'incident', 'task', 'plans']);
    expect(areasOf('it', onlyTasks)).toEqual(['task']);
    expect(areasOf('it', { it: ['task', 'inbox'] })).toEqual(['inbox', 'task']);
    expect(areasOf('it', { it: ['plansView', 'reports', 'admin'] })).toEqual(['plans']);
    expect(areasOf('standard', { it: ['inbox', 'incident', 'task'] })).toEqual([]);
  });

  it('Vorgänge ohne Typ gehören zum Eingang', () => {
    expect(areaOf(null)).toBe('inbox');
    expect(areaOf('incident')).toBe('incident');
    expect(areaOf('task')).toBe('task');
  });
});
