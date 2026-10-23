import { describe, expect, it } from 'vitest';
import { areaOf, areasOf } from './areas';

describe('Bereiche je Rolle', () => {
  const onlyTasks = { it: ['task' as const] };

  it('Admins sehen immer alles, die IT laut Einstellung, Standard-Benutzer nichts', () => {
    expect(areasOf('admin', onlyTasks)).toEqual(['inbox', 'incident', 'task']);
    expect(areasOf('it', onlyTasks)).toEqual(['task']);
    expect(areasOf('it', { it: ['task', 'inbox'] })).toEqual(['inbox', 'task']);
    expect(areasOf('standard', { it: ['inbox', 'incident', 'task'] })).toEqual([]);
  });

  it('Vorgänge ohne Typ gehören zum Eingang', () => {
    expect(areaOf(null)).toBe('inbox');
    expect(areaOf('incident')).toBe('incident');
    expect(areaOf('task')).toBe('task');
  });
});
