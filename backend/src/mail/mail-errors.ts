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
