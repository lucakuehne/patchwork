import { htmlMail, renderMarkdown } from './mail-content';

/** Vorlagen für die Mails von Patchwork: Betreff und Text (Markdown) mit Platzhaltern wie {{Titel}}. */
export type TemplateKey =
  | 'confirmation'
  | 'reply'
  | 'done'
  | 'rejected'
  | 'duplicateMerged'
  | 'duplicateRedirected'
  | 'waitingReminder'
  | 'waitingClosed'
  | 'reporterLink'
  | 'reporterFooter'
  | 'assigned'
  | 'inboundReply'
  | 'fixCompleted'
  | 'mentioned'
  | 'dueReminder'
  | 'staffLink'
  | 'staffFooter';

export interface Placeholder {
  name: string;
  description: string;
  /** Wert in der Vorschau */
  example: string;
}

export interface TemplateDefinition {
  key: TemplateKey;
  /** An Melder (und Beteiligte) oder an IT-Mitarbeitende */
  group: 'reporter' | 'staff';
  label: string;
  description: string;
  /** Standard-Betreff ohne «[PW-123]», den Patchwork immer davorsetzt; null = ohne Betreff (Link-Zeile, Fusszeile) */
  subject: string | null;
  /** Standard-Text; null = den Text schreibt der Bearbeiter (öffentliche Antwort) */
  body: string | null;
  /** Fusszeile: einfacher Text ohne Markdown */
  plain?: boolean;
  placeholders: Placeholder[];
}

export interface TemplateText {
  subject: string | null;
  body: string | null;
}

const p = (name: string, description: string, example: string): Placeholder => ({ name, description, example });

const NUMBER = p('Nummer', 'Nummer des Vorgangs', 'PW-123');
const TITLE = p('Titel', 'Titel des Vorgangs', 'Drucker druckt nicht');
const ITEM = [
  NUMBER,
  TITLE,
  p('Status', 'Aktueller Status', 'Erledigt'),
  p('Melder Vorname', 'Vorname des Melders', 'Anna'),
  p('Melder Nachname', 'Nachname des Melders', 'Muster'),
  p('Zuständig Vorname', 'Vorname des Zuständigen, leer ohne Zuweisung', 'Ivan'),
  p('Zuständig Nachname', 'Nachname des Zuständigen, leer ohne Zuweisung', 'IT'),
];
const PORTAL_LINK = p('Link', 'Link zur Meldung im Portal', 'https://patchwork.firma.local/portal/v/123');
const STAFF_LINK = p('Link', 'Link zum Vorgang in Patchwork', 'https://patchwork.firma.local/v/123');
const FRAME = (link: Placeholder) => [NUMBER, TITLE, link];

export const TEMPLATES: TemplateDefinition[] = [
  {
    key: 'confirmation',
    group: 'reporter',
    label: 'Eingangsbestätigung',
    description: 'An den Melder, wenn eine neue Meldung per Mail oder im Portal eingeht.',
    subject: '{{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Nachricht ist bei uns eingegangen und wurde unter der Nummer **{{Nummer}}** erfasst. ' +
      'Wir melden uns so bald wie möglich.\n\nFür Ergänzungen antworte bitte direkt auf diese E-Mail.',
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'reply',
    group: 'reporter',
    label: 'Öffentliche Antwort',
    description: 'Antwort aus der Timeline an Melder (An) und Beteiligte (CC). Den Text schreibt der Bearbeiter.',
    subject: '{{Titel}}',
    body: null,
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'done',
    group: 'reporter',
    label: 'Erledigt',
    description:
      'An den Melder beim Wechsel von Hand in einen abgeschlossenen Status (nicht beim Ablehnen und nicht zwischen zwei ' +
      'abgeschlossenen Status).',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDein Anliegen «{{Titel}}» ({{Nummer}}) wurde auf «{{Status}}» gesetzt.\n\n' +
      'Falls noch etwas offen ist, antworte einfach auf diese Mail.',
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'rejected',
    group: 'reporter',
    label: 'Abgelehnt',
    description: 'An den Melder, wenn ein Vorgang abgelehnt wird und «Melder informieren» gewählt ist.',
    subject: 'Abgelehnt: {{Titel}}',
    body: 'Hallo {{Melder Vorname}}\n\nDein Anliegen «{{Titel}}» ({{Nummer}}) wurde abgelehnt.\n\n**Begründung:**\n\n> {{Begründung}}',
    placeholders: [...ITEM, p('Begründung', 'Begründung der Ablehnung', 'Dafür ist die IT nicht zuständig.'), PORTAL_LINK],
  },
  {
    key: 'duplicateMerged',
    group: 'reporter',
    label: 'Duplikat: ins Original übernommen',
    description:
      'An Melder und Beteiligte eines Duplikats mit demselben Melder wie das Original; die Meldung wird ins Original übernommen. ' +
      'Nummer, Titel und Link gehören zum Original.',
    subject: '{{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Nachricht {{Duplikat}} betrifft denselben Vorgang wie {{Original}} und wurde dort hinzugefügt. ' +
      'Für Ergänzungen antworte bitte auf diese E-Mail.',
    placeholders: [
      ...ITEM,
      p('Duplikat', 'Duplikat mit Nummer und Titel', 'PW-124 «Drucker im 2. OG»'),
      p('Original', 'Original mit Nummer und Titel', 'PW-123 «Drucker druckt nicht»'),
      PORTAL_LINK,
    ],
  },
  {
    key: 'duplicateRedirected',
    group: 'reporter',
    label: 'Duplikat: im Original weiterbearbeitet',
    description:
      'An Melder und Beteiligte eines Duplikats mit anderem Melder; sie erhalten künftig die Updates des Originals. ' +
      'Nummer und Titel gehören zum Original, Vor- und Nachname des Melders zum Duplikat.',
    subject: '{{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Meldung {{Duplikat}} betrifft dasselbe wie {{Original}} und wird dort weiterbearbeitet. ' +
      'Du erhältst die Updates per E-Mail.',
    placeholders: [
      ...ITEM,
      p('Duplikat', 'Duplikat mit Nummer und Titel', 'PW-124 «Drucker im 2. OG»'),
      p('Original', 'Original mit Nummer und Titel', 'PW-123 «Drucker druckt nicht»'),
      PORTAL_LINK,
    ],
  },
  {
    key: 'waitingReminder',
    group: 'reporter',
    label: 'Erinnerung',
    description:
      'An den Melder, wenn ein Vorgang länger im Status «Wartet auf den Melder» steht (Regel «Melder per Mail erinnern»).',
    subject: 'Erinnerung: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nWir warten noch auf deine Rückmeldung zu «{{Titel}}» ({{Nummer}}). Bitte antworte direkt auf diese E-Mail.' +
      '\n\n{{Schliessung}}',
    placeholders: [
      ...ITEM,
      p(
        'Schliessung',
        'Satz zum automatischen Schliessen, leer ohne passende Regel',
        'Ohne Rückmeldung schliessen wir den Vorgang am 27.10.2026.',
      ),
      PORTAL_LINK,
    ],
  },
  {
    key: 'waitingClosed',
    group: 'reporter',
    label: 'Automatisch geschlossen',
    description:
      'An den Melder, wenn eine Regel den Vorgang mangels Rückmeldung in den Status «Automatisch schliessen in» setzt ' +
      '(statt der Mail «Erledigt»).',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nZu «{{Titel}}» ({{Nummer}}) haben wir seit {{Tage}} Tagen keine Rückmeldung erhalten ' +
      'und den Vorgang deshalb geschlossen.\n\nFalls noch etwas offen ist, antworte einfach auf diese E-Mail.',
    placeholders: [...ITEM, p('Tage', 'Tage ohne Rückmeldung', '7'), PORTAL_LINK],
  },
  {
    key: 'reporterLink',
    group: 'reporter',
    label: 'Link-Zeile (Melder)',
    description: 'Steht in jeder Mail an Melder und Beteiligte unter dem Text.',
    subject: null,
    body: '[Meldung online ansehen]({{Link}})',
    placeholders: FRAME(PORTAL_LINK),
  },
  {
    key: 'reporterFooter',
    group: 'reporter',
    label: 'Fusszeile (Melder)',
    description: 'Klein gesetzt am Ende jeder Mail an Melder und Beteiligte. Einfacher Text ohne Formatierung.',
    subject: null,
    body: 'Patchwork · {{Nummer}}\nBitte lass bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.',
    plain: true,
    placeholders: FRAME(PORTAL_LINK),
  },
  {
    key: 'assigned',
    group: 'staff',
    label: 'Zugewiesen',
    description: 'An den neu Zuständigen, wenn ihm jemand oder eine Regel einen Vorgang zuweist.',
    subject: 'Zugewiesen: {{Titel}}',
    body:
      'Zugewiesen: {{Nummer}} «{{Titel}}»\nZugewiesen durch: {{Zugewiesen durch}}\n' +
      'Melder: {{Melder Vorname}} {{Melder Nachname}} ({{Melder E-Mail}})',
    placeholders: [
      ...ITEM,
      p('Zugewiesen durch', 'Wer zugewiesen hat (Person oder Regel)', 'Ada Admin'),
      p('Melder E-Mail', 'E-Mail-Adresse des Melders', 'anna.muster@firma.ch'),
      STAFF_LINK,
    ],
  },
  {
    key: 'inboundReply',
    group: 'staff',
    label: 'Neue Antwort',
    description: 'An den Zuständigen, wenn Melder oder Beteiligte per Mail oder im Portal antworten.',
    subject: 'Neue Antwort: {{Titel}}',
    body: 'Neue Antwort von {{Absender}} ({{Absender E-Mail}}) auf {{Nummer}} «{{Titel}}»:\n\n> {{Text}}',
    placeholders: [
      ...ITEM,
      p('Absender', 'Name der antwortenden Person', 'Anna Muster'),
      p('Absender E-Mail', 'E-Mail-Adresse der antwortenden Person', 'anna.muster@firma.ch'),
      p('Text', 'Text der Antwort', 'Danke, jetzt druckt er wieder.'),
      STAFF_LINK,
    ],
  },
  {
    key: 'fixCompleted',
    group: 'staff',
    label: 'Behebender Vorgang erledigt',
    description:
      'An den Zuständigen, wenn ein Vorgang, der seinen Vorgang «behebt», von Hand in einen abgeschlossenen Status wechselt ' +
      '(nicht beim Ablehnen).',
    subject: 'Behebender Vorgang erledigt: {{Titel}}',
    body:
      '{{Behebender Vorgang}} wurde von {{Bearbeiter}} erledigt.\n' +
      'Dieser Vorgang behebt {{Nummer}} «{{Titel}}». Bitte prüfen, ob {{Nummer}} abgeschlossen werden kann.',
    placeholders: [
      ...ITEM,
      p('Behebender Vorgang', 'Erledigter Vorgang mit Nummer und Titel', 'PW-130 «Druckertreiber aktualisieren»'),
      p('Bearbeiter', 'Wer ihn erledigt hat', 'Ivan IT'),
      STAFF_LINK,
    ],
  },
  {
    key: 'mentioned',
    group: 'staff',
    label: 'Erwähnt',
    description:
      'An IT-Mitarbeitende, die in einer öffentlichen Antwort oder internen Notiz mit «@» erwähnt werden (nicht an sich selbst; ' +
      'beim Bearbeiten einer Notiz nur an neu Erwähnte).',
    subject: 'Erwähnt: {{Titel}}',
    body: '{{Bearbeiter}} hat Sie in {{Nummer}} «{{Titel}}» erwähnt ({{Art}}):\n\n> {{Text}}',
    placeholders: [
      ...ITEM,
      p('Bearbeiter', 'Wer erwähnt hat', 'Ada Admin'),
      p('Art', 'Öffentliche Antwort oder interne Notiz', 'interne Notiz'),
      p('Text', 'Text der Antwort bzw. Notiz', '@Ivan Informatik, kannst du das übernehmen?'),
      STAFF_LINK,
    ],
  },
  {
    key: 'dueReminder',
    group: 'staff',
    label: 'Fällig',
    description:
      'An den Zuständigen am Fälligkeitstag einer offenen Aufgabe (ab 07:00, einmal pro Datum; ohne Zuständigen keine Mail).',
    subject: 'Fällig: {{Titel}}',
    body: 'Die Aufgabe {{Nummer}} «{{Titel}}» ist am {{Fällig}} fällig.\nStatus: {{Status}}',
    placeholders: [...ITEM, p('Fällig', 'Fälligkeitsdatum', '24.10.2026'), STAFF_LINK],
  },
  {
    key: 'staffLink',
    group: 'staff',
    label: 'Link-Zeile (IT)',
    description: 'Steht in jeder Mail an IT-Mitarbeitende unter dem Text.',
    subject: null,
    body: '[Vorgang öffnen]({{Link}})',
    placeholders: FRAME(STAFF_LINK),
  },
  {
    key: 'staffFooter',
    group: 'staff',
    label: 'Fusszeile (IT)',
    description: 'Klein gesetzt am Ende jeder Mail an IT-Mitarbeitende. Einfacher Text ohne Formatierung.',
    subject: null,
    body: 'Patchwork · Benachrichtigung zu {{Nummer}}',
    plain: true,
    placeholders: FRAME(STAFF_LINK),
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key);

/** Automatische Mails an Melder und Beteiligte, die im Verlauf des Vorgangs erscheinen; Mails an die IT nicht. */
export const TIMELINE_TEMPLATES: TemplateKey[] = [
  'confirmation',
  'done',
  'rejected',
  'duplicateMerged',
  'duplicateRedirected',
  'waitingReminder',
  'waitingClosed',
];

/** Diese Werte sind schon Markdown oder Adressen und werden für die HTML-Fassung nicht maskiert. */
const MARKDOWN_VALUES = new Set(['link', 'nummer', 'begründung']);

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');

/** Name eines Platzhalters zum Vergleichen: Gross-/Kleinschreibung und mehrfache Leerzeichen spielen keine Rolle. */
const placeholderKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Ersetzt {{Name}} (Gross-/Kleinschreibung egal); unbekannte Platzhalter bleiben stehen. */
export function fill(template: string, values: Record<string, string>): string {
  const lookup = new Map(Object.entries(values).map(([name, value]) => [placeholderKey(name), value]));
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, name: string, offset: number) => {
    const value = lookup.get(placeholderKey(name));
    if (value === undefined) return all;
    // Im Zitat («> {{Text}}») gehören auch die weiteren Zeilen eines mehrzeiligen Werts ins Zitat
    const line = template.slice(template.lastIndexOf('\n', offset - 1) + 1, offset);
    const quote = /^[ \t]*(?:>[ \t]?)+$/.exec(line)?.[0];
    return quote ? value.replace(/\n/g, `\n${quote}`) : value;
  });
}

/**
 * Vor- und Nachname einer Person für {{Melder Vorname}}, {{Melder Nachname}} usw.
 * Ohne Person (z.B. Vorgang ohne Zuständigen) bleiben beide leer.
 */
export function personValues(
  role: 'Melder' | 'Zuständig',
  person: { firstName: string; lastName: string } | null | undefined,
): Record<string, string> {
  return { [`${role} Vorname`]: person?.firstName.trim() ?? '', [`${role} Nachname`]: person?.lastName.trim() ?? '' };
}

/** Werte für die HTML-Fassung: Text aus Titeln, Namen und Antworten erscheint wörtlich, nicht als Markdown. */
function forMarkdown(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, MARKDOWN_VALUES.has(name.toLowerCase()) ? value : escapeMarkdown(value)]),
  );
}

/** Werte für die Textfassung: wörtlich, Markdown-Werte (z.B. die Begründung aus dem Editor) wie der übrige Text. */
function forText(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, MARKDOWN_VALUES.has(name.toLowerCase()) ? markdownAsText(value) : value]),
  );
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' };

/**
 * Bild (bleibt stehen, die Textfassung nennt es später als «[Bild: Name]»), maskiertes Zeichen wie «\*» oder «\[»
 * und HTML-Entität wie «&amp;» oder «&nbsp;» (leerer Absatz). So schreibt der Editor Markdown.
 */
const TEXT_SYNTAX = /(!\[(?:\\.|[^\\\]\n])*\]\([^)\s]*\))|\\([!-/:-@[-`{-~])|&(amp|lt|gt|quot|#39|nbsp);/g;

/**
 * Markdown aus dem Editor für die Textfassung der Mail: ohne Maskierungen und Entitäten, Zeilenumbrüche ohne die zwei
 * Leerzeichen davor, höchstens eine Leerzeile am Stück. Fett, Listen usw. bleiben als Markdown stehen.
 */
export function markdownAsText(markdown: string): string {
  return markdown
    .replace(TEXT_SYNTAX, (all, image?: string, escaped?: string, entity?: string) => image ?? escaped ?? ENTITIES[entity ?? ''] ?? all)
    .replace(/[ \t\u00a0]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Markdown-Link (kein Bild) mit Text (auch mit maskierten Zeichen wie «\]»), Ziel (auch in «<…>» oder ein Platzhalter
 * wie {{Link}}, auch mit Leerzeichen) und allfälligem Titel.
 */
const LINK =
  /(?<!!)\[((?:\\.|[^\\\]\n])*)\]\(\s*(?:<([^<>\n]*)>|(\{\{[^{}\n]*\}\}|[^\s)]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

/** Text der Mail: Links aus Markdown als «Text: Adresse», ohne Text (oder wenn er die Adresse ist) nur die Adresse. */
function linksAsText(markdown: string): string {
  return markdown.replace(LINK, (_all, label: string, angle?: string, bare?: string) => {
    const target = (angle ?? bare ?? '').trim();
    const text = label.trim();
    return text && text !== target ? `${text}: ${target}` : target;
  });
}

/**
 * Fertige Mail aus Text, Link-Zeile und Fusszeile (Vorlagen mit Platzhaltern), als Text und als HTML.
 * Im Text stehen die Werte wörtlich, im HTML maskiert, damit z.B. ein «*» im Titel keine Formatierung auslöst.
 * Text und Link-Zeile sind Markdown aus dem Editor, die Fusszeile einfacher Text.
 * «written»: Text des Bearbeiters (öffentliche Antwort), ohne Platzhalter übernommen.
 */
export function composeMail(
  parts: { body: string; link: string; footer: string; written?: boolean },
  values: Record<string, string>,
): { text: string; html: string } {
  const textValues = forText(values);
  const plain = (template: string) => fill(markdownAsText(template), textValues).trim();
  const markdown = (template: string) => fill(template, forMarkdown(values)).trim();
  // Links im Text wie in der Link-Zeile als «Text: Adresse»
  const body = parts.written ? markdownAsText(linksAsText(parts.body)).trim() : plain(linksAsText(parts.body));
  const bodyMarkdown = parts.written ? parts.body.trim() : markdown(parts.body);
  const link = plain(linksAsText(parts.link));
  const footer = fill(parts.footer, values).trim();
  return {
    text: [body, link, footer ? `-- \n${footer}` : ''].filter(Boolean).join('\n\n'),
    html: htmlMail(`${renderMarkdown(bodyMarkdown)}${renderMarkdown(markdown(parts.link))}`, footer),
  };
}

/**
 * Entspricht der Text dem Standard? Der Editor schreibt Zeilenumbrüche innerhalb eines Absatzes als «  \n»; das ist
 * derselbe Text wie mit «\n».
 */
export function sameText(a: string, b: string): boolean {
  const comparable = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return comparable(a) === comparable(b);
}

/**
 * Angepasste Fassungen ohne die Teile, die dem Standard entsprechen; null = nichts zu entfernen. «removed»: Vorlagen,
 * die damit ganz wieder Standard sind. Unbekannte Vorlagen bleiben unverändert.
 */
export function withoutDefaults(
  overrides: Record<string, { subject?: string; body?: string }>,
): { overrides: Record<string, { subject?: string; body?: string }>; removed: string[] } | null {
  const result: Record<string, { subject?: string; body?: string }> = {};
  const removed: string[] = [];
  let changed = false;
  for (const [key, entry] of Object.entries(overrides)) {
    const definition = templateByKey(key);
    if (!definition) {
      result[key] = entry;
      continue;
    }
    const kept: { subject?: string; body?: string } = {};
    if (entry.subject !== undefined && entry.subject !== definition.subject) kept.subject = entry.subject;
    if (entry.body !== undefined && (definition.body === null || !sameText(entry.body, definition.body))) kept.body = entry.body;
    if (Object.keys(kept).length !== Object.keys(entry).length) changed = true;
    if (Object.keys(kept).length > 0) result[key] = kept;
    else removed.push(key);
  }
  return changed ? { overrides: result, removed } : null;
}

/** Werte der Platzhalter für die Vorschau. */
export function exampleValues(definition: TemplateDefinition): Record<string, string> {
  return Object.fromEntries(definition.placeholders.map((ph) => [ph.name, ph.example]));
}
