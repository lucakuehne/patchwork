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

const ITEM = [
  p('Nummer', 'Nummer des Vorgangs', 'PW-123'),
  p('Titel', 'Titel des Vorgangs', 'Drucker druckt nicht'),
  p('Status', 'Aktueller Status', 'Erledigt'),
  p('Melder', 'Name des Melders', 'Anna Muster'),
  p('App', 'Name der Anwendung (Verwaltung → Allgemein)', 'Patchwork'),
];
const PORTAL_LINK = p('Link', 'Link zur Meldung im Portal', 'https://patchwork.firma.local/portal/v/123');
const STAFF_LINK = p('Link', 'Link zum Vorgang in Patchwork', 'https://patchwork.firma.local/v/123');
const FRAME = (link: Placeholder) => [
  p('Nummer', 'Nummer des Vorgangs', 'PW-123'),
  p('Titel', 'Titel des Vorgangs', 'Drucker druckt nicht'),
  link,
  p('App', 'Name der Anwendung (Verwaltung → Allgemein)', 'Patchwork'),
];

export const TEMPLATES: TemplateDefinition[] = [
  {
    key: 'confirmation',
    group: 'reporter',
    label: 'Eingangsbestätigung',
    description: 'An den Melder, wenn eine neue Meldung per Mail oder im Portal eingeht.',
    subject: '{{Titel}}',
    body:
      'Guten Tag\n\nIhre Nachricht ist bei uns eingegangen und wurde unter der Nummer **{{Nummer}}** erfasst. ' +
      'Wir melden uns so bald wie möglich.\n\nFür Ergänzungen antworten Sie bitte direkt auf diese Mail.',
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
    description: 'An den Melder, wenn der Vorgang einen Status der Kategorie «Erledigt» erhält.',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Guten Tag\n\nIhr Anliegen «{{Titel}}» ({{Nummer}}) wurde auf «{{Status}}» gesetzt.\n\n' +
      'Falls noch etwas offen ist, antworten Sie einfach auf diese Mail.',
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'rejected',
    group: 'reporter',
    label: 'Abgelehnt',
    description: 'An den Melder, wenn eine Aufgabe abgelehnt wird und «Melder informieren» gewählt ist.',
    subject: 'Abgelehnt: {{Titel}}',
    body: 'Guten Tag\n\nIhr Anliegen «{{Titel}}» ({{Nummer}}) wurde abgelehnt.\n\n**Begründung:**\n\n{{Begründung}}',
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
      'Guten Tag\n\nIhre Nachricht {{Duplikat}} betrifft denselben Vorgang wie {{Original}} und wurde dort hinzugefügt. ' +
      'Für Ergänzungen antworten Sie bitte auf diese Mail.',
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
      'Nummer und Titel gehören zum Original.',
    subject: '{{Titel}}',
    body:
      'Guten Tag\n\nIhre Meldung {{Duplikat}} betrifft dasselbe wie {{Original}} und wird dort weiterbearbeitet. ' +
      'Sie erhalten die Updates per Mail.',
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
    description: 'An den Melder, wenn ein Vorgang länger auf seine Rückmeldung wartet (Regel «Melder per Mail erinnern»).',
    subject: 'Erinnerung: {{Titel}}',
    body:
      'Guten Tag\n\nWir warten noch auf Ihre Rückmeldung zu «{{Titel}}» ({{Nummer}}). Bitte antworten Sie direkt auf diese Mail.' +
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
    description: 'An den Melder, wenn eine Regel den Vorgang mangels Rückmeldung schliesst (statt der Mail «Erledigt»).',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Guten Tag\n\nZu «{{Titel}}» ({{Nummer}}) haben wir seit {{Tage}} Tagen keine Rückmeldung erhalten ' +
      'und den Vorgang deshalb geschlossen.\n\nFalls noch etwas offen ist, antworten Sie einfach auf diese Mail.',
    placeholders: [...ITEM, p('Tage', 'Tage ohne Rückmeldung', '7'), PORTAL_LINK],
  },
  {
    key: 'reporterLink',
    group: 'reporter',
    label: 'Link-Zeile (Melder)',
    description: 'Steht in jeder Mail an Melder und Beteiligte unter dem Text.',
    subject: null,
    body: '[Ihre Meldung online ansehen]({{Link}})',
    placeholders: FRAME(PORTAL_LINK),
  },
  {
    key: 'reporterFooter',
    group: 'reporter',
    label: 'Fusszeile (Melder)',
    description: 'Klein gesetzt am Ende jeder Mail an Melder und Beteiligte. Einfacher Text ohne Formatierung.',
    subject: null,
    body: '{{App}} · {{Nummer}}\nBitte lassen Sie bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.',
    plain: true,
    placeholders: FRAME(PORTAL_LINK),
  },
  {
    key: 'assigned',
    group: 'staff',
    label: 'Zugewiesen',
    description: 'An den neu Zuständigen, wenn ihm jemand oder eine Regel einen Vorgang zuweist.',
    subject: 'Zugewiesen: {{Titel}}',
    body: 'Zugewiesen: {{Nummer}} «{{Titel}}»\nZugewiesen durch: {{Zugewiesen durch}}\nMelder: {{Melder}} ({{Melder E-Mail}})',
    placeholders: [
      ...ITEM,
      p('Zuständig', 'Name des neu Zuständigen', 'Ivan IT'),
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
    body: 'Neue Antwort von {{Absender}} ({{Absender E-Mail}}) auf {{Nummer}} «{{Titel}}»:\n\n{{Text}}',
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
    description: 'An den Zuständigen, wenn ein Vorgang erledigt wird, der seinen Vorgang «behebt».',
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
    key: 'staffLink',
    group: 'staff',
    label: 'Link-Zeile (IT)',
    description: 'Steht in jeder Mail an IT-Mitarbeitende unter dem Text.',
    subject: null,
    body: 'Öffnen: {{Link}}',
    placeholders: FRAME(STAFF_LINK),
  },
  {
    key: 'staffFooter',
    group: 'staff',
    label: 'Fusszeile (IT)',
    description: 'Klein gesetzt am Ende jeder Mail an IT-Mitarbeitende. Einfacher Text ohne Formatierung.',
    subject: null,
    body: '{{App}} · Benachrichtigung zu {{Nummer}}',
    plain: true,
    placeholders: FRAME(STAFF_LINK),
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key);

/** Diese Werte sind schon Markdown oder Adressen und werden für die HTML-Fassung nicht maskiert. */
const MARKDOWN_VALUES = new Set(['link', 'nummer', 'begründung']);

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');

/** Ersetzt {{Name}} (Gross-/Kleinschreibung egal); unbekannte Platzhalter bleiben stehen. */
export function fill(template: string, values: Record<string, string>): string {
  const lookup = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, name: string) => lookup.get(name.toLowerCase()) ?? all);
}

/** Werte für die HTML-Fassung: Text aus Titeln, Namen und Antworten erscheint wörtlich, nicht als Markdown. */
function forMarkdown(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, MARKDOWN_VALUES.has(name.toLowerCase()) ? value : escapeMarkdown(value)]),
  );
}

/** Text der Mail: Links aus Markdown als «Text: Adresse». */
const linksAsText = (markdown: string) => markdown.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '$1: $2');

/**
 * Fertige Mail aus Text, Link-Zeile und Fusszeile (Vorlagen mit Platzhaltern), als Text und als HTML.
 * Im Text stehen die Werte wörtlich, im HTML maskiert, damit z.B. ein «*» im Titel keine Formatierung auslöst.
 * «written»: Text des Bearbeiters (öffentliche Antwort), unverändert übernommen.
 */
export function composeMail(
  parts: { body: string; link: string; footer: string; written?: boolean },
  values: Record<string, string>,
): { text: string; html: string } {
  const plain = (template: string) => fill(template, values).trim();
  const markdown = (template: string) => fill(template, forMarkdown(values)).trim();
  const body = parts.written ? parts.body.trim() : plain(parts.body);
  const bodyMarkdown = parts.written ? parts.body.trim() : markdown(parts.body);
  const link = plain(parts.link);
  const footer = plain(parts.footer);
  return {
    text: [body, linksAsText(link), footer ? `-- \n${footer}` : ''].filter(Boolean).join('\n\n'),
    html: htmlMail(`${renderMarkdown(bodyMarkdown)}${renderMarkdown(markdown(parts.link))}`, footer),
  };
}

/** Werte der Platzhalter für die Vorschau. */
export function exampleValues(definition: TemplateDefinition): Record<string, string> {
  return Object.fromEntries(definition.placeholders.map((ph) => [ph.name, ph.example]));
}
