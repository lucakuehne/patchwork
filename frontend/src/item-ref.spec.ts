import { describe, expect, it } from 'vitest';
import { itemRef, itemRefsInText, parseItemRef, sameItem } from './item-ref';

describe('Kennung eines Vorgangs', () => {
  it('liest Präfix und Nummer, ohne Präfix gilt PW', () => {
    expect(parseItemRef('PW-123')).toEqual({ prefix: 'PW', number: 123 });
    expect(parseItemRef('hs-17223')).toEqual({ prefix: 'HS', number: 17223 });
    expect(parseItemRef('42')).toEqual({ prefix: 'PW', number: 42 });
    expect(parseItemRef(['7', '8'])).toEqual({ prefix: 'PW', number: 7 });
    for (const value of ['XY-1', 'PW-0', 'abc', '1.5', '', null, undefined, {}]) expect(parseItemRef(value)).toBeNull();
  });

  it('schreibt und vergleicht Kennungen', () => {
    expect(itemRef({ prefix: 'HS', number: 17223 })).toBe('HS-17223');
    expect(sameItem({ prefix: 'PW', number: 5 }, { prefix: 'PW', number: 5 })).toBe(true);
    expect(sameItem({ prefix: 'PW', number: 5 }, { prefix: 'HS', number: 5 })).toBe(false);
    expect(sameItem(null, { prefix: 'PW', number: 5 })).toBe(false);
  });

  it('findet Kennungen im Text, nicht als Teil anderer Wörter', () => {
    const found = itemRefsInText('Siehe PW-12, (HS-17223) und xPW-3 sowie PW-4a und ABC-5.');
    expect(found.map((f) => itemRef(f.key))).toEqual(['PW-12', 'HS-17223']);
    expect(found[0]).toMatchObject({ index: 6, length: 5 });
  });
});
