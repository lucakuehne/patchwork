import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPE_GUIDE, examplesFromText, typeGuideTitle } from './type-guide';

describe('Hilfe zur Typwahl', () => {
  it('Erklärung beim Darüberfahren mit Leitfrage und Beispielen', () => {
    expect(typeGuideTitle(DEFAULT_TYPE_GUIDE, 'incident')).toBe(
      'Ging bisher, geht nicht mehr\n\nZum Beispiel:\n– Drucker druckt nicht mehr\n– Kein Zugriff aufs Netzlaufwerk\n– Outlook startet nicht',
    );
    expect(typeGuideTitle({ ...DEFAULT_TYPE_GUIDE, task: { hint: 'Neu', examples: [] } }, 'task')).toBe('Neu');
  });

  it('Beispiele aus dem Textfeld: eine pro Zeile, ohne leere und doppelte', () => {
    expect(examplesFromText(' Drucker \n\nDrucker\nOutlook\n')).toEqual(['Drucker', 'Outlook']);
  });
});
