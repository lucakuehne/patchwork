import { Injectable, Logger } from '@nestjs/common';
import { Client, InvalidCredentialsError, NoSuchObjectError, SizeLimitExceededError, type Entry } from 'ldapts';
import { connect as netConnect, isIP } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { decryptSecret } from '../common/crypto';
import type { UserRole } from '../db/schema';
import type { LdapSettings } from '../settings/settings.service';
import { splitName } from '../users/user-names';
import {
  AD_ACCOUNT_STATE_CODES,
  adDataCode,
  describeNetworkError,
  domainFromDn,
  explainBindError,
  explainSearchError,
  explainTlsError,
  isWithin,
  windowsServerVersion,
  type Explained,
} from './ldap-errors';

/** Vor- und Nachname einer Person (Platzhalter in Mails und Textbausteinen). */
export interface PersonNames {
  firstName: string;
  lastName: string;
}

export interface LdapIdentity extends PersonNames {
  dn: string;
  name: string;
  email: string;
  role: UserRole;
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

/** Konto im Verzeichnis gefunden, aber gesperrt, deaktiviert, abgelaufen o.ä. */
export class LdapAccountStateError extends Error {}

/** Angaben aus dem RootDSE des Servers. */
interface DirectoryInfo {
  isAd: boolean;
  product: string;
  defaultNamingContext: string | null;
  namingContexts: string[];
}

/** Active Directory empfiehlt diesen Filter: Konto, UPN oder Mail. */
export const AD_USER_FILTER =
  '(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))';

/** Active Directory: nur Konten, die nicht deaktiviert sind */
const AD_ENABLED_ONLY = '(!(userAccountControl:1.2.840.113556.1.4.803:=2))';

/** Maskiert Werte für LDAP-Filter (RFC 4515). */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** Attribute für Vor- und Nachname, gleich in Active Directory und OpenLDAP (inetOrgPerson). */
const NAME_ATTRIBUTES = ['givenName', 'sn'];

/** Filter für das Konto zu einer E-Mail-Adresse: alle Konten, die der Benutzerfilter zulässt, bei AD nur aktive. */
export function mailFilter(
  cfg: Pick<LdapSettings, 'userFilter' | 'mailAttribute'>,
  email: string,
  isAd: boolean,
): string {
  const accounts = cfg.userFilter.split('{{username}}').join('*');
  return `(&${accounts}(${cfg.mailAttribute}=${escapeFilterValue(email.trim())})${isAd ? AD_ENABLED_ONLY : ''})`;
}

/**
 * Vor- und Nachname aus givenName und sn. Fehlen beide (z.B. Dienstkonten), werden sie aus dem Anzeigenamen geschätzt,
 * ohne Anzeigenamen aus dem Teil der E-Mail-Adresse vor dem @ (siehe splitName).
 */
export function directoryNames(values: { givenName: string; sn: string; name: string; email: string }): PersonNames {
  const firstName = values.givenName.trim();
  const lastName = values.sn.trim();
  if (firstName || lastName) return { firstName, lastName };
  return splitName(values.name.trim() || values.email.split('@')[0]!);
}

/** Person aus dem Verzeichnis für die Auswahl als Melder oder Beteiligter. */
export interface DirectoryPerson {
  name: string;
  email: string;
  /** Anmeldename, z.B. sAMAccountName oder uid */
  username: string | null;
}

/** Attribute, über die man sich anmeldet (aus dem Benutzerfilter, z.B. sAMAccountName oder uid). */
export function loginAttributes(userFilter: string): string[] {
  const names = [...userFilter.matchAll(/\(\s*([A-Za-z][\w-]*)\s*=\s*\{\{username\}\}\s*\)/g)].map((m) => m[1]!);
  return [...new Set(names)];
}

/**
 * Filter für die Personensuche: alle Konten, die der Benutzerfilter zulässt, mit E-Mail-Adresse und
 * (bei Active Directory) nicht deaktiviert. Jedes Suchwort muss in Name, E-Mail oder Anmeldename vorkommen.
 */
export function peopleFilter(
  cfg: Pick<LdapSettings, 'userFilter' | 'nameAttribute' | 'mailAttribute'>,
  words: string[],
  isAd: boolean,
): string {
  const accounts = cfg.userFilter.split('{{username}}').join('*');
  const attributes = [...new Set([cfg.nameAttribute, cfg.mailAttribute, ...loginAttributes(cfg.userFilter)])];
  const matches = words.map((w) => `(|${attributes.map((a) => `(${a}=*${escapeFilterValue(w)}*)`).join('')})`).join('');
  const enabled = isAd ? AD_ENABLED_ONLY : '';
  return `(&${accounts}(${cfg.mailAttribute}=*)${enabled}${matches})`;
}

export function parseLdapUrl(url: string): { host: string; port: number; tls: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Ungültige Server-URL. Beispiel: ldap://dc01.firma.local');
  }
  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (protocol !== 'ldap' && protocol !== 'ldaps') throw new Error('Die URL muss mit ldap:// oder ldaps:// beginnen.');
  if (!parsed.hostname) throw new Error('In der Server-URL fehlt der Servername.');
  const tls = protocol === 'ldaps';
  return { host: parsed.hostname.replace(/^\[|\]$/g, ''), port: parsed.port ? Number(parsed.port) : tls ? 636 : 389, tls };
}

function firstValue(entry: Entry, attribute: string): string {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  if (!key) return '';
  const value = entry[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? '' : first.toString();
}

function allValues(entry: Entry, attribute: string): string[] {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  if (!key) return [];
  const value = entry[key];
  return (Array.isArray(value) ? value : [value]).map((v) => v.toString());
}

const sameDn = (a: string, b: string) => a.replace(/\s*,\s*/g, ',').toLowerCase() === b.replace(/\s*,\s*/g, ',').toLowerCase();

/** Name, Vor- und Nachname eines Kontos im Verzeichnis; ohne Anzeigenamen gilt die E-Mail-Adresse als Name. */
function namesOf(entry: Entry, cfg: LdapSettings, email: string): PersonNames & { name: string } {
  const name = firstValue(entry, cfg.nameAttribute).trim();
  return {
    name: name || email,
    ...directoryNames({ givenName: firstValue(entry, 'givenName'), sn: firstValue(entry, 'sn'), name, email }),
  };
}

/** Attribute ohne doppelte Einträge (z.B. wenn givenName als Attribut für den Namen eingestellt ist). */
const uniqueAttributes = (...attributes: string[]) => [...new Map(attributes.map((a) => [a.toLowerCase(), a])).values()];

/** TLS-Optionen für LDAPS bzw. STARTTLS: Zertifikatsprüfung, eigene CA, Servername. */
function tlsOptionsFor(cfg: LdapSettings, host: string): ConnectionOptions {
  return {
    rejectUnauthorized: cfg.rejectUnauthorized,
    ...(cfg.caCertificate?.trim() ? { ca: cfg.caCertificate } : {}),
    ...(isIP(host) ? {} : { servername: host }),
  };
}

/**
 * Baut einen LDAP-Client und schaltet bei Bedarf STARTTLS ein.
 * TLS-Optionen nur bei ldaps://, sonst würde ldapts auch für ldap:// TLS aufbauen.
 */
async function openClient(cfg: LdapSettings): Promise<Client> {
  const target = parseLdapUrl(cfg.url);
  const tlsOptions = tlsOptionsFor(cfg, target.host);
  const client = new Client({
    url: cfg.url.trim(),
    timeout: 10000,
    connectTimeout: 10000,
    ...(target.tls ? { tlsOptions } : {}),
  });
  if (cfg.startTls && !target.tls) await client.startTLS({ ...tlsOptions });
  return client;
}

/** Öffnet eine TCP- bzw. TLS-Verbindung, um die Erreichbarkeit zu prüfen. */
function probe(target: { host: string; port: number; tls: boolean }, tlsOptions: ConnectionOptions) {
  return new Promise<{ ok: boolean; protocol?: string; error?: unknown }>((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; protocol?: string; error?: unknown }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = target.tls
      ? tlsConnect({ host: target.host, port: target.port, ...tlsOptions }, () =>
          finish({ ok: true, protocol: (socket as TLSSocket).getProtocol() ?? 'TLS' }),
        )
      : netConnect({ host: target.host, port: target.port }, () => finish({ ok: true }));
    socket.setTimeout(8000, () => finish({ ok: false, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }));
    socket.on('error', (error) => finish({ ok: false, error }));
  });
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  /**
   * Prüft Benutzername und Passwort gegen das Verzeichnis.
   * Gibt null zurück, wenn der Benutzer nicht existiert oder das Passwort falsch ist.
   * Wirft LdapAccountStateError, wenn das Konto gesperrt, deaktiviert o.ä. ist.
   */
  async authenticate(cfg: LdapSettings, username: string, password: string): Promise<LdapIdentity | null> {
    if (!password) return null;
    const client = await openClient(cfg);
    try {
      await this.bindServiceAccount(client, cfg);
      const entry = await this.findUser(client, cfg, username);
      if (!entry) return null;

      const userClient = await openClient(cfg);
      try {
        await userClient.bind(entry.dn, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          const code = adDataCode(err.message);
          if (code && AD_ACCOUNT_STATE_CODES.includes(code)) {
            throw new LdapAccountStateError(explainBindError(err, { isAd: true, encrypted: true }).message);
          }
          return null;
        }
        throw err;
      } finally {
        await userClient.unbind().catch(() => undefined);
      }

      const email = firstValue(entry, cfg.mailAttribute).trim().toLowerCase();
      if (!email) {
        this.logger.warn(`LDAP-Benutzer ${entry.dn} hat kein Attribut ${cfg.mailAttribute}`);
        return null;
      }
      return {
        dn: entry.dn,
        email,
        ...namesOf(entry, cfg, email),
        role: await this.resolveRole(client, cfg, entry),
      };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Sucht Personen im Verzeichnis nach Name, E-Mail und Anmeldename (Auswahl von Melder und Beteiligten).
   * Höchstens «limit» Treffer; Konten ohne E-Mail-Adresse und deaktivierte AD-Konten fehlen.
   */
  async searchPeople(cfg: LdapSettings, query: string, limit = 10): Promise<DirectoryPerson[]> {
    const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    if (words.length === 0) return [];
    const usernameAttribute = loginAttributes(cfg.userFilter).find(
      (a) => a.toLowerCase() !== cfg.mailAttribute.toLowerCase(),
    );
    const client = await openClient(cfg);
    try {
      await this.bindServiceAccount(client, cfg);
      const isAd = (await this.readRootDse(client))?.isAd ?? false;
      const pages = client.searchPaginated(cfg.baseDn, {
        scope: 'sub',
        filter: peopleFilter(cfg, words, isAd),
        attributes: [cfg.nameAttribute, cfg.mailAttribute, ...(usernameAttribute ? [usernameAttribute] : [])],
        paged: { pageSize: limit },
      });
      // Die erste Seite genügt für die Auswahl
      for await (const page of pages) {
        return page.searchEntries
          .map((entry) => {
            const email = firstValue(entry, cfg.mailAttribute).trim().toLowerCase();
            return {
              email,
              name: firstValue(entry, cfg.nameAttribute).trim() || email,
              username: (usernameAttribute && firstValue(entry, usernameAttribute)) || null,
            };
          })
          .filter((p) => p.email)
          .slice(0, limit);
      }
      return [];
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Konto zu einer E-Mail-Adresse mit der Rolle aus den AD-Gruppen, wie bei der Anmeldung, aber ohne Passwort
   * (Benutzer vorab anlegen, Rolle «Aus AD-Gruppen»). null = nicht gefunden, nicht eindeutig oder deaktiviert.
   */
  async lookupPerson(cfg: LdapSettings, email: string): Promise<LdapIdentity | null> {
    const client = await openClient(cfg);
    try {
      await this.bindServiceAccount(client, cfg);
      const isAd = (await this.readRootDse(client))?.isAd ?? false;
      const attributes = uniqueAttributes('dn', cfg.nameAttribute, cfg.mailAttribute, 'memberOf', ...NAME_ATTRIBUTES);
      const { entries, more } = await this.searchLimited(client, cfg.baseDn, mailFilter(cfg, email, isAd), attributes, 1);
      const entry = entries[0];
      if (!entry || more) return null;
      const found = firstValue(entry, cfg.mailAttribute).trim().toLowerCase();
      return {
        dn: entry.dn,
        email: found,
        ...namesOf(entry, cfg, found),
        role: await this.resolveRole(client, cfg, entry),
      };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Vor- und Nachname zu E-Mail-Adressen (neue Kontakte aus Mails), eine Verbindung für alle Adressen. Adressen ohne
   * eindeutiges Konto (bei Active Directory ohne aktives Konto) fehlen im Ergebnis. Schlüssel in Kleinbuchstaben.
   */
  async lookupNames(cfg: LdapSettings, emails: string[]): Promise<Map<string, PersonNames>> {
    const names = new Map<string, PersonNames>();
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0) return names;
    const client = await openClient(cfg);
    try {
      await this.bindServiceAccount(client, cfg);
      const isAd = (await this.readRootDse(client))?.isAd ?? false;
      const attributes = uniqueAttributes(cfg.nameAttribute, cfg.mailAttribute, ...NAME_ATTRIBUTES);
      for (const email of wanted) {
        const { entries, more } = await this.searchLimited(client, cfg.baseDn, mailFilter(cfg, email, isAd), attributes, 1);
        const entry = entries[0];
        if (!entry || more) continue;
        const { firstName, lastName } = namesOf(entry, cfg, email);
        names.set(email, { firstName, lastName });
      }
      return names;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Prüft Gruppenmitgliedschaften per E-Mail-Adresse (Regel-Bedingung «Absender ist in AD-Gruppe»).
   * Eine Verbindung pro Prüflauf, Ergebnisse werden zwischengespeichert. Ergebnis null = unbekannt
   * (LDAP ausgeschaltet oder nicht erreichbar); ohne Konto im Verzeichnis ist niemand Mitglied.
   */
  groupChecker(cfg: LdapSettings): { check: (email: string, groupDn: string) => Promise<boolean | null>; close: () => Promise<void> } {
    let client: Promise<Client> | null = null;
    const results = new Map<string, Promise<boolean | null>>();
    const accounts = new Map<string, Promise<Entry | null>>();
    const connect = () =>
      (client ??= (async () => {
        const c = await openClient(cfg);
        await this.bindServiceAccount(c, cfg);
        return c;
      })());
    const account = (email: string) => {
      let found = accounts.get(email);
      if (!found) {
        found = (async () => {
          const filter = `(&${cfg.userFilter.split('{{username}}').join('*')}(${cfg.mailAttribute}=${escapeFilterValue(email)}))`;
          const { searchEntries } = await (await connect()).search(cfg.baseDn, {
            scope: 'sub',
            filter,
            sizeLimit: 2,
            attributes: ['dn', 'memberOf'],
          });
          return searchEntries.length === 1 ? searchEntries[0]! : null;
        })();
        accounts.set(email, found);
      }
      return found;
    };
    return {
      check: (email, groupDn) => {
        const key = `${email.toLowerCase()}|${groupDn.toLowerCase()}`;
        let result = results.get(key);
        if (!result) {
          result = (async () => {
            if (!cfg.enabled || !cfg.url) return null;
            try {
              const entry = await account(email.toLowerCase());
              if (!entry) return false;
              return await this.isMember(await connect(), cfg, entry, groupDn);
            } catch (err) {
              this.logger.warn(`Gruppenprüfung für ${email} fehlgeschlagen: ${this.explain(err)}`);
              return null;
            }
          })();
          results.set(key, result);
        }
        return result;
      },
      close: async () => {
        if (!client) return;
        const c = await client.catch(() => null);
        await c?.unbind().catch(() => undefined);
      },
    };
  }

  /** Verständliche Beschreibung eines Fehlers bei der Anmeldung über LDAP (für das Protokoll). */
  explain(err: unknown): string {
    const e = err as { code?: unknown };
    const explained =
      typeof e.code === 'number' ? explainBindError(err, { isAd: false, encrypted: false }) : explainTlsError(err);
    return explained.detail ? `${explained.message} (${explained.detail})` : explained.message;
  }

  /**
   * Prüft die Einstellungen Schritt für Schritt: Server, Verschlüsselung, Verzeichnis,
   * Dienstkonto, Basis-DN, Benutzerfilter, Gruppen und optional einen Testbenutzer.
   * Schlägt ein Schritt fehl, werden die davon abhängigen übersprungen.
   */
  async diagnose(cfg: LdapSettings, username?: string, password?: string): Promise<LdapCheck[]> {
    const checks: LdapCheck[] = [];
    const add = (key: string, label: string, status: LdapCheck['status'], message: string, detail?: string) =>
      checks.push({ key, label, status, message, ...(detail ? { detail } : {}) });
    const addExplained = (key: string, label: string, status: LdapCheck['status'], explained: Explained) =>
      add(key, label, status, explained.message, explained.detail);
    const STEPS: [string, string][] = [
      ['server', 'Server'],
      ['tls', 'Verschlüsselung'],
      ['directory', 'Verzeichnis'],
      ['bind', 'Dienstkonto'],
      ['base', 'Basis-DN'],
      ['filter', 'Benutzerfilter'],
      ['adminGroup', 'Gruppe Admin'],
      ['itGroup', 'Gruppe IT'],
    ];
    const skipFrom = (key: string) => {
      const index = STEPS.findIndex(([k]) => k === key);
      for (const [k, l] of STEPS.slice(index)) {
        if (!checks.some((c) => c.key === k)) add(k, l, 'skipped', 'Übersprungen, weil ein vorheriger Schritt fehlschlug.');
      }
      return checks;
    };

    // 0. Ist die Anmeldung über LDAP überhaupt eingeschaltet? (Der Test läuft auch ohne.)
    if (!cfg.enabled) {
      add(
        'enabled',
        'LDAP-Anmeldung',
        'warning',
        'Ausgeschaltet. AD-Benutzer können sich erst anmelden, wenn «LDAP-Anmeldung aktivieren» gesetzt und gespeichert ist.',
      );
    }

    // 1. Server
    let target: { host: string; port: number; tls: boolean };
    try {
      target = parseLdapUrl(cfg.url);
    } catch (err) {
      add('server', 'Server', 'error', (err as Error).message);
      return skipFrom('tls');
    }
    if (target.tls && cfg.startTls) {
      add('server', 'Server', 'error', 'STARTTLS ist nur mit ldap:// möglich. Bei ldaps:// ist die Verbindung bereits verschlüsselt.');
      return skipFrom('tls');
    }
    const tlsOptions = tlsOptionsFor(cfg, target.host);
    const reach = await probe(target, tlsOptions);
    if (!reach.ok) {
      if (target.tls) {
        add('server', 'Server', 'ok', `${target.host}:${target.port} antwortet.`);
        addExplained('tls', 'Verschlüsselung', 'error', explainTlsError(reach.error));
        return skipFrom('directory');
      }
      add(
        'server',
        'Server',
        'error',
        `${target.host}:${target.port} nicht erreichbar: ${describeNetworkError(reach.error) ?? (reach.error as Error).message}`,
      );
      return skipFrom('tls');
    }
    add('server', 'Server', 'ok', `${target.host}:${target.port} erreichbar.`);

    let client: Client;
    try {
      client = new Client({
        url: cfg.url.trim(),
        timeout: 10000,
        connectTimeout: 10000,
        ...(target.tls ? { tlsOptions } : {}),
      });
    } catch (err) {
      add('tls', 'Verschlüsselung', 'error', (err as Error).message);
      return skipFrom('directory');
    }

    try {
      // 2. Verschlüsselung
      const verified = cfg.rejectUnauthorized ? 'Zertifikat geprüft' : 'Zertifikat NICHT geprüft';
      let encrypted = target.tls;
      if (target.tls) {
        add('tls', 'Verschlüsselung', cfg.rejectUnauthorized ? 'ok' : 'warning', `LDAPS (${reach.protocol}), ${verified}.`);
      } else if (cfg.startTls) {
        try {
          await client.startTLS({ ...tlsOptions });
          encrypted = true;
          add('tls', 'Verschlüsselung', cfg.rejectUnauthorized ? 'ok' : 'warning', `STARTTLS aktiv, ${verified}.`);
        } catch (err) {
          addExplained('tls', 'Verschlüsselung', 'error', explainTlsError(err));
          return skipFrom('directory');
        }
      } else {
        add(
          'tls',
          'Verschlüsselung',
          'warning',
          'Unverschlüsselt: Passwörter gehen im Klartext übers Netz. Viele Domain Controller (Standard ab Windows Server 2025) lehnen solche Anmeldungen ab – dann STARTTLS aktivieren.',
        );
      }

      // 3. Verzeichnis (RootDSE, anonym lesbar)
      const info = await this.readRootDse(client);
      if (info) {
        const domain = info.defaultNamingContext ? domainFromDn(info.defaultNamingContext) : '';
        add(
          'directory',
          'Verzeichnis',
          'ok',
          `${info.product}${domain ? `, Domäne ${domain}` : ''}${info.defaultNamingContext ? ` (${info.defaultNamingContext})` : ''}.`,
        );
      } else {
        add('directory', 'Verzeichnis', 'warning', 'Serverinformationen (RootDSE) nicht lesbar. Der Test läuft trotzdem weiter.');
      }
      const isAd = info?.isAd ?? false;

      // 4. Dienstkonto
      if (!cfg.bindDn) {
        if (isAd) {
          add('bind', 'Dienstkonto', 'error', 'Active Directory erlaubt keine anonyme Suche. Bitte ein Dienstkonto angeben.');
          return skipFrom('base');
        }
        add('bind', 'Dienstkonto', 'warning', 'Kein Dienstkonto angegeben, die Suche erfolgt anonym.');
      } else if (!cfg.bindPasswordEnc) {
        add(
          'bind',
          'Dienstkonto',
          'error',
          'Kein Passwort für das Dienstkonto angegeben. Nach einer Änderung von Server-URL oder Bind-DN muss es neu eingegeben werden.',
        );
        return skipFrom('base');
      } else {
        try {
          await client.bind(cfg.bindDn, decryptSecret(cfg.bindPasswordEnc));
          add('bind', 'Dienstkonto', 'ok', `Anmeldung als «${cfg.bindDn}» erfolgreich.`);
        } catch (err) {
          addExplained('bind', 'Dienstkonto', 'error', explainBindError(err, { isAd, encrypted }));
          return skipFrom('base');
        }
      }

      // 5. Basis-DN
      if (!cfg.baseDn) {
        add(
          'base',
          'Basis-DN',
          'error',
          `Kein Basis-DN angegeben.${info?.defaultNamingContext ? ` Vorschlag: ${info.defaultNamingContext}` : ''}`,
        );
        return skipFrom('filter');
      }
      try {
        await client.search(cfg.baseDn, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
        add('base', 'Basis-DN', 'ok', `«${cfg.baseDn}» gefunden.`);
      } catch (err) {
        const explained = explainSearchError(err, { isAd });
        const suggestion =
          err instanceof NoSuchObjectError && info?.defaultNamingContext && !isWithin(cfg.baseDn, info.defaultNamingContext)
            ? ` Vorschlag: ${info.defaultNamingContext}`
            : '';
        add('base', 'Basis-DN', 'error', `«${cfg.baseDn}»: ${explained.message}${suggestion}`, explained.detail);
        return skipFrom('filter');
      }

      // 6. Benutzerfilter: wie viele Benutzer würden gefunden?
      const filterAll = cfg.userFilter.split('{{username}}').join('*');
      const adFilterHint =
        isAd && !/samaccountname|userprincipalname/i.test(cfg.userFilter)
          ? ` Für Active Directory passt die Vorlage «Active Directory».`
          : '';
      try {
        const sample = await this.searchLimited(client, cfg.baseDn, filterAll, [cfg.nameAttribute, cfg.mailAttribute], 5);
        if (sample.entries.length === 0 && sample.more) {
          add('filter', 'Benutzerfilter', 'ok', 'Mehr als 5 Benutzer gefunden.');
        } else if (sample.entries.length === 0) {
          add('filter', 'Benutzerfilter', 'warning', `Mit diesem Filter wird kein Benutzer gefunden.${adFilterHint}`);
        } else {
          const withMail = sample.entries.filter((e) => firstValue(e, cfg.mailAttribute)).length;
          const names = sample.entries.map((e) => firstValue(e, cfg.nameAttribute) || e.dn).join(', ');
          const count = sample.more ? `Mehr als ${sample.entries.length}` : String(sample.entries.length);
          // Konten ohne E-Mail (z.B. Administrator, krbtgt) sind normal. Warnung nur, wenn keines eine hat:
          // dann stimmt vermutlich das E-Mail-Attribut nicht.
          add(
            'filter',
            'Benutzerfilter',
            withMail === 0 ? 'warning' : 'ok',
            `${count} Benutzer gefunden, z.B. ${names}.` +
              (withMail === 0
                ? ` Keiner davon hat das Attribut «${cfg.mailAttribute}» – ohne E-Mail ist keine Anmeldung möglich. Attribut für die E-Mail prüfen.`
                : withMail < sample.entries.length
                  ? ` Hinweis: ${sample.entries.length - withMail} davon ohne «${cfg.mailAttribute}», diese können sich nicht anmelden.`
                  : ''),
          );
        }
      } catch (err) {
        addExplained('filter', 'Benutzerfilter', 'error', explainSearchError(err, { isAd }));
      }

      // 7. Gruppen
      for (const [key, label, dn] of [
        ['adminGroup', 'Gruppe Admin', cfg.adminGroupDn],
        ['itGroup', 'Gruppe IT', cfg.itGroupDn],
      ] as const) {
        if (!dn.trim()) {
          add(key, label, 'warning', 'Keine Gruppe angegeben, niemand erhält über LDAP diese Rolle.');
          continue;
        }
        try {
          await client.search(dn.trim(), { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
          add(key, label, 'ok', `«${dn.trim()}» gefunden.`);
        } catch (err) {
          const explained = explainSearchError(err, { isAd });
          add(key, label, 'error', `«${dn.trim()}»: ${explained.message}`, explained.detail);
        }
      }

      // 8. Testbenutzer
      if (username?.trim()) {
        let entry: Entry | null = null;
        try {
          entry = await this.findUser(client, cfg, username);
        } catch (err) {
          addExplained('user', 'Testbenutzer', 'error', explainSearchError(err, { isAd }));
        }
        if (!entry && !checks.some((c) => c.key === 'user')) {
          add('user', 'Testbenutzer', 'error', `«${username.trim()}» nicht gefunden oder nicht eindeutig.`);
        }
        if (entry) {
          const email = firstValue(entry, cfg.mailAttribute);
          const role = await this.resolveRole(client, cfg, entry);
          let status: LdapCheck['status'] = email ? 'ok' : 'error';
          let roleText: string;
          if (role === 'admin') {
            roleText = 'Rolle Admin.';
          } else if (role === 'it') {
            roleText = 'Rolle IT.';
          } else {
            if (email) status = 'warning';
            const groupsConfigured = !!(cfg.adminGroupDn.trim() || cfg.itGroupDn.trim());
            roleText = groupsConfigured
              ? `Rolle Standard: weder Mitglied der Admin- noch der IT-Gruppe${cfg.nestedGroups ? ' (auch nicht über verschachtelte Gruppen)' : ''}. Die Anmeldung führt ins Portal, nicht in die IT-Oberfläche.`
              : 'Rolle Standard: Es ist weder eine Admin- noch eine IT-Gruppe eingetragen. Ohne diese Gruppen erhält niemand über LDAP Zugang zur IT-Oberfläche, alle landen im Portal.';
          }
          checks.push({
            key: 'user',
            label: 'Testbenutzer',
            status,
            message:
              `${entry.dn} · Name «${firstValue(entry, cfg.nameAttribute) || '–'}» · E-Mail «${email || 'fehlt'}» · ${roleText}` +
              (email ? '' : ' Ohne E-Mail ist keine Anmeldung möglich.'),
            // Direkte Gruppen (ohne primäre Gruppe), damit sie als Admin- oder IT-Gruppe übernommen werden können
            groups: allValues(entry, 'memberOf').slice(0, 50),
          });
          if (password) {
            let userClient: Client | null = null;
            try {
              userClient = await openClient(cfg);
              await userClient.bind(entry.dn, password);
              add('login', 'Anmeldung Testbenutzer', 'ok', 'Passwort korrekt.');
            } catch (err) {
              addExplained('login', 'Anmeldung Testbenutzer', 'error', explainBindError(err, { isAd, encrypted }));
            } finally {
              await userClient?.unbind().catch(() => undefined);
            }
          }
        }
      }
      return checks;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private async bindServiceAccount(client: Client, cfg: LdapSettings) {
    if (cfg.bindDn) await client.bind(cfg.bindDn, cfg.bindPasswordEnc ? decryptSecret(cfg.bindPasswordEnc) : '');
  }

  /** Liest den RootDSE (anonym, auch bei Active Directory erlaubt). */
  private async readRootDse(client: Client): Promise<DirectoryInfo | null> {
    try {
      const { searchEntries } = await client.search('', {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: [
          'defaultNamingContext',
          'namingContexts',
          'supportedCapabilities',
          'domainControllerFunctionality',
          'vendorName',
          'vendorVersion',
        ],
      });
      const entry = searchEntries[0];
      if (!entry) return null;
      const isAd = allValues(entry, 'supportedCapabilities').includes('1.2.840.113556.1.4.800');
      const namingContexts = allValues(entry, 'namingContexts');
      const vendor = [firstValue(entry, 'vendorName'), firstValue(entry, 'vendorVersion')].filter(Boolean).join(' ');
      const windows = windowsServerVersion(firstValue(entry, 'domainControllerFunctionality'));
      return {
        isAd,
        product: isAd ? `Active Directory${windows ? ` (${windows})` : ''}` : vendor ? `LDAP-Server (${vendor})` : 'LDAP-Server',
        defaultNamingContext: firstValue(entry, 'defaultNamingContext') || namingContexts[0] || null,
        namingContexts,
      };
    } catch {
      return null;
    }
  }

  /** Suche mit Obergrenze. «more» = es gäbe weitere Treffer. */
  private async searchLimited(client: Client, base: string, filter: string, attributes: string[], limit: number) {
    try {
      const { searchEntries } = await client.search(base, { scope: 'sub', filter, sizeLimit: limit + 1, attributes });
      return { entries: searchEntries.slice(0, limit), more: searchEntries.length > limit };
    } catch (err) {
      if (err instanceof SizeLimitExceededError) {
        // Manche Server liefern bei Überschreitung keine Teilergebnisse
        return { entries: [] as Entry[], more: true };
      }
      throw err;
    }
  }

  private async findUser(client: Client, cfg: LdapSettings, username: string): Promise<Entry | null> {
    const filter = cfg.userFilter.split('{{username}}').join(escapeFilterValue(username.trim()));
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      sizeLimit: 2,
      attributes: uniqueAttributes('dn', cfg.nameAttribute, cfg.mailAttribute, 'memberOf', ...NAME_ATTRIBUTES),
    });
    if (searchEntries.length !== 1) return null;
    return searchEntries[0] ?? null;
  }

  private async resolveRole(client: Client, cfg: LdapSettings, entry: Entry): Promise<UserRole> {
    if (await this.isMember(client, cfg, entry, cfg.adminGroupDn)) return 'admin';
    if (await this.isMember(client, cfg, entry, cfg.itGroupDn)) return 'it';
    return 'standard';
  }

  private async isMember(client: Client, cfg: LdapSettings, entry: Entry, groupDn: string): Promise<boolean> {
    if (!groupDn.trim()) return false;
    if (allValues(entry, 'memberOf').some((g) => sameDn(g, groupDn))) return true;
    if (!cfg.nestedGroups) return false;
    const { searchEntries } = await client.search(entry.dn, {
      scope: 'base',
      filter: `(memberOf:1.2.840.113556.1.4.1941:=${escapeFilterValue(groupDn.trim())})`,
      attributes: ['dn'],
    });
    return searchEntries.length > 0;
  }
}
