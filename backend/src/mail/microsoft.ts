/** Anmeldung von Postfächern mit einem Microsoft-Konto (OAuth 2.0 mit Gerätecode, delegierte Rechte). */

export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';

/** Delegierte Rechte für IMAP und SMTP, dazu das Refresh-Token (offline_access) und der Kontoname (openid, profile). */
export const MICROSOFT_SCOPE =
  'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid profile';

/** POST mit Formulardaten an einen Endpunkt von Microsoft. */
export const formPost = (values: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(values),
  signal: AbortSignal.timeout(30000),
});

export interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

/** Tenant-ID aus der Adresse des Token-Endpunkts, z.B. https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token. */
export function tenantFromTokenEndpoint(url: string): string | null {
  const match = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

/** Angemeldetes Konto aus dem ID-Token. Ohne Signaturprüfung, nur für die Anzeige. */
export function accountFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const account = claims.preferred_username ?? claims.upn ?? claims.email;
    return typeof account === 'string' && account ? account.toLowerCase() : null;
  } catch {
    return null;
  }
}

const RENEW = 'Bitte unter Verwaltung → Postfächer neu mit Microsoft anmelden.';

/** Hinweise zu häufigen AADSTS-Codes */
const CODE_HINTS: Record<number, string> = {
  90002: 'Zu dieser Domain gibt es keinen Microsoft-365-Tenant.',
  700016:
    'Die App-Registrierung wurde in diesem Tenant nicht gefunden. Stimmt die Anwendungs-ID, und gehört die Mail-Domain zum selben Tenant wie die App-Registrierung?',
  7000218:
    'In der App-Registrierung sind öffentliche Clientflows nicht zugelassen (Authentifizierung → «Öffentliche Clientflows zulassen»: Ja).',
  65001:
    'Für die App fehlt die Zustimmung: In der App-Registrierung unter «API-Berechtigungen» die Administratorzustimmung erteilen oder beim Anmelden als Admin «Im Namen Ihrer Organisation zustimmen» anhaken.',
  70011: 'Der App-Registrierung fehlen Berechtigungen (IMAP.AccessAsUser.All, SMTP.Send, offline_access, openid, profile).',
  50020: 'Das Konto gehört nicht zum Tenant der App-Registrierung.',
  53003:
    'Eine Richtlinie für bedingten Zugriff blockiert die Anmeldung, z.B. weil die Anmeldung mit Code gesperrt ist. Ausweg: App-Zugriff unter «Erweitert».',
  70019: 'Der Code ist abgelaufen. Bitte die Anmeldung neu starten.',
  700082: `Die Microsoft-Anmeldung ist abgelaufen. ${RENEW}`,
  50173: `Die Microsoft-Anmeldung ist ungültig geworden, z.B. nach einer Passwortänderung. ${RENEW}`,
  70043: `Die Microsoft-Anmeldung ist wegen einer Richtlinie zur Anmeldehäufigkeit abgelaufen. ${RENEW}`,
};

/** Hinweise zu OAuth-Fehlern ohne passenden AADSTS-Code */
const ERROR_HINTS: Record<string, string> = {
  authorization_declined: 'Die Anmeldung wurde abgelehnt.',
  access_denied: 'Die Anmeldung wurde abgebrochen.',
  expired_token: 'Der Code ist abgelaufen. Bitte die Anmeldung neu starten.',
  bad_verification_code: 'Der Code ist ungültig. Bitte die Anmeldung neu starten.',
  invalid_grant: `Die Microsoft-Anmeldung ist abgelaufen oder wurde widerrufen. ${RENEW}`,
};

/** Verständliche Meldung zu einem Fehler von Microsoft, mit AADSTS-Code zum Nachschlagen. */
export function microsoftError(data: MicrosoftTokenResponse, status: number): string {
  const fromText = /AADSTS(\d+)/.exec(data.error_description ?? '')?.[1];
  const code = data.error_codes?.[0] ?? (fromText ? Number(fromText) : undefined);
  const suffix = code !== undefined ? ` (AADSTS${code})` : '';
  const hint = (code !== undefined ? CODE_HINTS[code] : undefined) ?? (data.error ? ERROR_HINTS[data.error] : undefined);
  if (hint) return hint + suffix;
  // Microsoft hängt Trace-ID und Zeitstempel in weiteren Zeilen an
  const detail = data.error_description?.split(/\r?\n/)[0]?.replace(/^AADSTS\d+:\s*/, '').trim();
  return (detail || data.error || `Antwort ${status} von Microsoft`) + suffix;
}
