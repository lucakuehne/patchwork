/**
 * Übersetzt LDAP- und Active-Directory-Fehler in verständliche Meldungen.
 * Reine Funktionen ohne Netzwerkzugriff, damit sie testbar sind.
 */

export interface Explained {
  /** Verständliche Erklärung auf Deutsch */
  message: string;
  /** Originalmeldung des Servers bzw. der Bibliothek */
  detail?: string;
}

/** Unterklassen-Codes von Active Directory bei Anmeldefehlern («data 52e»). */
const AD_BIND_REASONS: Record<string, string> = {
  '525': 'Das Konto wurde nicht gefunden.',
  '52e': 'Benutzername bzw. DN oder Passwort ist falsch.',
  '530': 'Anmeldung zu dieser Uhrzeit nicht erlaubt (Anmeldezeiten des Kontos).',
  '531': 'Anmeldung von diesem Computer aus nicht erlaubt (Arbeitsstationen des Kontos).',
  '532': 'Das Passwort ist abgelaufen.',
  '533': 'Das Konto ist deaktiviert.',
  '568': 'Das Konto ist in zu vielen Gruppen (Token zu gross).',
  '701': 'Das Konto ist abgelaufen.',
  '773': 'Das Passwort muss beim nächsten Anmelden geändert werden.',
  '775': 'Das Konto ist gesperrt (zu viele Fehlversuche).',
};

/** AD-Fehlercodes, die auf einen Kontozustand hinweisen (nicht auf falsche Eingaben). */
export const AD_ACCOUNT_STATE_CODES = ['530', '531', '532', '533', '701', '773', '775'];

const BIND_NAME_FORMATS =
  'In Active Directory funktioniert z.B. «benutzer@domäne.local», «DOMÄNE\\benutzer» oder der vollständige DN wie «CN=Name,OU=…,DC=domäne,DC=local».';

export function adDataCode(message: string | undefined): string | null {
  const match = message?.match(/\bdata ([0-9a-f]{3,4})\b/i);
  return match ? match[1]!.toLowerCase() : null;
}

/** Entfernt den von ldapts angehängten «Code: 0x..»-Zusatz. */
function cleanServerMessage(message: string | undefined): string | undefined {
  const cleaned = message?.replace(/\s+Code: 0x[0-9a-f]+\s*$/i, '').trim();
  return cleaned || undefined;
}

type ErrorLike = { code?: unknown; message?: string; name?: string };

/** Netzwerk- und TLS-Fehler von Node.js. */
export function describeNetworkError(err: unknown): string | null {
  const e = err as ErrorLike;
  switch (e.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Der Servername lässt sich nicht auflösen (DNS).';
    case 'ECONNREFUSED':
      return 'Verbindung abgelehnt – auf diesem Port antwortet kein LDAP-Dienst.';
    case 'ETIMEDOUT':
      return 'Zeitüberschreitung beim Verbindungsaufbau.';
    case 'ECONNRESET':
      return 'Der Server hat die Verbindung abgebrochen.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Der Server ist im Netzwerk nicht erreichbar.';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'UNABLE_TO_GET_ISSUER_CERT':
      return 'Das Zertifikat des Servers ist nicht vertrauenswürdig. Bitte das Zertifikat der Zertifizierungsstelle unter «CA-Zertifikat» hinterlegen.';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'Das Zertifikat des Servers gilt für einen anderen Namen. In der Server-URL den Namen verwenden, auf den das Zertifikat ausgestellt ist (meist der vollständige Name des Servers).';
    case 'CERT_HAS_EXPIRED':
      return 'Das Zertifikat des Servers ist abgelaufen.';
    case 'CERT_NOT_YET_VALID':
      return 'Das Zertifikat des Servers ist noch nicht gültig (Uhrzeit prüfen).';
  }
  return null;
}

/**
 * Fehler beim Aufbau der Verschlüsselung (LDAPS-Handshake oder STARTTLS).
 * Bei Domain Controllern ohne Zertifikat bricht der Server ab bzw. meldet «Error initializing SSL/TLS».
 */
export function explainTlsError(err: unknown): Explained {
  const e = err as ErrorLike;
  const detail = cleanServerMessage(e.message);
  const noCertificate =
    e.code === 'ECONNRESET' ||
    e.code === 'EPIPE' ||
    (e.code === 52 && /SSL\/TLS/i.test(e.message ?? '')) ||
    /socket disconnected before secure TLS connection/i.test(e.message ?? '');
  if (noCertificate) {
    return {
      message:
        'Der Server kann keine verschlüsselte Verbindung aufbauen. Bei einem Domain Controller heisst das: Für LDAP ist kein Zertifikat installiert. Ohne Zertifikat sind weder STARTTLS noch LDAPS möglich.',
      detail,
    };
  }
  if (e.code === 2 || e.code === 12) {
    return { message: 'Der Server unterstützt STARTTLS nicht.', detail };
  }
  return { message: describeNetworkError(err) ?? `Verschlüsselung fehlgeschlagen.`, detail };
}

/**
 * Erklärt einen fehlgeschlagenen Bind (Anmeldung mit DN/Benutzername und Passwort).
 * `isAd`: Der Server ist ein Active Directory (aus dem RootDSE erkannt).
 */
export function explainBindError(err: unknown, opts: { isAd: boolean; encrypted: boolean }): Explained {
  const e = err as ErrorLike;
  const detail = cleanServerMessage(e.message);
  const network = describeNetworkError(err);
  if (network) return { message: network, detail };

  switch (e.code) {
    case 8:
    case 13:
      return {
        message: opts.encrypted
          ? 'Der Server verlangt eine stärkere Anmeldung, obwohl die Verbindung verschlüsselt ist.'
          : 'Der Server verlangt eine signierte oder verschlüsselte Verbindung (LDAP-Signierung, Standard ab Windows Server 2025). ' +
            'Anmeldungen über unverschlüsseltes LDAP lehnt er immer ab, auch mit korrektem Passwort. Bitte STARTTLS aktivieren ' +
            '(oder ldaps:// verwenden). Dafür braucht der Server ein Zertifikat.',
        detail,
      };
    case 34:
      return {
        message: `Der Bind-DN hat kein gültiges Format.${opts.isAd ? ` ${BIND_NAME_FORMATS}` : ' Erwartet wird ein DN wie «cn=name,dc=firma,dc=local».'}`,
        detail,
      };
    case 48:
      return { message: 'Anonyme Anmeldung bzw. Anmeldung ohne Passwort ist nicht erlaubt.', detail };
    case 49: {
      const code = adDataCode(e.message);
      const reason = (code && AD_BIND_REASONS[code]) ?? 'Benutzername bzw. DN oder Passwort ist falsch.';
      const hint = opts.isAd && (!code || code === '52e' || code === '525') ? ` ${BIND_NAME_FORMATS}` : '';
      return { message: `Anmeldung abgelehnt: ${reason}${hint}`, detail };
    }
    case 50:
      return { message: 'Keine Berechtigung für diese Abfrage.', detail };
    case 53:
      return {
        message: 'Der Server verweigert die Anmeldung (z.B. leeres Passwort oder eine Richtlinie des Servers).',
        detail,
      };
  }
  return { message: detail ?? 'Unbekannter Fehler bei der Anmeldung.', detail };
}

/** Fehler bei Suchen (Basis-DN, Gruppen, Filter). */
export function explainSearchError(err: unknown, opts: { isAd: boolean }): Explained {
  const e = err as ErrorLike;
  const detail = cleanServerMessage(e.message);
  const network = describeNetworkError(err);
  if (network) return { message: network, detail };
  switch (e.code) {
    case 1:
      // AD: 000004DC «a successful bind must be completed» = anonyme Suche nicht erlaubt
      if (/000004DC/i.test(e.message ?? '')) {
        return { message: 'Der Server erlaubt keine anonyme Suche. Bitte ein Dienstkonto angeben.', detail };
      }
      return { message: 'Der Server meldet einen Fehler bei der Suche.', detail };
    case 32:
      return { message: 'Der Eintrag existiert nicht.', detail };
    case 34:
      return { message: 'Der DN hat kein gültiges Format.', detail };
    case 50:
      return { message: 'Das Dienstkonto darf hier nicht suchen (fehlende Leserechte).', detail };
    case 87:
      return { message: 'Der Filter ist ungültig.', detail };
  }
  if (opts.isAd && /filter/i.test(e.message ?? '')) return { message: 'Der Filter ist ungültig.', detail };
  return { message: detail ?? 'Unbekannter Fehler bei der Suche.', detail };
}

/** Windows-Version eines Domain Controllers aus «domainControllerFunctionality». */
export function windowsServerVersion(level: string | undefined): string | null {
  switch (level) {
    case '0':
      return 'Windows 2000';
    case '2':
      return 'Windows Server 2003';
    case '3':
      return 'Windows Server 2008';
    case '4':
      return 'Windows Server 2008 R2';
    case '5':
      return 'Windows Server 2012';
    case '6':
      return 'Windows Server 2012 R2';
    case '7':
      return 'Windows Server 2016–2022';
    case '10':
      return 'Windows Server 2025';
  }
  return null;
}

/** DNS-Name einer Domäne aus dem DN («DC=iwssolar,DC=local» → «iwssolar.local»). */
export function domainFromDn(dn: string): string {
  return dn
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^dc=/i.test(part))
    .map((part) => part.slice(3))
    .join('.');
}

/** Liegt `dn` innerhalb von `base` (Vergleich ohne Gross-/Kleinschreibung und Leerzeichen)? */
export function isWithin(dn: string, base: string): boolean {
  const norm = (s: string) => s.replace(/\s*,\s*/g, ',').trim().toLowerCase();
  const d = norm(dn);
  const b = norm(base);
  return d === b || d.endsWith(`,${b}`);
}
