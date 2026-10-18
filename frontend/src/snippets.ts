import { itemRef } from './format';

/** Platzhalter in Textbausteinen, z.B. {{Melder}} */
export const SNIPPET_PLACEHOLDERS = [
  { key: 'Melder', label: 'Name des Melders', token: '{{Melder}}' },
  { key: 'Nummer', label: 'Nummer, z.B. PW-123', token: '{{Nummer}}' },
  { key: 'Titel', label: 'Titel des Vorgangs', token: '{{Titel}}' },
  { key: 'Bearbeiter', label: 'eigener Name', token: '{{Bearbeiter}}' },
] as const;

/** Ersetzt die Platzhalter (Gross-/Kleinschreibung egal); unbekannte bleiben stehen. */
export function fillSnippet(body: string, values: { reporter: string; number: number; title: string; editor: string }): string {
  const map: Record<string, string> = {
    melder: values.reporter,
    nummer: itemRef(values.number),
    titel: values.title,
    bearbeiter: values.editor,
  };
  return body.replace(/\{\{\s*([A-Za-zÄÖÜäöü]+)\s*\}\}/g, (match, key: string) => map[key.toLowerCase()] ?? match);
}
