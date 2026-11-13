import type { Mailbox } from '../db/schema';

/** Ergänzt bekannte Fehlermeldungen von Exchange Online um einen Hinweis, was zu tun ist. */
export function explainMailError(message: string, mailbox: Pick<Mailbox, 'address' | 'oauthAccount'>): string {
  if (/User is authenticated but not connected/i.test(message)) {
    const delegate =
      mailbox.oauthAccount && mailbox.oauthAccount !== mailbox.address
        ? ` Ist das angemeldete Konto ${mailbox.oauthAccount} nicht das Konto dieses Postfachs, braucht es zudem Vollzugriff darauf.`
        : '';
    return (
      `${message} – Die Anmeldung gilt, aber Exchange Online lässt keine IMAP-Verbindung zu ${mailbox.address} zu. ` +
      'Meist ist IMAP für das Postfach abgeschaltet (Microsoft 365 Admin Center → Benutzer → Postfach → E-Mail → ' +
      `E-Mail-Apps verwalten → IMAP).${delegate}`
    );
  }
  if (/SmtpClientAuthentication is disabled/i.test(message)) {
    return (
      `${message} – Der Versand per SMTP ist gesperrt: «Authentifiziertes SMTP» für dieses Postfach erlauben ` +
      '(Microsoft 365 Admin Center → Benutzer → Postfach → E-Mail → E-Mail-Apps verwalten).'
    );
  }
  return message;
}

/**
 * Fehlermeldung für Protokoll und Anzeige, nie leer: Schlägt die Verbindung über IPv4 und IPv6 fehl (z.B. «localhost»
 * oder ein Name mit beiden Adressen), meldet Node einen Sammelfehler (AggregateError) ohne eigenen Text.
 */
export function errorText(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown; errors?: unknown } | null | undefined;
  if (typeof e?.message === 'string' && e.message.trim()) return e.message;
  if (Array.isArray(e?.errors)) {
    const inner = [...new Set(e.errors.map((x: unknown) => errorText(x)))].filter((t) => t !== 'Unbekannter Fehler');
    if (inner.length) return inner.join('; ');
  }
  if (typeof e?.code === 'string' && e.code) return e.code;
  return 'Unbekannter Fehler';
}
