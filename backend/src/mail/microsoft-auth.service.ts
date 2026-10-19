import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../common/crypto';
import type { Mailbox } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';
import {
  accountFromIdToken,
  formPost,
  MICROSOFT_LOGIN,
  MICROSOFT_SCOPE,
  microsoftError,
  NATIVE_REDIRECT_URI,
  parseRedirect,
  pkcePair,
  tenantFromTokenEndpoint,
  type MicrosoftTokenResponse,
} from './microsoft';

interface PendingCodeLogin {
  deviceCode: string;
  tenant: string;
  clientId: string;
  expiresAt: number;
}

interface PendingBrowserLogin {
  state: string;
  verifier: string;
  tenant: string;
  clientId: string;
  expiresAt: number;
}

export type LoginCheck = { status: 'pending' } | { status: 'done'; account: string } | { status: 'failed'; message: string };

/**
 * Meldet ein Postfach mit einem Microsoft-Konto an:
 * - im Browser (Autorisierungscode mit PKCE): Anmeldeseite in einem neuen Tab, danach die Adresse der leeren
 *   Rücksprungseite in Patchwork einfügen. Bleibt erlaubt, wenn ein Tenant die Anmeldung mit Code sperrt.
 * - mit Gerätecode: Patchwork zeigt einen Code, den man unter microsoft.com/devicelogin eingibt.
 * Beides geht ohne Client Secret und ohne Rückleitung zu Patchwork, also auch ohne HTTPS.
 */
@Injectable()
export class MicrosoftAuthService {
  /** Laufende Anmeldungen pro Postfach. Patchwork läuft als ein Prozess. */
  private readonly pendingCode = new Map<string, PendingCodeLogin>();
  private readonly pendingBrowser = new Map<string, PendingBrowserLogin>();

  constructor(
    private readonly settings: SettingsService,
    private readonly mailboxes: MailboxesService,
    private readonly transport: MailTransportService,
  ) {}

  /** Tenant zur Mail-Domain, aus der OpenID-Konfiguration von Microsoft. */
  async tenantFor(address: string): Promise<string> {
    const domain = address.split('@')[1] ?? '';
    const response = await fetch(`${MICROSOFT_LOGIN}/${encodeURIComponent(domain)}/v2.0/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json().catch(() => ({}))) as { token_endpoint?: string };
    const tenant = response.ok ? tenantFromTokenEndpoint(data.token_endpoint ?? '') : null;
    if (!tenant) throw new BadRequestException(`Die Domain «${domain}» gehört zu keinem Microsoft-365-Tenant`);
    return tenant;
  }

  /** Anmeldung im Browser starten: Adresse der Anmeldeseite von Microsoft. */
  async startBrowser(mailbox: Mailbox): Promise<{ url: string }> {
    const clientId = await this.clientId();
    const tenant = await this.tenantFor(mailbox.address);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString('base64url');
    this.pendingBrowser.set(mailbox.id, { state, verifier, tenant, clientId, expiresAt: Date.now() + 15 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: NATIVE_REDIRECT_URI,
      response_mode: 'query',
      scope: MICROSOFT_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${MICROSOFT_LOGIN}/${tenant}/oauth2/v2.0/authorize?${params}` };
  }

  /** Anmeldung im Browser abschliessen: den Code aus der eingefügten Adresse gegen Tokens tauschen. */
  async finishBrowser(mailbox: Mailbox, pasted: string): Promise<{ status: 'done'; account: string }> {
    const result = parseRedirect(pasted);
    if (!result) {
      throw new BadRequestException(
        'In der eingefügten Adresse steht kein Anmeldecode. Bitte die ganze Adresse der leeren Seite nach der Anmeldung kopieren.',
      );
    }
    if (result.error) {
      throw new BadRequestException(microsoftError({ error: result.error, error_description: result.errorDescription }, 400));
    }
    const login = this.pendingBrowser.get(mailbox.id);
    if (!login || login.expiresAt < Date.now()) {
      this.pendingBrowser.delete(mailbox.id);
      throw new BadRequestException('Die Anmeldung ist abgelaufen. Bitte die Anmeldung neu starten.');
    }
    if (result.state !== login.state) {
      throw new BadRequestException('Die Adresse gehört nicht zu dieser Anmeldung. Bitte die Anmeldeseite neu öffnen.');
    }
    const tokenUrl = `${MICROSOFT_LOGIN}/${login.tenant}/oauth2/v2.0/token`;
    const response = await fetch(
      tokenUrl,
      formPost({
        grant_type: 'authorization_code',
        client_id: login.clientId,
        code: result.code!,
        redirect_uri: NATIVE_REDIRECT_URI,
        code_verifier: login.verifier,
        scope: MICROSOFT_SCOPE,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    this.pendingBrowser.delete(mailbox.id);
    if (!response.ok || !data.refresh_token) throw new BadRequestException(microsoftError(data, response.status));
    return { status: 'done', account: await this.store(mailbox, tokenUrl, login.clientId, data) };
  }

  /** Anmeldung mit Code starten: Code für microsoft.com/devicelogin. */
  async start(mailbox: Mailbox) {
    const clientId = await this.clientId();
    const tenant = await this.tenantFor(mailbox.address);
    const response = await fetch(
      `${MICROSOFT_LOGIN}/${tenant}/oauth2/v2.0/devicecode`,
      formPost({ client_id: clientId, scope: MICROSOFT_SCOPE }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse & {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!response.ok || !data.device_code || !data.user_code) {
      throw new BadRequestException(microsoftError(data, response.status));
    }
    const expiresIn = data.expires_in ?? 900;
    this.pendingCode.set(mailbox.id, { deviceCode: data.device_code, tenant, clientId, expiresAt: Date.now() + expiresIn * 1000 });
    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri ?? 'https://microsoft.com/devicelogin',
      expiresIn,
      interval: data.interval ?? 5,
    };
  }

  /** Anmeldung mit Code: bei Microsoft nachfragen, ob sie abgeschlossen ist, und sie dann am Postfach speichern. */
  async check(mailbox: Mailbox): Promise<LoginCheck> {
    const login = this.pendingCode.get(mailbox.id);
    if (!login || login.expiresAt < Date.now()) {
      this.pendingCode.delete(mailbox.id);
      return { status: 'failed', message: 'Der Code ist abgelaufen. Bitte die Anmeldung neu starten.' };
    }
    const tokenUrl = `${MICROSOFT_LOGIN}/${login.tenant}/oauth2/v2.0/token`;
    const response = await fetch(
      tokenUrl,
      formPost({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: login.clientId,
        device_code: login.deviceCode,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (data.error === 'authorization_pending' || data.error === 'slow_down') return { status: 'pending' };
    this.pendingCode.delete(mailbox.id);
    if (!response.ok || !data.refresh_token) return { status: 'failed', message: microsoftError(data, response.status) };
    return { status: 'done', account: await this.store(mailbox, tokenUrl, login.clientId, data) };
  }

  private async clientId(): Promise<string> {
    const { clientId } = await this.settings.get('microsoft');
    if (!clientId) {
      throw new BadRequestException(
        'Microsoft 365 ist noch nicht eingerichtet: Es fehlt die Anwendungs-ID (Verwaltung → Postfächer → Microsoft 365)',
      );
    }
    return clientId;
  }

  /** Speichert die Anmeldung am Postfach und liefert das angemeldete Konto. */
  private async store(mailbox: Mailbox, tokenUrl: string, clientId: string, data: MicrosoftTokenResponse): Promise<string> {
    const account = accountFromIdToken(data.id_token) ?? mailbox.address;
    await this.mailboxes.storeMicrosoftLogin(mailbox.id, {
      tokenUrl,
      clientId,
      refreshTokenEnc: encryptSecret(data.refresh_token!),
      account,
    });
    this.transport.forget(mailbox.id);
    return account;
  }
}
