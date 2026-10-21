/**
 * Erwähnungen im Text (Antworten und Notizen): im Markdown als «[@Vorname Nachname](mention:<Benutzer-ID>)».
 * In Patchwork erscheinen sie hervorgehoben, beim Melder (Mail, Portal) als gewöhnlicher Text «@Vorname Nachname».
 */
const MENTION = /\[@([^\]\n]{1,200})\]\(mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/** IDs der erwähnten Benutzer, jede einmal, in der Reihenfolge im Text */
export function mentionedIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(MENTION)].map((m) => m[2]!))];
}

/** Erwähnungen als gewöhnlicher Text «@Vorname Nachname» (für Mails an Melder und Beteiligte). */
export function mentionsAsText(markdown: string): string {
  return markdown.replace(MENTION, (_all, label: string) => `@${label}`);
}
