import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { settings } from '../db/schema';

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

export interface MicrosoftSettings {
  /** Anwendungs-ID (Client-ID) der App-Registrierung in Entra ID für die Anmeldung von Postfächern */
  clientId: string;
}

interface SettingsMap {
  general: GeneralSettings;
  logo: LogoSettings | null;
  ldap: LdapSettings;
  mail: MailSettings;
  microsoft: MicrosoftSettings;
}

const DEFAULTS: SettingsMap = {
  general: { appName: 'Patchwork' },
  logo: null,
  ldap: DEFAULT_LDAP,
  mail: { staff: 'all', others: 'all', staffEmails: [], otherEmails: [] },
  microsoft: { clientId: '' },
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
