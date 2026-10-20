import { itemRef } from './format';

/** Platzhalter in Textbausteinen, z.B. {{Melder Vorname}} */
export const SNIPPET_PLACEHOLDERS = [
  { key: 'Nummer', label: 'Nummer, z.B. PW-123', token: '{{Nummer}}' },
  { key: 'Titel', label: 'Titel des Vorgangs', token: '{{Titel}}' },
  { key: 'Melder Vorname', label: 'Vorname des Melders', token: '{{Melder Vorname}}' },
  { key: 'Melder Nachname', label: 'Nachname des Melders', token: '{{Melder Nachname}}' },
  { key: 'Zuständig Vorname', label: 'Vorname des Zuständigen, leer ohne Zuweisung', token: '{{Zuständig Vorname}}' },
  { key: 'Zuständig Nachname', label: 'Nachname des Zuständigen, leer ohne Zuweisung', token: '{{Zuständig Nachname}}' },
  { key: 'Bearbeiter Vorname', label: 'eigener Vorname', token: '{{Bearbeiter Vorname}}' },
  { key: 'Bearbeiter Nachname', label: 'eigener Nachname', token: '{{Bearbeiter Nachname}}' },
] as const;

/** Person für die Platzhalter; null = ohne (z.B. Vorgang ohne Zuweisung), die Platzhalter werden dann leer */
export type SnippetPerson = { firstName: string; lastName: string } | null;

export interface SnippetValues {
  number: number;
  title: string;
  reporter: SnippetPerson;
  assignee: SnippetPerson;
  /** Wer den Textbaustein einfügt */
  editor: SnippetPerson;
}

/** Ersetzt die Platzhalter (Gross-/Kleinschreibung und Leerzeichen egal); unbekannte bleiben stehen. */
export function fillSnippet(body: string, values: SnippetValues): string {
  const person = (prefix: string, p: SnippetPerson) => ({
    [`${prefix} vorname`]: p?.firstName ?? '',
    [`${prefix} nachname`]: p?.lastName ?? '',
  });
  const map: Record<string, string> = {
    nummer: itemRef(values.number),
    titel: values.title,
    ...person('melder', values.reporter),
    ...person('zuständig', values.assignee),
    ...person('bearbeiter', values.editor),
  };
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => map[key.toLowerCase().replace(/\s+/g, ' ')] ?? match);
}
