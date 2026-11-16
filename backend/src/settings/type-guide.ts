import type { ItemType } from '../db/schema';

/**
 * Hilfe zur Typwahl (Entscheid vom 16.11.2026): je Typ eine kurze Leitfrage, die in jedem Knopf «Störung» bzw.
 * «Aufgabe» steht (Eingangsliste, Vorgang, «+ Neu»), und Beispiele beim Darüberfahren. Pflegbar unter Verwaltung →
 * Allgemein, Karte «Typ wählen».
 */
export interface TypeGuideEntry {
  hint: string;
  examples: string[];
}

export type TypeGuide = Record<ItemType, TypeGuideEntry>;

export const TYPE_GUIDE_LIMITS = { hint: 40, examples: 10, example: 80 } as const;

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
