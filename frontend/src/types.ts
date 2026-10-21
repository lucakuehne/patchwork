export type Role = 'admin' | 'it' | 'standard';
export type ItemType = 'incident' | 'task';
export type Priority = 'high' | 'normal' | 'low';
export type View = 'inbox' | 'incidents' | 'incidents-closed' | 'board' | 'tasks-done' | 'tasks-rejected' | 'search';

export interface User {
  id: string;
  name: string;
  /** Vor- und Nachname für Platzhalter in Mails und Textbausteinen */
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
}

/** Treffer der Personensuche: Benutzer aus Patchwork (mit id) oder Konto aus dem Verzeichnis (id null) */
export interface PersonHit {
  id: string | null;
  name: string;
  email: string;
  role: Role | null;
  /** Anmeldename im Verzeichnis (AD) */
  username: string | null;
  source: 'patchwork' | 'directory';
}

/** Gewählte Person; id null = aus dem AD oder neue E-Mail-Adresse, noch nicht in Patchwork */
export interface PersonPick {
  id: string | null;
  name: string;
  email: string;
  role: Role | null;
}

/** Person im AD mit der Rolle aus den AD-Gruppen */
export interface DirectoryPerson {
  dn: string;
  name: string;
  /** Aus givenName/sn, sonst aus dem Namen geschätzt */
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
}

export interface AdminUser extends User {
  authSource: 'local' | 'ldap' | 'oidc';
  /** AD-Konto mit von Hand festgelegter Rolle (gilt auch bei der Anmeldung) */
  roleManual: boolean;
  active: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Testbetrieb: Wer Mails tatsächlich erhält – niemand, nur ausgewählte oder alle */
export type DeliveryScope = 'none' | 'selected' | 'all';

/** Testbetrieb (Verwaltung → Allgemein) */
export interface MailSettings {
  /** IT-Mitarbeitende (Rolle IT oder Admin) */
  staff: DeliveryScope;
  /** Melder, Beteiligte und alle übrigen Empfänger */
  others: DeliveryScope;
  staffEmails: string[];
  otherEmails: string[];
}

export interface PublicInfo {
  appName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  setupRequired: boolean;
  /** Testbetrieb: Patchwork versendet nicht alle Mails */
  testMode: boolean;
  /** Testbetrieb: Empfängerkreise (beide «all» = normaler Betrieb) */
  delivery: { staff: DeliveryScope; others: DeliveryScope };
  /** Ablauf des HTTPS-Zertifikats, null ohne HTTPS */
  certificateExpiresAt: string | null;
}

/** Farben zur Auswahl für Status (siehe status-colors.ts) */
export type StatusColor = 'gray' | 'blue' | 'teal' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'brown';

export interface Status {
  id: string;
  type: ItemType;
  key: string;
  label: string;
  /** Abgeschlossen (Listen offen/abgeschlossen, Board, Portal, Auswertungen) */
  closed: boolean;
  /** Reihenfolge im Typ: Spalten des Boards und alle Auswahllisten */
  position: number;
  color: StatusColor;
  /** Lage im Ablaufdiagramm; null = automatisch */
  diagramX: number | null;
  diagramY: number | null;
}

/** Ablauf: pro Typ eingeschränkt (nur festgelegte Wechsel von Hand) oder frei */
export interface StatusFlow {
  restrict: Record<ItemType, boolean>;
  transitions: { fromId: string; toId: string }[];
}

/**
 * Ziel-Status je Typ (automatische Wechsel): start «Neuer Vorgang erhält», reply «Antwort des Melders führt in»,
 * close «Automatisch schliessen in», reject «Ablehnen führt in» (freiwillig), waiting «Wartet auf den Melder» (freiwillig)
 */
export type StatusTarget = 'start' | 'reply' | 'close' | 'reject' | 'waiting';
export type StatusTargets = Partial<Record<StatusTarget, string>>;
export type StatusTargetsByType = Record<ItemType, StatusTargets>;

/** Symbole für Meldewege (siehe ChannelIcon.vue) */
export type ChannelIcon = 'mail' | 'portal' | 'phone' | 'mobile' | 'person' | 'chat' | 'video' | 'letter' | 'alert' | 'other';

/** Meldeweg eines Vorgangs; «key» mail bzw. portal setzt Patchwork selbst */
export interface Channel {
  id: string;
  key: 'mail' | 'portal' | null;
  label: string;
  icon: ChannelIcon;
  position: number;
}

export interface StatusRef {
  id: string;
  label: string;
  closed: boolean;
  color: StatusColor;
}

export interface ItemSummary {
  id: string;
  number: number;
  type: ItemType | null;
  title: string;
  priority: Priority;
  source: 'mail' | 'portal' | 'internal';
  /** Meldeweg (siehe session.channelById), null = ohne Angabe */
  channelId: string | null;
  discarded: boolean;
  boardPosition: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  status: StatusRef | null;
  reporter: User;
  assignee: Pick<User, 'id' | 'name' | 'firstName' | 'lastName'> | null;
  /** Typ-Vorschlag des Melders aus dem Portal */
  suggestedType: ItemType | null;
  /** Fälligkeitsdatum JJJJ-MM-TT (nur Aufgaben) */
  dueDate: string | null;
  /** Anfang der Beschreibung (Markdown), null = keine Beschreibung */
  descriptionPreview: string | null;
  /** Öffentliche Antworten und interne Notizen, ohne automatische */
  commentCount: number;
  /** Fortschritt der Checklisten (nur Aufgaben mit Checklisten) */
  checklist: { done: number; total: number } | null;
}

/** Meldeweg, der beim internen Erfassen je Typ vorbelegt ist (Id), null = keiner */
export interface ChannelDefaults {
  incident: string | null;
  task: string | null;
}

export type LinkRole = 'relates' | 'fixes' | 'fixedBy' | 'duplicateOf' | 'hasDuplicate';

export interface ItemLink {
  id: string;
  role: LinkRole;
  createdAt: string;
  other: {
    id: string;
    number: number;
    title: string;
    type: ItemType | null;
    status: { label: string; closed: boolean; color: StatusColor } | null;
  };
}

export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}

export interface Checklist {
  id: string;
  title: string;
  items: ChecklistEntry[];
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  items: string[];
}

/**
 * Status, wie ihn der Melder im Portal sieht: interner Name mit Farbe, im Eingang «Eingegangen». «waiting»: Status
 * «Wartet auf den Melder» seines Typs (hervorgehoben).
 */
export interface PortalStatus {
  label: string;
  color: StatusColor;
  closed: boolean;
  waiting: boolean;
}

export interface PortalItemSummary {
  number: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  status: PortalStatus;
}

export interface PortalItemDetail {
  number: number;
  title: string;
  /** Vorgang wurde als Duplikat geschlossen; «accessible»: Original ist ebenfalls eigener Vorgang */
  duplicateOf: { number: number; title: string; accessible: boolean } | null;
  description: string;
  descriptionHtml: string | null;
  /** Im Testbetrieb aus einer simulierten Mail entstanden */
  simulated: boolean;
  createdAt: string;
  closedAt: string | null;
  status: PortalStatus;
  attachments: Attachment[];
  entries: {
    id: string;
    kind: 'reply' | 'rejected';
    author: string;
    own: boolean;
    simulated: boolean;
    body: string;
    bodyHtml: string | null;
    createdAt: string;
    attachments: Attachment[];
  }[];
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface Entry {
  id: string;
  kind: 'reply' | 'note' | 'status' | 'type' | 'change';
  body: string;
  bodyHtml: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /** Eigene interne Notizen lassen sich kurz nach dem Erfassen bearbeiten */
  editedAt: string | null;
  author: User | null;
  originalMessageId: string | null;
  /** Versand einer öffentlichen Antwort, nur bei Abweichungen (sonst null = normal versendet) */
  delivery: {
    status: Exclude<OutgoingStatus, 'sent'>;
    deliveredTo: string[];
    withheld: string[];
    error: string | null;
  } | null;
  /** Die versendete Mail einer öffentlichen Antwort (null = keine Mail, z.B. ohne Empfänger) */
  mailId: string | null;
  attachments: Attachment[];
}

export interface MailRecipient {
  email: string;
  /** Name des Benutzers, null = Adresse ohne Benutzer */
  name: string | null;
}

/** Automatische Mail an Melder und Beteiligte im Verlauf eines Vorgangs */
export interface ItemMail {
  id: string;
  template: string;
  /** Art der Mail, z.B. «Erledigt» */
  label: string;
  createdAt: string;
  status: OutgoingStatus;
  to: MailRecipient[];
  cc: MailRecipient[];
  /** An diese Adressen ging die Mail tatsächlich (Testbetrieb) */
  deliveredTo: string[];
  error: string | null;
}

/** Von Patchwork zu einem Vorgang versendete Mail zum Anschauen */
export interface SentMail {
  id: string;
  /** Art der Mail, z.B. «Erledigt» oder «Öffentliche Antwort» */
  label: string;
  createdAt: string;
  sentAt: string | null;
  status: OutgoingStatus;
  fromAddress: string;
  to: string[];
  cc: string[];
  deliveredTo: string[];
  subject: string;
  error: string | null;
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

export interface ItemDetail {
  id: string;
  number: number;
  type: ItemType | null;
  title: string;
  description: string;
  descriptionHtml: string | null;
  priority: Priority;
  /** Fälligkeitsdatum JJJJ-MM-TT (nur Aufgaben) */
  dueDate: string | null;
  source: 'mail' | 'portal' | 'internal';
  /** Meldeweg, null = ohne Angabe */
  channel: { id: string; label: string; icon: ChannelIcon } | null;
  suggestedType: ItemType | null;
  /** Im Testbetrieb aus einer simulierten Mail entstanden */
  simulated: boolean;
  discarded: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  status: StatusRef | null;
  reporter: User;
  creator: User;
  links: ItemLink[];
  checklists: Checklist[];
  assignee: User | null;
  mailbox: { id: string; name: string; address: string } | null;
  muted: boolean;
  originalMessageId: string | null;
  participants: User[];
  attachments: Attachment[];
  entries: Entry[];
  /** Automatische Mails an Melder und Beteiligte, älteste zuerst */
  mails: ItemMail[];
}

export interface Counts {
  inbox: number;
  incidents: number;
  tasks: number;
}

export interface MailboxOption {
  id: string;
  name: string;
  address: string;
  isDefault: boolean;
}

export interface Mailbox {
  id: string;
  name: string;
  address: string;
  active: boolean;
  isDefault: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapFolder: string;
  /** Microsoft Graph: ID des gewählten Ordners, null = Posteingang */
  graphFolderId: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'none';
  /** microsoft = Anmeldung mit einem Microsoft-Konto, oauth2 = App-Zugriff (Client Credentials) */
  authType: 'password' | 'oauth2' | 'microsoft';
  username: string;
  oauthTokenUrl: string | null;
  oauthClientId: string | null;
  oauthScope: string | null;
  /** Mit Microsoft angemeldetes Konto */
  oauthAccount: string | null;
  microsoftConnected: boolean;
  hasPassword: boolean;
  hasClientSecret: boolean;
  /** Mails abholen ab diesem Eingang */
  fetchFrom: string;
  lastUid: number;
  lastPollAt: string | null;
  lastError: string | null;
}

/** E-Mail-Vorlage (Verwaltung → E-Mail-Vorlagen) */
export interface MailTemplate {
  key: string;
  /** An Melder und Beteiligte oder an IT-Mitarbeitende */
  group: 'reporter' | 'staff';
  label: string;
  description: string;
  /** Fusszeile: einfacher Text ohne Formatierung */
  plain: boolean;
  placeholders: { name: string; description: string; example: string }[];
  defaultSubject: string | null;
  defaultBody: string | null;
  /** null = ohne Betreff (Link-Zeile, Fusszeile) */
  subject: string | null;
  /** null = den Text schreibt der Bearbeiter (öffentliche Antwort) */
  body: string | null;
  /** Vom Standard abweichend gespeichert */
  custom: boolean;
}

/** Angaben zu einem Zertifikat */
export interface CertificateInfo {
  names: string[];
  issuer: string;
  validFrom: string;
  validTo: string;
}

/** HTTPS: Zertifikat und offene Anforderung (Verwaltung → HTTPS) */
export interface TlsStatus {
  active: boolean;
  httpsPort: number;
  publicUrl: string;
  /** http:// leitet auf https:// um */
  redirects: boolean;
  error: string | null;
  certificate: (CertificateInfo & { daysLeft: number }) | null;
  pending: { names: string[]; createdAt: string; csr: string } | null;
  suggestedNames: string[];
}

/** Ordner eines Postfachs zur Auswahl für den Abruf */
export interface MailFolder {
  /** Microsoft Graph: ID des Ordners; IMAP: null */
  id: string | null;
  /** Gespeicherter Pfad (IMAP-Pfad bzw. Anzeigenamen mit «/») */
  path: string;
  /** Ordnernamen von oben nach unten */
  names: string[];
  inbox: boolean;
}

/**
 * Status einer ausgehenden Mail: queued = wird versendet, sent = an alle, partial = im Testbetrieb nur an einen Teil,
 * held = im Testbetrieb an niemanden, failed = Versand fehlgeschlagen
 */
export type OutgoingStatus = 'queued' | 'sent' | 'partial' | 'held' | 'failed';

/** Ausgehende Mail im Protokoll */
export interface OutgoingMail {
  id: string;
  createdAt: string;
  sentAt: string | null;
  status: OutgoingStatus;
  fromAddress: string;
  to: string[];
  cc: string[];
  /** An diese Empfänger ging die Mail tatsächlich */
  deliveredTo: string[];
  subject: string;
  automated: boolean;
  error: string | null;
  attempts: number;
  /** Öffentliche Antwort aus der Timeline (sonst Bestätigung oder Benachrichtigung) */
  reply: boolean;
  item: { number: number; title: string };
}

export interface OutgoingMailDetail extends OutgoingMail {
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

/** Wer das Portal nutzen darf: niemand, ausgewählte (Personen und Mitglieder der AD-Gruppe) oder alle */
export interface PortalSettings {
  access: 'none' | 'selected' | 'all';
  emails: string[];
  groupDn: string;
}

/** Gespeicherte Mail zum Anschauen (z.B. Originalmail einer Nachricht) */
export interface MailView {
  headers: { from: string; to: string[]; cc: string[]; subject: string; date: string | null };
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

/**
 * Ergebnis einer eingehenden Mail: neuer Vorgang, Antwort, interne Notiz (Absender nicht beteiligt), automatische
 * Antwort, ignoriert (Grund in «reason») oder Fehler (Meldung in «reason»).
 */
export type IncomingResult = 'created' | 'reply' | 'note' | 'automated' | 'ignored' | 'failed';

export interface IncomingMail {
  id: string;
  /** Abgeholt bzw. simuliert */
  createdAt: string;
  processedAt: string | null;
  /** Datum laut Mail */
  mailDate: string | null;
  mailbox: { id: string; name: string; address: string } | null;
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  result: IncomingResult;
  reason: string | null;
  attempts: number;
  simulated: boolean;
  /** Name des Admins, der die Mail simuliert hat */
  simulatedBy: string | null;
  item: { number: number; title: string } | null;
}

export interface IncomingMailDetail extends IncomingMail {
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

export interface LdapCheck {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  /** Originalmeldung des Servers */
  detail?: string;
  /** Gruppen des Testbenutzers (DNs) */
  groups?: string[];
}

export interface LdapSettings {
  enabled: boolean;
  url: string;
  startTls: boolean;
  rejectUnauthorized: boolean;
  caCertificate: string;
  caInfo: { subject: string; issuer: string; validTo: string } | null;
  bindDn: string;
  baseDn: string;
  userFilter: string;
  nameAttribute: string;
  mailAttribute: string;
  adminGroupDn: string;
  itGroupDn: string;
  nestedGroups: boolean;
  hasBindPassword: boolean;
}

// ---------------------------------------------------------------- Etappe 3

export type RuleTrigger = 'mail_new' | 'portal_new' | 'mail_reply' | 'portal_reply';
/** Zeitgesteuerte Regel: Status (offen, beide Typen) und/oder «Wartet auf den Melder» */
export interface RuleSchedule {
  days: number;
  statusIds: string[];
  waiting: boolean;
}
export type ConditionField = 'sender' | 'subject' | 'body' | 'mailbox' | 'adGroup';
export type ConditionOperator = 'is' | 'isNot' | 'domain' | 'notDomain' | 'contains' | 'notContains' | 'member' | 'notMember';

export interface RuleCondition {
  kind: 'condition';
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

export interface RuleGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: (RuleCondition | RuleGroup)[];
}

export interface RuleActions {
  type?: ItemType;
  priority?: Priority;
  assigneeId?: string;
  checklistTemplateId?: string;
  suppressConfirmation?: boolean;
  discard?: boolean;
  /** Zeitgesteuert, nur «Wartet auf den Melder» allein */
  remindReporter?: boolean;
  close?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  active: boolean;
  position: number;
  /** Ereignisse; leer bei zeitgesteuerten Regeln */
  triggers: RuleTrigger[];
  /**
   * Zeitgesteuert: seit «days» Tagen in einem der Status «statusIds» (offene Status beider Typen) oder, mit
   * «waiting», im Status «Wartet auf den Melder» des Typs
   */
  schedule: RuleSchedule | null;
  conditions: RuleGroup;
  actions: RuleActions;
}

export interface RulePreviewHit {
  number: number;
  title: string;
  kind: 'new' | 'reply' | 'due';
  sender: string;
  at: string;
}

export interface Snippet {
  id: string;
  name: string;
  body: string;
}

export interface Report {
  totals: { created: number; closed: number; openNow: number };
  flow: { start: string; created: { incident: number; task: number; inbox: number }; closed: { incident: number; task: number } }[];
  open: {
    inbox: number;
    byStatus: { type: ItemType; label: string; closed: boolean; count: number }[];
    byPriority: { priority: Priority; count: number }[];
    byAssignee: { name: string | null; count: number }[];
  };
  oldest: {
    total: number;
    items: { number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: string }[];
  };
  resolution: { count: number; medianHours: number | null; averageHours: number | null };
  topReporters: { name: string; email: string; count: number }[];
  /** Neue Vorgänge im Zeitraum nach Meldeweg; label null = ohne Angabe */
  byChannel: { label: string | null; icon: ChannelIcon | null; count: number }[];
}
