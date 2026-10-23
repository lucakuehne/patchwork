import { describe, expect, it } from 'vitest';
import { hideReferences, referencedNumbers } from './references';

describe('Verweise auf andere Vorgänge', () => {
  it('sammelt die Nummern aus Verknüpfungen, Duplikaten und Zusammenführen', () => {
    const metas = [
      { field: 'linkAdded', otherNumber: 12, otherTitle: 'Drucker' },
      { source: 'merge', mergedFrom: 7, mergedTitle: 'Doppelt' },
      { duplicateOf: 3 },
      { viaDuplicate: '9' },
      { field: 'title', from: 'a', to: 'b' },
      null,
      { otherNumber: 12 },
    ];
    expect(referencedNumbers(metas).sort((a, b) => a - b)).toEqual([3, 7, 9, 12]);
  });

  it('gesperrte Vorgänge: nur die Nummer, ohne Titel, mit Vermerk', () => {
    const hidden = new Set([12, 7]);
    expect(hideReferences({ field: 'linkAdded', otherNumber: 12, otherTitle: 'Drucker' }, hidden)).toEqual({
      field: 'linkAdded',
      otherNumber: 12,
      refHidden: true,
    });
    expect(hideReferences({ mergedFrom: 7, mergedTitle: 'Doppelt' }, hidden)).toEqual({ mergedFrom: 7, refHidden: true });
    const visible = { otherNumber: 5, otherTitle: 'Sichtbar' };
    expect(hideReferences(visible, hidden)).toBe(visible);
    expect(hideReferences(null, hidden)).toBeNull();
  });
});
