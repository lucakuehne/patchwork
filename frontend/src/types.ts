export type Role = 'admin' | 'it' | 'standard';
export type ItemType = 'incident' | 'task';
export type Priority = 'high' | 'normal' | 'low';
export type StatusCategory = 'new' | 'in_progress' | 'waiting' | 'done' | 'rejected';
export type View = 'inbox' | 'incidents' | 'incidents-closed' | 'board' | 'tasks-done' | 'tasks-rejected' | 'search';

export interface User {
  id: string;
  name: string;
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

export interface AdminUser extends User {
  authSource: 'local' | 'ldap' | 'oidc';
  active: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PublicInfo {
  appName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  setupRequired: boolean;
}

export interface Status {
  id: string;
  type: ItemType;
  key: string;
  label: string;
  category: StatusCategory;
  position: number;
}

export interface StatusRef {
  id: string;
  label: string;
  category: StatusCategory;
}

export interface ItemSummary {
  id: string;
  number: number;
  type: ItemType | null;
  title: string;
  priority: Priority;
  source: 'mail' | 'portal' | 'internal';
  discarded: boolean;
  boardPosition: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  status: StatusRef | null;
  reporter: User;
  assignee: { id: string; name: string } | null;
  /** Typ-Vorschlag des Melders aus dem Portal */
  suggestedType: ItemType | null;
  /** Fortschritt der Checklisten (nur Aufgaben mit Checklisten) */
  checklist: { done: number; total: number } | null;
}

export type LinkRole = 'relates' | 'fixes' | 'fixedBy' | 'duplicateOf' | 'hasDuplicate';

export interface ItemLink {
  id: string;
  role: LinkRole;
  createdAt: string;
  other: { id: string; number: number; title: string; type: ItemType | null; status: { label: string; category: StatusCategory } | null };
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

export interface PortalStatus {
  key: 'received' | 'in_progress' | 'waiting' | 'done' | 'rejected';
  label: string;
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
  createdAt: string;
  closedAt: string | null;
  status: PortalStatus;
  attachments: Attachment[];
  entries: {
    id: string;
    kind: 'reply' | 'rejected';
    author: string;
    own: boolean;
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
  attachments: Attachment[];
}

export interface ItemDetail {
  id: string;
  number: number;
  type: ItemType | null;
  title: string;
  description: string;
  descriptionHtml: string | null;
  priority: Priority;
  source: 'mail' | 'portal' | 'internal';
  suggestedType: ItemType | null;
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
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'none';
  authType: 'password' | 'oauth2';
  username: string;
  oauthTokenUrl: string | null;
  oauthClientId: string | null;
  oauthScope: string | null;
  hasPassword: boolean;
  hasClientSecret: boolean;
  lastUid: number;
  lastPollAt: string | null;
  lastError: string | null;
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
/** Zeitgesteuerte Regeln: Kategorien, für die eine Wartezeit gezählt wird */
export type ScheduleCategory = 'new' | 'in_progress' | 'waiting';
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
  /** Zeitgesteuert, nur «Wartend» */
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
  /** Zeitgesteuert: seit «days» Tagen in einem Status der Kategorie */
  schedule: { category: ScheduleCategory; days: number } | null;
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
    byStatus: { type: ItemType; label: string; category: StatusCategory; count: number }[];
    byPriority: { priority: Priority; count: number }[];
    byAssignee: { name: string | null; count: number }[];
  };
  oldest: {
    total: number;
    items: { number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: string }[];
  };
  resolution: { count: number; medianHours: number | null; averageHours: number | null };
  topReporters: { name: string; email: string; count: number }[];
}
