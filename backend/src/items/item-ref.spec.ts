import { describe, expect, it } from 'vitest';
import { itemKeyFromSubject, itemRef, parseItemRef } from './item-ref';

describe('Kennung eines Vorgangs', () => {
  it('liest Präfix und Nummer, ohne Präfix gilt PW', () => {
    expect(parseItemRef('PW-123')).toEqual({ prefix: 'PW', number: 123 });
    expect(parseItemRef('hs-17223')).toEqual({ prefix: 'HS', number: 17223 });
    expect(parseItemRef(' 42 ')).toEqual({ prefix: 'PW', number: 42 });
    expect(parseItemRef(7)).toEqual({ prefix: 'PW', number: 7 });
  });

  it('lehnt Unbekanntes ab', () => {
    for (const value of ['XY-1', 'PW-0', 'PW-', 'abc', '1.5', '-3', 'PW-1234567890', '', null, undefined]) {
      expect(parseItemRef(value)).toBeNull();
    }
  });

  it('schreibt die Kennung mit Präfix', () => {
    expect(itemRef({ prefix: 'HS', number: 17223 })).toBe('HS-17223');
  });

  it('erkennt die Kennung im Betreff, auch aus Mails von HelpSpot', () => {
    expect(itemKeyFromSubject('AW: [PW-12] Drucker druckt nicht')).toEqual({ prefix: 'PW', number: 12 });
    expect(itemKeyFromSubject('Re: [hs-17223] Antwort')).toEqual({ prefix: 'HS', number: 17223 });
    expect(itemKeyFromSubject('AW: Shared Mails können nicht geöffnet werden - Ticket:{18200}')).toEqual({
      prefix: 'HS',
      number: 18200,
    });
    expect(itemKeyFromSubject('Ohne Nummer PW-12')).toBeNull();
    expect(itemKeyFromSubject('[XY-12] Fremd')).toBeNull();
    expect(itemKeyFromSubject(undefined)).toBeNull();
  });
});
