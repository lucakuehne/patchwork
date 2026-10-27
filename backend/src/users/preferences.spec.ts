import { describe, expect, it } from 'vitest';
import { mergePreferences, preferencesPatchSchema, withDefaults } from './preferences';

describe('Einstellungen des Benutzers', () => {
  it('Standard: Störungen als Liste, Aufgaben als Board, alles im Fenster öffnen', () => {
    expect(withDefaults({})).toEqual({
      layout: { incidents: 'list', tasks: 'board' },
      open: { inbox: 'modal', incident: 'modal', task: 'modal' },
    });
    expect(withDefaults(null).layout.tasks).toBe('board');
  });

  it('eine Änderung ergänzt die gespeicherten Werte', () => {
    const stored = mergePreferences({ layout: { tasks: 'list' } }, { open: { incident: 'page' } });
    expect(stored).toEqual({ layout: { tasks: 'list' }, open: { incident: 'page' } });
    expect(withDefaults(stored)).toEqual({
      layout: { incidents: 'list', tasks: 'list' },
      open: { inbox: 'modal', incident: 'page', task: 'modal' },
    });
  });

  it('nur bekannte Werte', () => {
    expect(preferencesPatchSchema.safeParse({ open: { incident: 'tab' } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ layout: { inbox: 'board' } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ layout: { incidents: 'board' } }).success).toBe(true);
  });
});
