import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';
import { decryptSecret, encryptSecret } from '../common/crypto';
import type { Mailbox } from '../db/schema';
import { MailboxesService } from './mailboxes.service';
import { formPost, MICROSOFT_SCOPE, microsoftError, type MicrosoftTokenResponse } from './microsoft';

/** Standard-Scope für Microsoft 365 (IMAP und SMTP mit App-Berechtigungen). */
export const M365_SCOPE = 'https://outlook.office365.com/.default';

/**
 * Baut IMAP- und SMTP-Verbindungen für ein Postfach: mit Passwort, mit App-Zugriff (Client Credentials)
 * oder mit einem angemeldeten Microsoft-Konto (Refresh-Token). Bei einem freigegebenen Postfach meldet sich
 * ein Konto mit Zugriff an, verbunden wird mit der Adresse des Postfachs.
 */
@Injectable()
export class MailTransportService {
  private readonly tokens = new Map<string, { token: string; expiresAt: number; fingerprint: string }>();

  constructor(private readonly mailboxes: MailboxesService) {}

  async imapClient(mailbox: Mailbox): Promise<ImapFlow> {
    const auth =
      mailbox.authType === 'password'
        ? { user: mailbox.username, pass: decryptSecret(mailbox.passwordEnc ?? '') }
        : { user: mailbox.username, accessToken: await this.accessToken(mailbox) };
    return new ImapFlow({
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      secure: mailbox.imapSecure,
      auth,
      logger: false,
      socketTimeout: 120000,
    });
  }

  async smtpTransport(mailbox: Mailbox): Promise<Transporter> {
    const auth =
      mailbox.authType === 'password'
        ? { user: mailbox.username, pass: decryptSecret(mailbox.passwordEnc ?? '') }
        : { type: 'OAuth2' as const, user: mailbox.username, accessToken: await this.accessToken(mailbox) };
    return nodemailer.createTransport({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      secure: mailbox.smtpSecurity === 'tls',
      requireTLS: mailbox.smtpSecurity === 'starttls',
      ignoreTLS: mailbox.smtpSecurity === 'none',
      auth,
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    });
  }

  /** Verwirft ein zwischengespeichertes Token, z.B. nach einer neuen Anmeldung. */
  forget(mailboxId: string) {
    this.tokens.delete(mailboxId);
  }

  /** Holt ein Access-Token und speichert es bis kurz vor Ablauf. */
  private async accessToken(mailbox: Mailbox): Promise<string> {
    const fingerprint = [
      mailbox.authType,
      mailbox.oauthTokenUrl,
      mailbox.oauthClientId,
      mailbox.authType === 'microsoft' ? mailbox.oauthAccount : mailbox.oauthClientSecretEnc,
      mailbox.oauthScope,
    ].join('|');
    const cached = this.tokens.get(mailbox.id);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now() + 60000) return cached.token;

    const data = mailbox.authType === 'microsoft' ? await this.refreshMicrosoft(mailbox) : await this.clientCredentials(mailbox);
    this.tokens.set(mailbox.id, {
      token: data.access_token!,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      fingerprint,
    });
    return data.access_token!;
  }

  /** App-Zugriff über den Client-Credentials-Flow. */
  private async clientCredentials(mailbox: Mailbox): Promise<MicrosoftTokenResponse> {
    if (!mailbox.oauthTokenUrl || !mailbox.oauthClientId || !mailbox.oauthClientSecretEnc) {
      throw new Error('OAuth 2.0 ist für dieses Postfach unvollständig konfiguriert');
    }
    const response = await fetch(
      mailbox.oauthTokenUrl,
      formPost({
        grant_type: 'client_credentials',
        client_id: mailbox.oauthClientId,
        client_secret: decryptSecret(mailbox.oauthClientSecretEnc),
        scope: mailbox.oauthScope || M365_SCOPE,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!response.ok || !data.access_token) {
      throw new Error(
        `Token-Abruf fehlgeschlagen (${response.status}): ${data.error_description ?? data.error ?? 'keine Details'}`,
      );
    }
    return data;
  }

  /** Angemeldetes Microsoft-Konto: neues Access-Token über das Refresh-Token, ein neues Refresh-Token wird gespeichert. */
  private async refreshMicrosoft(mailbox: Mailbox): Promise<MicrosoftTokenResponse> {
    if (!mailbox.oauthRefreshTokenEnc || !mailbox.oauthTokenUrl || !mailbox.oauthClientId) {
      throw new Error('Noch nicht mit Microsoft angemeldet (Verwaltung → Postfächer → «Mit Microsoft anmelden»)');
    }
    const response = await fetch(
      mailbox.oauthTokenUrl,
      formPost({
        grant_type: 'refresh_token',
        client_id: mailbox.oauthClientId,
        refresh_token: decryptSecret(mailbox.oauthRefreshTokenEnc),
        scope: MICROSOFT_SCOPE,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!response.ok || !data.access_token) throw new Error(microsoftError(data, response.status));
    if (data.refresh_token) await this.mailboxes.storeRefreshToken(mailbox.id, encryptSecret(data.refresh_token));
    return data;
  }
}
