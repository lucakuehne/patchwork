import { describe, expect, it } from 'vitest';
import { annotateReferences, hideReferences, referencedKeys, referenceMeta } from './references';

describe('Verweise auf andere Vorgänge', () => {
  it('sammelt die Kennungen aus Verknüpfungen, Duplikaten und Zusammenführen, ohne Präfix gilt PW', () => {
    const metas = [
      { field: 'linkAdded', otherNumber: 12, otherTitle: 'Drucker' },
      { source: 'merge', mergedFrom: 7, mergedTitle: 'Doppelt' },
      { duplicateOf: 3, duplicateOfPrefix: 'HS' },
      { viaDuplicate: '9' },
      { field: 'title', from: 'a', to: 'b' },
      null,
      { otherNumber: 12 },
      { otherNumber: 12, otherPrefix: 'HS' },
    ];
    expect(referencedKeys(metas).map((k) => `${k.prefix}-${k.number}`).sort()).toEqual(['HS-12', 'HS-3', 'PW-12', 'PW-7', 'PW-9']);
  });

  it('schreibt Verweise mit Präfix', () => {
    expect(referenceMeta('other', { prefix: 'HS', number: 17223 })).toEqual({ otherNumber: 17223, otherPrefix: 'HS' });
    expect(referenceMeta('duplicateOf', { prefix: 'PW', number: 4 })).toEqual({ duplicateOf: 4, duplicateOfPrefix: 'PW' });
  });

  it('gesperrte Vorgänge: nur die Kennung, ohne Titel, mit Vermerk', () => {
    const hidden = new Set(['PW-12', 'PW-7']);
    expect(hideReferences({ field: 'linkAdded', otherNumber: 12, otherTitle: 'Drucker' }, hidden)).toEqual({
      field: 'linkAdded',
      otherNumber: 12,
      refHidden: true,
    });
    expect(hideReferences({ mergedFrom: 7, mergedTitle: 'Doppelt' }, hidden)).toEqual({ mergedFrom: 7, refHidden: true });
    // Gleiche Nummer, anderer Präfix: nicht gesperrt
    const other = { otherNumber: 12, otherPrefix: 'HS', otherTitle: 'Alt' };
    expect(hideReferences(other, hidden)).toBe(other);
    expect(hideReferences(null, hidden)).toBeNull();
  });

  it('Typ des verwiesenen Vorgangs (Seite oder Fenster), nicht bei gesperrten', () => {
    const types = new Map<string, string | null>([
      ['PW-5', 'task'],
      ['PW-7', null],
      ['PW-12', 'incident'],
      ['HS-12', 'incident'],
    ]);
    expect(annotateReferences({ otherNumber: 5, otherTitle: 'A' }, new Set(), types)).toEqual({ otherNumber: 5, otherTitle: 'A', refType: 'task' });
    expect(annotateReferences({ duplicateOf: 7 }, new Set(), types)).toEqual({ duplicateOf: 7, refType: null });
    expect(annotateReferences({ otherNumber: 12, otherTitle: 'B' }, new Set(['PW-12']), types)).toEqual({ otherNumber: 12, refHidden: true });
    expect(annotateReferences({ otherNumber: 12, otherPrefix: 'HS' }, new Set(['PW-12']), types)).toEqual({
      otherNumber: 12,
      otherPrefix: 'HS',
      refType: 'incident',
    });
    expect(annotateReferences({ field: 'title' }, new Set(), types)).toEqual({ field: 'title' });
  });
});
