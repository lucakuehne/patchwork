import type { ItemType, TypeGuide } from './types';

/**
 * Hilfe zur Typwahl (Entscheid vom 16.11.2026): Leitfrage in jedem Knopf «Störung» bzw. «Aufgabe», Beispiele beim
 * Darüberfahren. Pflegbar unter Verwaltung → Allgemein; bis die Einstellung geladen ist, gilt die Vorgabe.
 */
export const DEFAULT_TYPE_GUIDE: TypeGuide = {
  incident: {
    hint: 'Ging bisher, geht nicht mehr',
    examples: ['Drucker druckt nicht mehr', 'Kein Zugriff aufs Netzlaufwerk', 'Outlook startet nicht'],
  },
  task: {
    hint: 'Etwas Neues oder Anderes',
    examples: ['Zugang für eine neue Mitarbeiterin', 'Software installieren', 'Neues Gerät bestellen'],
  },
};

export const TYPE_GUIDE_LIMITS = { hint: 40, examples: 10, example: 80 } as const;

/** Erklärung beim Darüberfahren: Leitfrage und Beispiele */
export function typeGuideTitle(guide: TypeGuide, type: ItemType): string {
  const { hint, examples } = guide[type];
  return examples.length ? `${hint}\n\nZum Beispiel:\n${examples.map((e) => `– ${e}`).join('\n')}` : hint;
}

/** Beispiele aus dem Textfeld der Verwaltung: eine pro Zeile, ohne leere und doppelte */
export function examplesFromText(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))];
}
