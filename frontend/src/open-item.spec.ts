import { describe, expect, it } from 'vitest';
import { itemHref, modalNumber, opensInBrowser } from './open-item';

describe('Vorgang öffnen', () => {
  it('liest die Nummer des Fensters aus der Adresse', () => {
    expect(modalNumber({ item: '42' })).toBe(42);
    expect(modalNumber({ item: ['7', '8'] })).toBe(7);
    expect(modalNumber({})).toBeNull();
    expect(modalNumber({ item: 'abc' })).toBeNull();
    expect(modalNumber({ item: '0' })).toBeNull();
    expect(modalNumber({ item: '1.5' })).toBeNull();
  });

  it('überlässt Ctrl/Cmd/Shift-Klick und die mittlere Taste dem Browser', () => {
    const click = (init: Partial<MouseEvent>) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as MouseEvent;
    expect(opensInBrowser(click({ button: 0 }))).toBe(false);
    expect(opensInBrowser(click({ button: 0, ctrlKey: true }))).toBe(true);
    expect(opensInBrowser(click({ button: 0, metaKey: true }))).toBe(true);
    expect(opensInBrowser(click({ button: 0, shiftKey: true }))).toBe(true);
    expect(opensInBrowser(click({ button: 1 }))).toBe(true);
    expect(opensInBrowser(undefined)).toBe(false);
  });

  it('verweist auf die Seite des Vorgangs', () => {
    expect(itemHref(123)).toBe('/items/123');
  });
});
