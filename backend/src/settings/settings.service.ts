import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { settings, type ItemType } from '../db/schema';
import type { TemplateKey } from '../mail/mail-templates';
import type { AreaSettings } from './areas';

export interface GeneralSettings {
  appName: string;
}

export interface LogoSettings {
  storageKey: string;
  contentType: string;
}

export interface LdapSettings {
  enabled: boolean;
  /** z.B. ldap://dc01.firma.local (mit STARTTLS) oder ldaps://dc01.firma.local */
  url: string;
  startTls: boolean;
  rejectUnauthorized: boolean;
  /** Zertifikat der (internen) Zertifizierungsstelle im PEM-Format, leer = Standard-Zertifikate */
  caCertificate: string;
  bindDn: string;
  bindPasswordEnc: string | null;
  baseDn: string;
  /** {{username}} wird durch den eingegebenen Benutzernamen ersetzt. */
  userFilter: string;
  nameAttribute: string;
  mailAttribute: string;
  adminGroupDn: string;
  itGroupDn: string;
  /** Verschachtelte Gruppen über die AD-Regel LDAP_MATCHING_RULE_IN_CHAIN auflösen. */
  nestedGroups: boolean;
}

export const DEFAULT_LDAP: LdapSettings = {
  enabled: false,
  url: '',
  startTls: false,
  rejectUnauthorized: true,
  caCertificate: '',
  bindDn: '',
  bindPasswordEnc: null,
  baseDn: '',
  // objectCategory=person schliesst Computerkonten aus (die in AD ebenfalls objectClass=user haben)
  userFilter:
    '(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
  nameAttribute: 'displayName',
  mailAttribute: 'mail',
  adminGroupDn: '',
  itGroupDn: '',
  nestedGroups: true,
};

/** Testbetrieb: Wer Mails tatsächlich erhält – niemand, nur ausgewählte oder alle. */
export type DeliveryScope = 'none' | 'selected' | 'all';

/**
 * Testbetrieb eines Blocks: Mails an Empfänger ausserhalb der Kreise werden fertig zusammengestellt und abgelegt, aber
 * nicht versendet. Beide Kreise auf «all» ist der normale Betrieb.
 */
export interface DeliveryCircles {
  /** IT-Mitarbeitende (Rolle IT oder Admin) */
  staff: DeliveryScope;
  /** Melder, Beteiligte und alle übrigen Empfänger */
  others: DeliveryScope;
  /** Ausgewählte IT-Mitarbeitende (E-Mail-Adressen, klein geschrieben) */
  staffEmails: string[];
  /** Ausgewählte Melder, Beteiligte und Kunden (E-Mail-Adressen, klein geschrieben) */
  otherEmails: string[];
  /**
   * Abweichend je Auslöser (Entscheid vom 30.10.2026): gilt für beide Kreise, «selected» mit den ausgewählten Personen
   * des Blocks. Fehlt ein Auslöser (auch in älteren Einstellungen ohne das Feld), gelten die Kreise des Blocks.
   */
  triggers?: Partial<Record<DeliveryTrigger, DeliveryScope>>;
}

/** Auslöser im Testbetrieb: die Mails mit eigener Vorlage, ohne Link- und Fusszeilen */
export type DeliveryTrigger = Exclude<TemplateKey, 'reporterLink' | 'reporterFooter' | 'staffLink' | 'staffFooter'>;

/**
 * Blöcke des Testbetriebs je Typ des Vorgangs (Entscheid vom 28.10.2026). «general» gilt für Vorgänge ohne Typ
 * (Eingang) und Mails ohne Vorgang (Willkommen).
 */
export const DELIVERY_BLOCKS = ['general', 'incident', 'task'] as const;
export type DeliveryBlock = (typeof DELIVERY_BLOCKS)[number];

const TYPED_TRIGGERS: DeliveryTrigger[] = [
  'confirmation',
  'reply',
  'done',
  'rejected',
  'duplicateMerged',
  'duplicateRedirected',
  'waitingReminder',
  'waitingClosed',
  'assigned',
  'inboundReply',
  'fixCompleted',
  'mentioned',
];

/**
 * Auslöser, die im Block vorkommen: Abschliessen, Ablehnen und Erinnerungen brauchen einen Status und damit einen Typ,
 * «Fällig» gibt es nur bei Aufgaben, «Willkommen» ist eine Mail ohne Vorgang.
 */
export const BLOCK_TRIGGERS: Record<DeliveryBlock, readonly DeliveryTrigger[]> = {
  general: ['confirmation', 'reply', 'duplicateMerged', 'duplicateRedirected', 'assigned', 'inboundReply', 'fixCompleted', 'mentioned', 'welcome'],
  incident: TYPED_TRIGGERS,
  task: [...TYPED_TRIGGERS, 'dueReminder'],
};
export type MailSettings = Record<DeliveryBlock, DeliveryCircles>;

const LIVE: DeliveryCircles = { staff: 'all', others: 'all', staffEmails: [], otherEmails: [] };

/**
 * Portal: wer es nutzen darf. «selected»: die ausgewählten Personen und die Mitglieder der AD-Gruppe.
 * IT und Admins sind nicht betroffen.
 */
export interface PortalSettings {
  access: 'none' | 'selected' | 'all';
  /** Ausgewählte Personen (E-Mail-Adressen, klein geschrieben) */
  emails: string[];
  /** DN der AD-Gruppe, leer = keine */
  groupDn: string;
}

/** Ablauf der Status: eingeschränkt = nur die festgelegten Wechsel von Hand (pro Typ) */
export interface StatusFlowSettings {
  restrict: { incident: boolean; task: boolean };
}

export interface MicrosoftSettings {
  /** Anwendungs-ID (Client-ID) der App-Registrierung in Entra ID für die Anmeldung von Postfächern */
  clientId: string;
}

/** E-Mail-Vorlagen: angepasste Betreffs und Texte pro Vorlage; fehlt ein Eintrag, gilt der Standard. */
export type MailTemplateOverrides = Record<string, { subject?: string; body?: string }>;

/** Vor- und Nachname: wann bestehende Kontakte einmalig im AD nachgeschlagen wurden (null = noch nicht) */
export interface UserNamesSettings {
  directorySyncedAt: string | null;
}

/** Meldeweg, der beim internen Erfassen je Typ vorbelegt ist (Id), null = keiner */
export interface ChannelDefaults {
  incident: string | null;
  task: string | null;
}

/** Übersicht über die Werte in HelpSpot, Grundlage der Zuordnungen auf der Seite «HelpSpot-Import» */
export interface HelpSpotAnalysis {
  at: string;
  total: number;
  /** Status mit offen/geschlossen und Anzahl Tickets */
  statuses: { status: string; open: boolean; count: number }[];
  /** Werte des Felds «Type» ('' = leer) */
  types: { value: string; count: number }[];
  /** Werte von «Eröffnet über» */
  openedVia: { value: string; count: number }[];
}

/** Import aus HelpSpot (Entscheid vom 29.10.2026) */
export interface HelpSpotSettings {
  /** Adresse von HelpSpot ohne /api */
  url: string;
  /** API-Schlüssel, mit APP_SECRET verschlüsselt */
  apiKeyEnc: string | null;
  /** Wert des Felds «Type» → Typ in Patchwork ('' = leer); fehlende nach Vorschlag */
  types: Record<string, ItemType>;
  /** statusKey(Typ, Status, offen) → Status in Patchwork; fehlende nach Vorschlag */
  statuses: Record<string, string>;
  /** «Eröffnet über» → Meldeweg (null = keiner); fehlende nach Vorschlag */
  channels: Record<string, string | null>;
  analysis: HelpSpotAnalysis | null;
}

interface SettingsMap {
  general: GeneralSettings;
  channelDefaults: ChannelDefaults;
  logo: LogoSettings | null;
  ldap: LdapSettings;
  mail: MailSettings;
  portal: PortalSettings;
  statusFlow: StatusFlowSettings;
  microsoft: MicrosoftSettings;
  mailTemplates: MailTemplateOverrides;
  userNames: UserNamesSettings;
  areas: AreaSettings;
  helpspot: HelpSpotSettings;
}

const DEFAULTS: SettingsMap = {
  general: { appName: 'Patchwork' },
  // Nach der Einführung für beide Typen ohne Vorbelegung (Entscheid vom 21.10.2026)
  channelDefaults: { incident: null, task: null },
  logo: null,
  ldap: DEFAULT_LDAP,
  mail: { general: LIVE, incident: LIVE, task: LIVE },
  // Ohne Einstellung ist das Portal aus (Entscheid vom 20.10.2026)
  portal: { access: 'none', emails: [], groupDn: '' },
  // Solange kein Ablauf festgelegt ist, sind alle Wechsel erlaubt
  statusFlow: { restrict: { incident: false, task: false } },
  microsoft: { clientId: '' },
  mailTemplates: {},
  userNames: { directorySyncedAt: null },
  // Ohne Einstellung sieht die IT alle Bereiche (Entscheid vom 23.10.2026)
  areas: { it: ['inbox', 'incident', 'task'] },
  helpspot: { url: '', apiKeyEnc: null, types: {}, statuses: {}, channels: {}, analysis: null },
};

@Injectable()
export class SettingsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async get<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const fallback = DEFAULTS[key];
    if (!row) return fallback;
    if (fallback && typeof fallback === 'object' && row.value && typeof row.value === 'object') {
      return { ...fallback, ...(row.value as object) } as SettingsMap[K];
    }
    return row.value as SettingsMap[K];
  }

  async set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async remove(key: keyof SettingsMap): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
  }
}
