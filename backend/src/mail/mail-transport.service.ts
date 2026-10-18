import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';
import { decryptSecret } from '../common/crypto';
import type { Mailbox } from '../db/schema';

/** Standard-Scope für Microsoft 365 (IMAP und SMTP mit App-Berechtigungen). */
export const M365_SCOPE = 'https://outlook.office365.com/.default';

/** Baut IMAP- und SMTP-Verbindungen für ein Postfach, inkl. OAuth 2.0 (Client Credentials). */
@Injectable()
export class MailTransportService {
  private readonly tokens = new Map<string, { token: string; expiresAt: number; fingerprint: string }>();

  async imapClient(mailbox: Mailbox): Promise<ImapFlow> {
    const auth =
      mailbox.authType === 'oauth2'
        ? { user: mailbox.username, accessToken: await this.accessToken(mailbox) }
        : { user: mailbox.username, pass: decryptSecret(mailbox.passwordEnc ?? '') };
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
      mailbox.authType === 'oauth2'
        ? { type: 'OAuth2' as const, user: mailbox.username, accessToken: await this.accessToken(mailbox) }
        : { user: mailbox.username, pass: decryptSecret(mailbox.passwordEnc ?? '') };
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

  /** Holt ein Access-Token über den Client-Credentials-Flow und speichert es bis kurz vor Ablauf. */
  private async accessToken(mailbox: Mailbox): Promise<string> {
    const fingerprint = [mailbox.oauthTokenUrl, mailbox.oauthClientId, mailbox.oauthClientSecretEnc, mailbox.oauthScope].join('|');
    const cached = this.tokens.get(mailbox.id);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now() + 60000) return cached.token;

    if (!mailbox.oauthTokenUrl || !mailbox.oauthClientId || !mailbox.oauthClientSecretEnc) {
      throw new Error('OAuth 2.0 ist für dieses Postfach unvollständig konfiguriert');
    }
    const response = await fetch(mailbox.oauthTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: mailbox.oauthClientId,
        client_secret: decryptSecret(mailbox.oauthClientSecretEnc),
        scope: mailbox.oauthScope || M365_SCOPE,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new Error(
        `Token-Abruf fehlgeschlagen (${response.status}): ${data.error_description ?? data.error ?? 'keine Details'}`,
      );
    }
    this.tokens.set(mailbox.id, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      fingerprint,
    });
    return data.access_token;
  }
}
