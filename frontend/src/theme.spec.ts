import { describe, expect, it } from 'vitest';
import { isTheme, resolveTheme, THEMES } from './theme';

describe('Farbschema', () => {
  it('«Automatisch» folgt dem System, «Hell» und «Dunkel» gelten immer', () => {
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('nur bekannte Werte aus dem Speicher des Browsers', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('auto')).toBe(true);
    expect(isTheme('blue')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('Auswahl in der Reihenfolge Automatisch, Hell, Dunkel', () => {
    expect(THEMES.map((t) => t.label)).toEqual(['Automatisch', 'Hell', 'Dunkel']);
  });
});
