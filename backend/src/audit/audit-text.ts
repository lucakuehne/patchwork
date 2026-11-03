/** Felder eines Vorgangs beim Bearbeiten, wie sie im Aktionsprotokoll heissen */
const ITEM_FIELDS: Record<string, string> = {
  title: 'Titel',
  description: 'Beschreibung',
  priority: 'Priorität',
  assigneeId: 'Zuständig',
  reporterId: 'Melder',
  mailboxId: 'Postfach',
  channelId: 'Meldeweg',
  dueDate: 'Fälligkeit',
};

/** Aktion beim Bearbeiten eines Vorgangs, z.B. «Priorität geändert» oder «Titel, Beschreibung geändert» */
export function itemChangeAction(body: Record<string, unknown>): string {
  const fields = Object.keys(ITEM_FIELDS).filter((key) => body[key] !== undefined);
  return fields.length ? `${fields.map((key) => ITEM_FIELDS[key]).join(', ')} geändert` : 'Vorgang bearbeitet';
}

/** Punkt einer Checkliste: Text geändert, abgehakt oder wieder offen */
export function checklistItemAction(body: Record<string, unknown>): string {
  if (body.text !== undefined) return 'Checklisten-Punkt geändert';
  return body.done ? 'Checklisten-Punkt abgehakt' : 'Checklisten-Punkt wieder offen';
}

/** Benutzer bearbeitet: mit Hinweis auf Passwort, Rolle und Aktiv, die übrigen Felder als «geändert» */
export function userChangeAction(body: Record<string, unknown>): string {
  const parts: string[] = [];
  if (body.role !== undefined) parts.push('Rolle');
  if (body.active !== undefined) parts.push('Aktiv');
  if (body.password !== undefined) parts.push(body.password === '' ? 'Passwort entfernt' : 'Passwort gesetzt');
  const rest = ['name', 'firstName', 'lastName', 'email'].some((key) => body[key] !== undefined);
  if (rest) parts.unshift('Name/E-Mail');
  return parts.length ? `Benutzer geändert: ${parts.join(', ')}` : 'Benutzer geändert';
}

/** Ein- oder Ausschalten, z.B. «Regel aktiviert» bzw. «Regel deaktiviert» */
export const toggled = (on: unknown, yes: string, no: string) => (on ? yes : no);

/** «PW-123 «Titel»» */
export const itemLabel = (item: { prefix: string; number: number; title: string }) => `${item.prefix}-${item.number} «${item.title}»`;

/** Bezeichnung eines neu erstellten Objekts aus der Antwort: Name, Bezeichnung, Titel oder Betreff */
export function resultLabel(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  const label = [r.name, r.label, r.title, r.subject].find((v) => typeof v === 'string' && v.trim());
  return typeof label === 'string' ? label : '';
}

/** Text für ILIKE: «%», «_» und «\» wörtlich */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Suchtext für ILIKE irgendwo im Text */
export const likePattern = (q: string) => `%${likeEscape(q)}%`;
