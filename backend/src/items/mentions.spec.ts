import { describe, expect, it } from 'vitest';
import { mentionedIds, mentionsAsText } from './mentions';

const IVAN = '0b6a1c4e-9f2d-4c8e-a1b2-3c4d5e6f7a8b';
const ADA = '1c7b2d5f-0a3e-4d9f-b2c3-4d5e6f7a8b9c';

describe('Erwähnungen', () => {
  const text = `Hallo [@Ivan Informatik](mention:${IVAN}), bitte mit [@Ada Admin](mention:${ADA}) und nochmals [@Ivan Informatik](mention:${IVAN}).`;

  it('findet die erwähnten Benutzer je einmal', () => {
    expect(mentionedIds(text)).toEqual([IVAN, ADA]);
    expect(mentionedIds('Kein [Link](https://firma.ch) und keine [@Fälschung](mention:abc)')).toEqual([]);
  });

  it('als gewöhnlicher Text für Melder und Beteiligte', () => {
    expect(mentionsAsText(text)).toBe('Hallo @Ivan Informatik, bitte mit @Ada Admin und nochmals @Ivan Informatik.');
    expect(mentionsAsText('[Link](https://firma.ch)')).toBe('[Link](https://firma.ch)');
  });
});
