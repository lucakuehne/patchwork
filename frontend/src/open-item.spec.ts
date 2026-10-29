import { describe, expect, it } from 'vitest';
import { itemHref, modalKey, opensInBrowser } from './open-item';

describe('Vorgang öffnen', () => {
  it('liest die Kennung des Fensters aus der Adresse, ohne Präfix gilt PW', () => {
    expect(modalKey({ item: 'PW-42' })).toEqual({ prefix: 'PW', number: 42 });
    expect(modalKey({ item: 'HS-17223' })).toEqual({ prefix: 'HS', number: 17223 });
    expect(modalKey({ item: '42' })).toEqual({ prefix: 'PW', number: 42 });
    expect(modalKey({ item: ['PW-7', 'PW-8'] })).toEqual({ prefix: 'PW', number: 7 });
    expect(modalKey({})).toBeNull();
    expect(modalKey({ item: 'abc' })).toBeNull();
    expect(modalKey({ item: '0' })).toBeNull();
    expect(modalKey({ item: '1.5' })).toBeNull();
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
    expect(itemHref({ prefix: 'PW', number: 123 })).toBe('/items/PW-123');
    expect(itemHref({ prefix: 'HS', number: 17223 })).toBe('/items/HS-17223');
  });
});
