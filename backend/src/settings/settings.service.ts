import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { settings } from '../db/schema';
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
 * Testbetrieb: Mails an Empfänger ausserhalb der Kreise werden fertig zusammengestellt und abgelegt, aber nicht
 * versendet. Beide Kreise auf «all» ist der normale Betrieb.
 */
export interface MailSettings {
  /** IT-Mitarbeitende (Rolle IT oder Admin) */
  staff: DeliveryScope;
  /** Melder, Beteiligte und alle übrigen Empfänger */
  others: DeliveryScope;
  /** Ausgewählte IT-Mitarbeitende (E-Mail-Adressen, klein geschrieben) */
  staffEmails: string[];
  /** Ausgewählte Melder, Beteiligte und Kunden (E-Mail-Adressen, klein geschrieben) */
  otherEmails: string[];
}

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
}

const DEFAULTS: SettingsMap = {
  general: { appName: 'Patchwork' },
  // Nach der Einführung für beide Typen ohne Vorbelegung (Entscheid vom 21.10.2026)
  channelDefaults: { incident: null, task: null },
  logo: null,
  ldap: DEFAULT_LDAP,
  mail: { staff: 'all', others: 'all', staffEmails: [], otherEmails: [] },
  // Ohne Einstellung ist das Portal aus (Entscheid vom 20.10.2026)
  portal: { access: 'none', emails: [], groupDn: '' },
  // Solange kein Ablauf festgelegt ist, sind alle Wechsel erlaubt
  statusFlow: { restrict: { incident: false, task: false } },
  microsoft: { clientId: '' },
  mailTemplates: {},
  userNames: { directorySyncedAt: null },
  // Ohne Einstellung sieht die IT alle Bereiche (Entscheid vom 23.10.2026)
  areas: { it: ['inbox', 'incident', 'task'] },
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
