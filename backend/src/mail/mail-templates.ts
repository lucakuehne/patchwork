import { factsHtml, htmlMail, linkLineHtml, renderMarkdown, replyHeadingHtml } from './mail-content';

/** Vorlagen für die Mails von Patchwork: Betreff und Text (Markdown) mit Platzhaltern wie {{Titel}}. */
export type TemplateKey =
  | 'confirmation'
  | 'reply'
  | 'replyClosed'
  | 'done'
  | 'rejected'
  | 'duplicateMerged'
  | 'duplicateRedirected'
  | 'waitingReminder'
  | 'waitingClosed'
  | 'reporterLink'
  | 'reporterFooter'
  | 'importHint'
  | 'assigned'
  | 'inboundReply'
  | 'fixCompleted'
  | 'mentioned'
  | 'newEntry'
  | 'dueReminder'
  | 'staffLink'
  | 'staffFooter'
  | 'welcome';

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
  /** Mail ohne Vorgang (Willkommens-Mail): ohne «[PW-123]» im Betreff, ohne Link- und Fusszeile */
  standalone?: boolean;
  /** Wird nicht mehr verschickt; bleibt für den Namen älterer Mails im Protokoll und im Verlauf, fehlt in der Verwaltung */
  retired?: boolean;
  /**
   * Frühere Standardtexte: Eine gespeicherte Fassung mit einem davon gilt als Standard (sie konnte nur als Standard
   * entstehen, gespeichert wird nur, was abweicht), damit ein neuer Standard auch dort gilt.
   */
  formerBodies?: string[];
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
const PORTAL_LINK = p('Link', 'Link zur Meldung im Portal', 'https://patchwork.firma.local/portal/items/123');
const STAFF_LINK = p('Link', 'Link zum Vorgang in Patchwork', 'https://patchwork.firma.local/items/123');
const FRAME = (link: Placeholder) => [NUMBER, TITLE, link];

export const TEMPLATES: TemplateDefinition[] = [
  {
    key: 'confirmation',
    group: 'reporter',
    label: 'Eingangsbestätigung',
    description:
      'An den Melder, sobald eine neue Meldung per Mail oder im Portal eingeht. Nicht bei automatischen Mails und ' +
      'Newslettern und nicht, wenn eine Regel «Keine Eingangsbestätigung schicken» setzt.',
    subject: '{{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Meldung ist bei uns eingegangen und wurde unter der Nummer **{{Nummer}}** erfasst. ' +
      'Wir melden uns so bald wie möglich.\n\nFür Ergänzungen antworte bitte direkt auf diese E-Mail.',
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'reply',
    group: 'reporter',
    label: 'Öffentliche Antwort',
    description:
      'An Melder (An) und Beteiligte (CC), wenn jemand in der IT im Vorgang eine öffentliche Antwort schreibt. Den Text ' +
      'schreibt der Bearbeiter; er steht als Zitat unter der Zeile «Name hat geantwortet:».',
    subject: '{{Titel}}',
    body: null,
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'replyClosed',
    group: 'reporter',
    label: 'Antwort mit Abschluss',
    description:
      'An Melder (An) und Beteiligte (CC), wenn jemand eine öffentliche Antwort schreibt und den Vorgang dabei abschliesst ' +
      '(«Antwort senden» mit einem abgeschlossenen Status, nicht beim Ablehnen). Ersetzt dann die Mails «Öffentliche ' +
      'Antwort» und «Abgeschlossen». Anhänge der Antwort gehen mit.',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Meldung «{{Titel}}» ({{Nummer}}) wurde auf «{{Status}}» gesetzt.\n\n' +
      '**{{Bearbeiter}}** hat geantwortet:\n\n> {{Antwort}}\n\nFalls noch etwas offen ist, antworte einfach auf diese Mail.',
    formerBodies: [
      'Hallo {{Melder Vorname}}\n\nDeine Meldung «{{Titel}}» ({{Nummer}}) wurde auf «{{Status}}» gesetzt.\n\n' +
        '**Nachricht von {{Bearbeiter}}:**\n\n> {{Antwort}}\n\nFalls noch etwas offen ist, antworte einfach auf diese Mail.',
    ],
    placeholders: [
      ...ITEM,
      p('Bearbeiter', 'Wer geantwortet hat', 'Ivan IT'),
      p('Antwort', 'Text der Antwort', 'Der Toner ist ersetzt, der Drucker läuft wieder.'),
      PORTAL_LINK,
    ],
  },
  {
    key: 'done',
    group: 'reporter',
    label: 'Abgeschlossen',
    description:
      'An den Melder, wenn jemand den Vorgang in einen abgeschlossenen Status setzt (nicht beim Ablehnen und nicht ' +
      'zwischen zwei abgeschlossenen Status) und wenn eine Regel eine neue Aufgabe gleich abschliesst.',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Meldung «{{Titel}}» ({{Nummer}}) wurde auf «{{Status}}» gesetzt.\n\n' +
      'Falls noch etwas offen ist, antworte einfach auf diese Mail.',
    placeholders: [...ITEM, PORTAL_LINK],
  },
  {
    key: 'rejected',
    group: 'reporter',
    label: 'Abgelehnt',
    description:
      'An den Melder, wenn jemand den Vorgang ablehnt und dabei «Melder informieren» wählt. Nur bei Typen mit ' +
      'Ablehnen-Status (Verwaltung → Status).',
    subject: 'Abgelehnt: {{Titel}}',
    body: 'Hallo {{Melder Vorname}}\n\nDeine Meldung «{{Titel}}» ({{Nummer}}) wurde abgelehnt.\n\n**Begründung:**\n\n> {{Begründung}}',
    placeholders: [...ITEM, p('Begründung', 'Begründung der Ablehnung', 'Dafür ist die IT nicht zuständig.'), PORTAL_LINK],
  },
  {
    key: 'duplicateMerged',
    group: 'reporter',
    label: 'Duplikat: ins Original übernommen',
    description:
      'An Melder und Beteiligte eines Duplikats, wenn jemand es mit «Zusammenführen …» ins Original übernimmt. Nummer, ' +
      'Titel und Link gehören zum Original.',
    subject: '{{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nDeine Meldung {{Duplikat}} betrifft dasselbe wie {{Original}} und wurde dort hinzugefügt. ' +
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
      'Bis 02.11.2026 an Melder und Beteiligte eines Duplikats mit anderem Melder; sie erhielten künftig die Updates des ' +
      'Originals. Seit «Duplikat von» nur noch bei gleichem Melder geht, wird diese Mail nicht mehr verschickt.',
    retired: true,
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
      'An den Melder, wenn ein Vorgang schon einige Tage auf seine Rückmeldung wartet. Nur über eine zeitgesteuerte ' +
      'Regel mit «Melder per Mail erinnern» (Verwaltung → Regeln), nach den dort eingestellten Tagen im Status «Wartet ' +
      'auf den Melder».',
    subject: 'Erinnerung: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nWir warten noch auf deine Rückmeldung zu «{{Titel}}» ({{Nummer}}). Bitte antworte direkt auf diese E-Mail.' +
      '\n\n{{Schliessung}}',
    placeholders: [
      ...ITEM,
      p(
        'Schliessung',
        'Satz zum automatischen Schliessen, leer ohne passende Regel',
        'Ohne Rückmeldung schliessen wir die Meldung am 27.10.2026.',
      ),
      PORTAL_LINK,
    ],
  },
  {
    key: 'waitingClosed',
    group: 'reporter',
    label: 'Automatisch geschlossen',
    description:
      'An den Melder, wenn eine zeitgesteuerte Regel mit «Vorgang schliessen» (Verwaltung → Regeln) den Vorgang ' +
      'mangels Rückmeldung schliesst. Ersetzt dann die Mail «Abgeschlossen».',
    subject: '{{Status}}: {{Titel}}',
    body:
      'Hallo {{Melder Vorname}}\n\nZu «{{Titel}}» ({{Nummer}}) haben wir seit {{Tage}} Tagen keine Rückmeldung erhalten ' +
      'und die Meldung deshalb geschlossen.\n\nFalls noch etwas offen ist, antworte einfach auf diese E-Mail.',
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
    body:
      'Antworte einfach auf diese E-Mail, dann landet deine Antwort direkt bei der Meldung. Bitte lass die Nummer ' +
      '[{{Nummer}}] im Betreff stehen.',
    formerBodies: ['Patchwork · {{Nummer}}\nBitte lass bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.'],
    plain: true,
    placeholders: FRAME(PORTAL_LINK),
  },
  {
    key: 'importHint',
    group: 'reporter',
    label: 'Hinweis bei importierten Mails',
    description:
      'Steht in der Eingangsbestätigung unter dem Text, wenn jemand in der IT eine Mail importiert hat, die an eine ' +
      'andere Adresse ging (Eingang → Mail importieren).',
    subject: null,
    body:
      'Deine E-Mail ging nicht an unsere Helpdesk-Adresse, wir haben sie für dich übernommen. Bitte schreib uns ' +
      'künftig direkt an {{Postfach}}, dann kommt deine Meldung sofort bei uns an.',
    placeholders: [
      NUMBER,
      TITLE,
      p('Postfach', 'Adresse, über die Patchwork antwortet', 'helpdesk@firma.ch'),
      p('Ursprünglich an', 'Adresse(n), an die die Mail ursprünglich ging', 'ivan.it@firma.ch'),
    ],
  },
  {
    key: 'assigned',
    group: 'staff',
    label: 'Zugewiesen',
    description:
      'An den neu Zuständigen, wenn ihm jemand oder eine Regel einen Vorgang zuweist. Nicht, wenn man sich selbst ' +
      'zuweist. Unter dem Text stehen immer Status, Typ und Priorität, Melder und der Anfang der Beschreibung.',
    subject: 'Zugewiesen: {{Titel}}',
    body: '**{{Zugewiesen durch}}** hat dir {{Nummer}} zugewiesen.',
    formerBodies: [
      'Zugewiesen: {{Nummer}} «{{Titel}}»\nZugewiesen durch: {{Zugewiesen durch}}\n' +
        'Melder: {{Melder Vorname}} {{Melder Nachname}} ({{Melder E-Mail}})',
    ],
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
    description: 'An den Zuständigen, wenn Melder oder Beteiligte per Mail oder im Portal antworten. Ohne Zuständigen keine Mail.',
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
      'An den Zuständigen, wenn ein Vorgang, der seinen Vorgang «behebt» (Verknüpfung), von Hand abgeschlossen wird ' +
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
    body: '{{Bearbeiter}} hat dich in {{Nummer}} «{{Titel}}» erwähnt ({{Art}}):\n\n> {{Text}}',
    placeholders: [
      ...ITEM,
      p('Bearbeiter', 'Wer erwähnt hat', 'Ada Admin'),
      p('Art', 'Öffentliche Antwort oder interne Notiz', 'interne Notiz'),
      p('Text', 'Text der Antwort bzw. Notiz', '@Ivan Informatik, kannst du das übernehmen?'),
      STAFF_LINK,
    ],
  },
  {
    key: 'newEntry',
    group: 'staff',
    label: 'Neuer Eintrag',
    description:
      'An den Zuständigen, wenn jemand anderes im Vorgang eine interne Notiz oder öffentliche Antwort schreibt, und bei ' +
      'Mails, die als interne Notiz landen (von Unbeteiligten oder von IT-Mitarbeitenden). Nicht bei eigenen Einträgen, ' +
      'nicht beim Bearbeiten, nicht bei automatischen Mails wie Abwesenheitsnotizen und nicht, wenn der Zuständige im ' +
      'Eintrag erwähnt ist (dann «Erwähnt»). Ohne Zuständigen keine Mail.',
    subject: 'Neuer Eintrag: {{Titel}}',
    body: '**{{Verfasser}}** hat in {{Nummer}} geschrieben ({{Art}}):\n\n> {{Text}}',
    placeholders: [
      ...ITEM,
      p('Verfasser', 'Wer geschrieben hat (bei Mails von Unbeteiligten mit Mail-Adresse)', 'Ada Admin'),
      p('Art', 'Interne Notiz, öffentliche Antwort oder Mail, die als interne Notiz erfasst wurde', 'interne Notiz'),
      p('Text', 'Text des Eintrags', 'Kannst du das bis Freitag erledigen?'),
      STAFF_LINK,
    ],
  },
  {
    key: 'dueReminder',
    group: 'staff',
    label: 'Fällig',
    description:
      'An den Zuständigen am Fälligkeitstag einer offenen Aufgabe, ab 07:00 und einmal pro Datum. Ohne Zuständigen ' +
      'keine Mail.',
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
  {
    key: 'welcome',
    group: 'staff',
    label: 'Willkommen',
    description:
      'An neue IT-Mitarbeitende und Admins, nur von Hand unter Verwaltung → Benutzer (beim Anlegen bzw. Rollenwechsel ' +
      'fragt Patchwork nach). Ohne Vorgang, deshalb ohne Nummer im Betreff und ohne Link- und Fusszeile.',
    subject: 'Willkommen bei Patchwork',
    body:
      'Hallo {{Vorname}}\n\nWillkommen bei Patchwork! Du hast die Rolle **{{Rolle}}** und kannst ab sofort Vorgänge der IT ' +
      'bearbeiten.\n\nBenutzername: {{Benutzername}}\nAnmeldung: {{Anmeldung}}\n\n[Patchwork öffnen]({{Link}})',
    standalone: true,
    placeholders: [
      p('Vorname', 'Vorname der Person', 'Ivan'),
      p('Nachname', 'Nachname der Person', 'Informatik'),
      p('Rolle', 'Rolle in Patchwork (IT oder Admin)', 'IT'),
      p('Benutzername', 'Benutzername für die Anmeldung (AD-Konto: Anmeldename, sonst die E-Mail-Adresse)', 'iinformatik'),
      p(
        'Anmeldung',
        'Wie man sich anmeldet: mit dem Windows-Konto bzw. mit dem Passwort, das man separat erhält',
        'mit deinem Windows-Konto (gleiches Passwort wie am Computer)',
      ),
      p('Link', 'Link zu Patchwork', 'https://patchwork.firma.local/'),
    ],
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key);

/** Aktive Regel mit ihren Aktionen, für den aktuellen Stand der Mails, die nur eine Regel auslöst */
interface ActiveRule {
  name: string;
  actions: { remindReporter?: boolean; close?: boolean };
}

/** Mails, die nur eine zeitgesteuerte Regel verschickt, mit der Aktion der Regel */
const RULE_MAILS: Partial<Record<TemplateKey, { action: 'remindReporter' | 'close'; label: string }>> = {
  waitingReminder: { action: 'remindReporter', label: 'Melder per Mail erinnern' },
  waitingClosed: { action: 'close', label: 'Vorgang schliessen' },
};

/**
 * Arten von Mails mit Erklärung (Tooltips unter Verwaltung → Ausgehende Mails, Entscheid vom 03.11.2026): alle Vorlagen
 * mit Betreff, auch nicht mehr verschickte (für ältere Mails). «state»: aktueller Stand bei Mails, die nur eine Regel
 * verschickt, sonst null.
 */
export function mailKinds(activeRules: ActiveRule[]) {
  return TEMPLATES.filter((t) => t.subject !== null).map((t) => {
    const rule = RULE_MAILS[t.key];
    let state: string | null = null;
    if (rule) {
      const names = activeRules.filter((r) => r.actions[rule.action]).map((r) => `«${r.name}»`);
      state = names.length
        ? `${names.length === 1 ? 'Aktive Regel' : 'Aktive Regeln'}: ${names.join(', ')}.`
        : `Derzeit keine aktive Regel mit «${rule.label}»: Diese Mail wird nicht verschickt.`;
    }
    return { key: t.key, group: t.group, label: t.label, description: t.description, retired: !!t.retired, state };
  });
}

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
const MARKDOWN_VALUES = new Set(['link', 'nummer', 'begründung', 'antwort']);

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

/** Eckdaten einer Mail, z.B. «Status: In Bearbeitung» */
export interface MailFact {
  label: string;
  value: string;
}

export interface MailParts {
  body: string;
  link: string;
  footer: string;
  /** Text des Bearbeiters (öffentliche Antwort), ohne Platzhalter übernommen */
  written?: boolean;
  /** Verfasser einer öffentlichen Antwort: Kopfzeile «Name hat geantwortet:», der Text darunter als Zitat */
  author?: string;
  /** Eckdaten nach dem Text, nebeneinander (Mail «Zugewiesen») */
  facts?: MailFact[];
  /** Anfang der Beschreibung als Zitat nach den Eckdaten (Mail «Zugewiesen»), einfacher Text */
  excerpt?: string;
}

/** Markdown als Zitat: jede Zeile mit «> », leere Zeilen trennen die Absätze im Zitat. */
const asQuote = (markdown: string) =>
  markdown
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');

/**
 * Fertige Mail aus Text, Link-Zeile und Fusszeile (Vorlagen mit Platzhaltern), als Text und als HTML.
 * Im Text stehen die Werte wörtlich, im HTML maskiert, damit z.B. ein «*» im Titel keine Formatierung auslöst.
 * Text und Link-Zeile sind Markdown aus dem Editor, die Fusszeile einfacher Text. Eine Link-Zeile, die nur aus einem
 * Link besteht, erscheint im HTML als Knopf.
 */
export function composeMail(parts: MailParts, values: Record<string, string>): { text: string; html: string } {
  const textValues = forText(values);
  const plain = (template: string) => fill(markdownAsText(template), textValues).trim();
  const markdown = (template: string) => fill(template, forMarkdown(values)).trim();
  // Links im Text wie in der Link-Zeile als «Text: Adresse»
  const body = parts.written ? markdownAsText(linksAsText(parts.body)).trim() : plain(linksAsText(parts.body));
  const bodyMarkdown = parts.written ? parts.body.trim() : markdown(parts.body);
  const link = plain(linksAsText(parts.link));
  const footer = fill(parts.footer, values).trim();
  const author = parts.author?.trim();
  const facts = (parts.facts ?? []).filter((f) => f.value.trim());
  const excerpt = parts.excerpt?.trim() ?? '';

  const text = [
    author ? `${author} hat geantwortet:` : '',
    author && body ? asQuote(body) : body,
    facts.map((f) => `${f.label}: ${f.value}`).join('\n'),
    excerpt ? asQuote(excerpt) : '',
    link,
    footer ? `-- \n${footer}` : '',
  ];
  const html = [
    author ? replyHeadingHtml(author) : '',
    bodyMarkdown ? renderMarkdown(author ? asQuote(bodyMarkdown) : bodyMarkdown) : '',
    facts.length ? factsHtml(facts) : '',
    excerpt ? renderMarkdown(asQuote(escapeMarkdown(excerpt))) : '',
    linkLineHtml(renderMarkdown(markdown(parts.link))),
  ];
  return { text: text.filter(Boolean).join('\n\n'), html: htmlMail(html.join(''), footer) };
}

/** Länge des Auszugs aus der Beschreibung in der Mail «Zugewiesen» (Zeichen) */
export const EXCERPT_LENGTH = 300;

/**
 * Anfang eines Texts (Markdown) als einfacher Text auf einer Zeile, gekürzt an einer Wortgrenze mit «…».
 * Bilder und Erwähnungen ersetzt der Aufrufer vorher durch Text.
 */
export function excerpt(markdown: string, max = EXCERPT_LENGTH): string {
  const text = renderMarkdown(markdown)
    // Absätze, Listen, Zitate (Tabellen) trennen mit einem Leerzeichen, Fett, Links usw. verschwinden ohne Lücke
    .replace(/<\/?(?:p|br|li|ul|ol|h[1-6]|pre|hr|table|tr|td|div)\b[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (all, entity: string) => ENTITIES[entity] ?? all)
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : text.slice(0, max)).trimEnd()} …`;
}

/**
 * Eckdaten der Mail «Zugewiesen» (Entscheid vom 06.11.2026): Status, Typ und Priorität, Melder (ohne Mail-Adresse).
 * Ohne Typ (Vorgang im Eingang) nur die Priorität; ohne Status fällt er weg.
 */
export function assignedFacts(input: { status: string; type: string | null; priority: string; reporter: string }): MailFact[] {
  return [
    { label: 'Status', value: input.status },
    input.type ? { label: 'Typ · Priorität', value: `${input.type} · ${input.priority}` } : { label: 'Priorität', value: input.priority },
    { label: 'Melder', value: input.reporter },
  ].filter((f) => f.value.trim());
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
 * Angepasste Fassungen ohne die Teile, die dem Standard (oder einem früheren Standard) entsprechen; null = nichts zu
 * entfernen. «removed»: Vorlagen, die damit ganz wieder Standard sind. Unbekannte Vorlagen bleiben unverändert.
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
    const defaults = definition.body === null ? [] : [definition.body, ...(definition.formerBodies ?? [])];
    if (entry.body !== undefined && !defaults.some((text) => sameText(entry.body!, text))) kept.body = entry.body;
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
