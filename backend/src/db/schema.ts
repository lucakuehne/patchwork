import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { RuleActions, RuleGroup, RuleSchedule, RuleTrigger } from '../rules/rule-types';

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum('user_role', ['admin', 'it', 'standard']);
export const authSource = pgEnum('auth_source', ['local', 'ldap', 'oidc']);
export const itemType = pgEnum('item_type', ['incident', 'task']);
/** Ziel-Status je Typ (siehe STATUS_TARGETS in status-rules.ts) */
export const statusTarget = pgEnum('status_target', ['start', 'reply', 'close', 'reject', 'waiting']);
export const priority = pgEnum('priority', ['high', 'normal', 'low']);
export const itemSource = pgEnum('item_source', ['mail', 'portal', 'internal']);
export const entryKind = pgEnum('entry_kind', ['reply', 'note', 'status', 'type', 'change']);
/** oauth2 = App-Zugriff (Client Credentials), microsoft = Anmeldung mit einem Microsoft-Konto, Abruf und Versand über Microsoft Graph */
export const mailAuth = pgEnum('mail_auth', ['password', 'oauth2', 'microsoft']);
export const mailDirection = pgEnum('mail_direction', ['in', 'out']);
/** relates = bezieht sich auf (beidseitig), fixes = from behebt to, duplicate = from ist Duplikat von to */
export const linkKind = pgEnum('link_kind', ['relates', 'fixes', 'duplicate']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Vor- und Nachname für Platzhalter in Mails und Textbausteinen; AD-Konten aus givenName/sn, sonst aus dem Namen geschätzt */
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  /** Immer in Kleinbuchstaben gespeichert. */
  email: text('email').notNull().unique(),
  role: userRole('role').notNull().default('standard'),
  /** LDAP: Rolle von Hand festgelegt, gilt statt der AD-Gruppen auch bei der Anmeldung */
  roleManual: boolean('role_manual').notNull().default(false),
  authSource: authSource('auth_source').notNull().default('local'),
  passwordHash: text('password_hash'),
  ldapDn: text('ldap_dn'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 des Session-Tokens, das Token selbst wird nicht gespeichert. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** «Als dieser Benutzer arbeiten»: der Admin, der die Sitzung gestartet hat (sonst null) */
    impersonatorId: uuid('impersonator_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/** Microsoft Graph: Stand des Abrufs eines Postfachs. Gilt nur für die Einstellungen, aus denen «key» gebildet ist. */
export interface GraphSync {
  /** Adresse, Ordner, Startzeitpunkt und angemeldetes Konto beim Abruf */
  key: string;
  /** Pfad zum Postfach: «me» oder «users/<adresse>» */
  user: string;
  /** Nächster Aufruf der Delta-Abfrage (nächste Seite oder Delta-Link), null = von vorne */
  link: string | null;
}

export const mailboxes = pgTable('mailboxes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Absenderadresse, immer in Kleinbuchstaben. */
  address: text('address').notNull().unique(),
  active: boolean('active').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull().default(993),
  imapSecure: boolean('imap_secure').notNull().default(true),
  imapFolder: text('imap_folder').notNull().default('INBOX'),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull().default(587),
  /** tls = implizites TLS (465), starttls, none */
  smtpSecurity: text('smtp_security').notNull().default('starttls'),
  authType: mailAuth('auth_type').notNull().default('password'),
  username: text('username').notNull(),
  passwordEnc: text('password_enc'),
  oauthTokenUrl: text('oauth_token_url'),
  oauthClientId: text('oauth_client_id'),
  oauthClientSecretEnc: text('oauth_client_secret_enc'),
  oauthScope: text('oauth_scope'),
  /** Anmeldung mit Microsoft: Refresh-Token (verschlüsselt) und angemeldetes Konto */
  oauthRefreshTokenEnc: text('oauth_refresh_token_enc'),
  oauthAccount: text('oauth_account'),
  /** Mails abholen ab diesem Eingang im Postfach */
  fetchFrom: timestamp('fetch_from', { withTimezone: true }).notNull().defaultNow(),
  /** Microsoft Graph: gewählter Ordner (ID), null = Posteingang bzw. Pfad aus Anzeigenamen in imapFolder */
  graphFolderId: text('graph_folder_id'),
  /** Microsoft Graph: Stand des Abrufs (Delta-Abfrage), null = beim nächsten Abruf von vorne */
  graphSync: jsonb('graph_sync').$type<GraphSync>(),
  uidValidity: bigint('uid_validity', { mode: 'number' }),
  lastUid: bigint('last_uid', { mode: 'number' }).notNull().default(0),
  lastPollAt: timestamp('last_poll_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: createdAt(),
});

export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: itemType('type').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Abgeschlossen (Abschlussdatum, Listen offen/abgeschlossen, Board, Portal, Auswertungen) */
    closed: boolean('closed').notNull().default(false),
    /** Reihenfolge im Typ: Spalten des Boards und alle Auswahllisten */
    position: integer('position').notNull(),
    /** Farbe aus der Palette (siehe STATUS_COLORS) */
    color: text('color').notNull().default('gray'),
    /** Lage im Ablaufdiagramm; null = automatisch */
    diagramX: doublePrecision('diagram_x'),
    diagramY: doublePrecision('diagram_y'),
    createdAt: createdAt(),
  },
  (t) => [unique('statuses_type_key_uq').on(t.type, t.key)],
);

/** Erlaubte Wechsel von Hand (Ablauf). Gelten nur, wenn der Ablauf des Typs eingeschränkt ist. */
export const statusTransitions = pgTable(
  'status_transitions',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
);

/**
 * Ziel-Status je Typ: wohin automatische Wechsel führen (Start, nach Antwort, Schliessen, Ablehnen, Wartet).
 * Ein Status kann mehrere Ziele tragen; löschen lässt er sich erst, wenn seine Ziele umgehängt sind.
 */
export const statusTargets = pgTable(
  'status_targets',
  {
    type: itemType('type').notNull(),
    target: statusTarget('target').notNull(),
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.type, t.target] })],
);

/**
 * Meldewege (wie ein Vorgang gemeldet wurde), in der Verwaltung pflegbar, mit Symbol aus einer festen Auswahl.
 * «key» = mail bzw. portal: setzt Patchwork selbst, lässt sich nicht löschen.
 */
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique(),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  position: integer('position').notNull(),
  createdAt: createdAt(),
});

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    /** null = liegt im Eingang */
    type: itemType('type'),
    statusId: uuid('status_id').references(() => statuses.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Bereinigtes HTML der ursprünglichen Mail, falls vorhanden. */
    descriptionHtml: text('description_html'),
    priority: priority('priority').notNull().default('normal'),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** Postfach, über das geantwortet wird. */
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    source: itemSource('source').notNull(),
    /** Meldeweg; null = ohne Angabe (intern erfasst vor der Einführung) */
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'restrict' }),
    /** Typ-Vorschlag des Melders aus dem Portal, bis die IT ihn bestätigt */
    suggestedType: itemType('suggested_type'),
    /** Aus einer im Testbetrieb simulierten Mail entstanden */
    simulated: boolean('simulated').notNull().default(false),
    discarded: boolean('discarded').notNull().default(false),
    /** Fälligkeitsdatum (nur Aufgaben, ohne Uhrzeit); bei Störungen gespeichert, aber ausgeblendet */
    dueDate: date('due_date', { mode: 'string' }),
    /** Fälligkeitsdatum, zu dem die Mail an den Zuständigen schon ging (eine Mail pro Datum) */
    dueNotifiedOn: date('due_notified_on', { mode: 'string' }),
    boardPosition: doublePrecision('board_position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Letzter Statuswechsel, gesetzt durch einen Datenbank-Trigger (zeitgesteuerte Regeln) */
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    search: tsvector('search').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('german'::regconfig, coalesce(${items.title}, '')), 'A') || setweight(to_tsvector('german'::regconfig, coalesce(${items.description}, '')), 'B')`,
    ),
  },
  (t) => [
    index('items_type_idx').on(t.type),
    index('items_status_idx').on(t.statusId),
    index('items_assignee_idx').on(t.assigneeId),
    index('items_reporter_idx').on(t.reporterId),
    index('items_search_idx').using('gin', t.search),
  ],
);

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** null = System */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    kind: entryKind('kind').notNull(),
    body: text('body').notNull().default(''),
    bodyHtml: text('body_html'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    mailMessageId: text('mail_message_id'),
    // clock_timestamp statt now(): mehrere Einträge derselben Transaktion behalten ihre Reihenfolge
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /** Eigene interne Notizen lassen sich kurz nach dem Erfassen korrigieren */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    search: tsvector('search').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('german'::regconfig, coalesce(${entries.body}, ''))`,
    ),
  },
  (t) => [index('entries_item_idx').on(t.itemId, t.createdAt), index('entries_search_idx').using('gin', t.search)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** null = gehört zur Beschreibung bzw. zur ursprünglichen Mail */
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    /** Content-ID für eingebettete Bilder in Mails */
    contentId: text('content_id'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_item_idx').on(t.itemId), index('attachments_entry_idx').on(t.entryId)],
);

/**
 * Bilder, die jemand im Editor eingefügt, aber noch nicht gespeichert hat. Im Text stehen sie als «upload:<id>»;
 * beim Speichern werden sie zu eingebetteten Anhängen des Vorgangs. Liegengebliebene löscht die Wartung.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('uploads_created_idx').on(t.createdAt)],
);

export const participants = pgTable(
  'participants',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] })],
);

export const mutes = pgTable(
  'mutes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

/** Message-IDs aller ein- und ausgehenden Mails, für die Zuordnung von Antworten. */
export const mailMessages = pgTable(
  'mail_messages',
  {
    messageId: text('message_id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    direction: mailDirection('direction').notNull(),
    /** Zugehöriger Timeline-Eintrag, null = ursprüngliche Mail bzw. Benachrichtigung */
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    /** Ablageschlüssel der Originalmail (.eml), nur bei eingehenden Mails */
    storageKey: text('storage_key'),
    createdAt: createdAt(),
  },
  (t) => [index('mail_messages_item_idx').on(t.itemId, t.createdAt)],
);

/**
 * Protokoll aller ausgehenden Mails, vollständig als .eml (so wie sie ohne Testbetrieb versendet worden wären).
 * queued = wird versendet, sent = an alle, partial = im Testbetrieb nur an «deliveredTo» (nur diese im Kopf),
 * held = im Testbetrieb an niemanden, failed = Versand fehlgeschlagen (wird bis zum letzten Versuch wiederholt).
 */
export const outgoingStatus = pgEnum('outgoing_status', ['queued', 'sent', 'partial', 'held', 'failed']);

export const outgoingMails = pgTable(
  'outgoing_mails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: text('message_id').notNull().unique(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Timeline-Eintrag der öffentlichen Antwort, null = Bestätigung oder Benachrichtigung */
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    fromAddress: text('from_address').notNull(),
    to: jsonb('to').$type<string[]>().notNull(),
    cc: jsonb('cc').$type<string[]>().notNull(),
    subject: text('subject').notNull(),
    automated: boolean('automated').notNull(),
    /** Vorlage der Mail (z.B. «done», «reply»); null bei älteren automatischen Mails, die sie noch nicht festhielten */
    template: text('template'),
    /** Weiterer Vorgang, in dessen Verlauf die Mail erscheint: beim Duplikat-Hinweis das Duplikat */
    relatedItemId: uuid('related_item_id').references(() => items.id, { onDelete: 'set null' }),
    status: outgoingStatus('status').notNull(),
    /** Empfänger, an die die Mail tatsächlich ging */
    deliveredTo: jsonb('delivered_to').$type<string[]>().notNull().default([]),
    /** Letzter Fehler beim Versand */
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /** Angaben zur Mail für «Erneut senden» */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('outgoing_mails_created_idx').on(t.createdAt),
    index('outgoing_mails_item_idx').on(t.itemId),
    index('outgoing_mails_related_item_idx').on(t.relatedItemId),
    index('outgoing_mails_status_idx').on(t.status),
  ],
);

/**
 * Protokoll der eingehenden Mails (abgeholt oder im Testbetrieb simuliert), vollständig als .eml, mit dem Ergebnis:
 * created = neuer Vorgang, reply = Antwort, note = interne Notiz (Absender nicht beteiligt), automated = automatische
 * Antwort (z.B. Abwesenheitsnotiz), ignored = nicht verarbeitet, failed = Fehler. Grund bzw. Fehlermeldung in «reason».
 */
export const incomingResult = pgEnum('incoming_result', ['created', 'reply', 'note', 'automated', 'ignored', 'failed']);

export const incomingMails = pgTable(
  'incoming_mails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Dieselbe Mail erscheint nur einmal, auch wenn sie erneut abgerufen wird */
    messageId: text('message_id').notNull().unique(),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name').notNull().default(''),
    to: jsonb('to').$type<string[]>().notNull(),
    cc: jsonb('cc').$type<string[]>().notNull(),
    subject: text('subject').notNull(),
    /** Datum laut Mail (Kopfzeile «Date») */
    mailDate: timestamp('mail_date', { withTimezone: true }),
    result: incomingResult('result').notNull(),
    reason: text('reason'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    simulated: boolean('simulated').notNull().default(false),
    simulatedById: uuid('simulated_by_id').references(() => users.id, { onDelete: 'set null' }),
    attempts: integer('attempts').notNull().default(1),
    storageKey: text('storage_key').notNull(),
    /** Abgerufen bzw. simuliert */
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('incoming_mails_created_idx').on(t.createdAt), index('incoming_mails_result_idx').on(t.result)],
);

/** Verknüpfungen zwischen Vorgängen. Bei «relates» ist die Richtung bedeutungslos. */
export const links = pgTable(
  'links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: linkKind('kind').notNull(),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [unique('links_from_to_kind_uq').on(t.fromId, t.toId, t.kind), index('links_to_idx').on(t.toId)],
);

/** Checklisten einer Aufgabe */
export const checklists = pgTable(
  'checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('checklists_item_idx').on(t.itemId)],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('checklist_items_checklist_idx').on(t.checklistId)],
);

/** Vorlagen für Checklisten (z.B. «Neuer Mitarbeiter»), vom Admin gepflegt */
export const checklistTemplates = pgTable('checklist_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const checklistTemplateItems = pgTable(
  'checklist_template_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('checklist_template_items_template_idx').on(t.templateId)],
);

/** Regeln für neue Vorgänge und Antworten (Etappe 3), abgearbeitet nach «position» */
export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull(),
  /** Ereignisse, bei denen die Regel greift (leer bei zeitgesteuerten Regeln) */
  triggers: jsonb('triggers').$type<RuleTrigger[]>().notNull(),
  /** Zeitgesteuert: seit so vielen Tagen in einem dieser Status bzw. im Wartet-Status (sonst null) */
  schedule: jsonb('schedule').$type<RuleSchedule>(),
  /** Bedingungen als Gruppe (UND/ODER) aus Einzelbedingungen und Untergruppen */
  conditions: jsonb('conditions').$type<RuleGroup>().notNull(),
  actions: jsonb('actions').$type<RuleActions>().notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Ausführungen zeitgesteuerter Regeln: höchstens einmal pro Vorgang und Aufenthalt in einem Status */
export const ruleRuns = pgTable(
  'rule_runs',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Statuswechsel des Vorgangs, auf den sich die Ausführung bezieht */
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.itemId, t.statusChangedAt] })],
);

/** Textbausteine für Antworten und Notizen */
export const snippets = pgTable('snippets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Markdown mit Platzhaltern wie {{Melder Vorname}} */
  body: text('body').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Status = typeof statuses.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type OutgoingMailRow = typeof outgoingMails.$inferSelect;
export type IncomingMailRow = typeof incomingMails.$inferSelect;
export type IncomingResult = (typeof incomingResult.enumValues)[number];
export type Attachment = typeof attachments.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Snippet = typeof snippets.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type ItemType = (typeof itemType.enumValues)[number];
export type StatusTargetKind = (typeof statusTarget.enumValues)[number];
export type Priority = (typeof priority.enumValues)[number];
