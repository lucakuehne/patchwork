import { describe, expect, it } from 'vitest';
import { mergePreferences, preferencesPatchSchema, withDefaults } from './preferences';

describe('Einstellungen des Benutzers', () => {
  it('Standard: Störungen als Liste, Aufgaben als Board, alles als Seite öffnen', () => {
    expect(withDefaults({})).toEqual({
      layout: { incidents: 'list', tasks: 'board' },
      open: { inbox: 'page', incident: 'page', task: 'page' },
    });
    expect(withDefaults(null).layout.tasks).toBe('board');
  });

  it('eine Änderung ergänzt die gespeicherten Werte', () => {
    const stored = mergePreferences({ layout: { tasks: 'list' } }, { open: { incident: 'modal' } });
    expect(stored).toEqual({ layout: { tasks: 'list' }, open: { incident: 'modal' } });
    expect(withDefaults(stored)).toEqual({
      layout: { incidents: 'list', tasks: 'list' },
      open: { inbox: 'page', incident: 'modal', task: 'page' },
    });
  });

  it('nur bekannte Werte', () => {
    expect(preferencesPatchSchema.safeParse({ open: { incident: 'tab' } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ layout: { inbox: 'board' } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ layout: { incidents: 'board' } }).success).toBe(true);
  });
});
