import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../common/crypto';
import { appConfig } from '../config';
import type { Mailbox } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';
import {
  accountFromIdToken,
  callbackUrl,
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
  redirectUri: string;
  expiresAt: number;
  /** Ergebnis nach dem Rücksprung zu Patchwork, bis der Anmeldedialog es abholt */
  result?: LoginCheck;
}

export type LoginCheck = { status: 'pending' } | { status: 'done'; account: string } | { status: 'failed'; message: string };

/** Antwort von Microsoft beim Rücksprung zu Patchwork */
export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Meldet ein Postfach mit einem Microsoft-Konto an:
 * - im Browser (Autorisierungscode mit PKCE): Anmeldeseite in einem neuen Tab. Mit HTTPS kehrt der Tab danach
 *   direkt zu Patchwork zurück, sonst (oder als Ausweichweg) fügt man die Adresse der leeren Rücksprungseite von
 *   Microsoft in Patchwork ein. Bleibt erlaubt, wenn ein Tenant die Anmeldung mit Code sperrt.
 * - mit Gerätecode: Patchwork zeigt einen Code, den man unter microsoft.com/devicelogin eingibt.
 * Alles ohne Client Secret.
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

  /**
   * Anmeldung im Browser starten: Adresse der Anmeldeseite von Microsoft. «direct» kehrt mit HTTPS direkt zu
   * Patchwork zurück; ohne HTTPS und mit «paste» fügt man danach die Adresse der leeren Seite ein.
   */
  async startBrowser(mailbox: Mailbox, mode: 'direct' | 'paste' = 'direct'): Promise<{ url: string; direct: boolean }> {
    const clientId = await this.clientId();
    const tenant = await this.tenantFor(mailbox.address);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString('base64url');
    const callback = mode === 'direct' ? callbackUrl(appConfig.publicUrl) : null;
    const redirectUri = callback ?? NATIVE_REDIRECT_URI;
    this.pendingBrowser.set(mailbox.id, {
      state,
      verifier,
      tenant,
      clientId,
      redirectUri,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url: `${MICROSOFT_LOGIN}/${tenant}/oauth2/v2.0/authorize?${params}`, direct: !!callback };
  }

  /**
   * Rücksprung von Microsoft direkt zu Patchwork: Code einlösen und das Ergebnis für den Anmeldedialog ablegen.
   * Zugeordnet wird über «state», den nur Patchwork kennt; den Code einlösen geht nur mit dem PKCE-Verifier.
   */
  async completeCallback(query: CallbackQuery): Promise<LoginCheck> {
    const entry = query.state ? [...this.pendingBrowser].find(([, login]) => login.state === query.state) : undefined;
    if (!entry) return { status: 'failed', message: 'Diese Anmeldung ist unbekannt oder abgelaufen. Bitte in Patchwork neu starten.' };
    const [mailboxId, login] = entry;
    let result: LoginCheck;
    if (login.result) {
      result = login.result;
    } else if (login.expiresAt < Date.now()) {
      result = { status: 'failed', message: 'Die Anmeldung ist abgelaufen. Bitte die Anmeldung neu starten.' };
    } else if (query.error || !query.code) {
      result = {
        status: 'failed',
        message: microsoftError({ error: query.error ?? 'invalid_request', error_description: query.error_description }, 400),
      };
    } else {
      try {
        result = { status: 'done', account: await this.redeem(await this.mailboxes.get(mailboxId), login, query.code) };
      } catch (err) {
        result = { status: 'failed', message: (err as Error).message };
      }
    }
    login.result = result;
    return result;
  }

  /** Anmeldedialog fragt nach, ob der Rücksprung zu Patchwork schon da war. */
  browserStatus(mailbox: Mailbox): LoginCheck {
    const login = this.pendingBrowser.get(mailbox.id);
    if (!login || login.expiresAt < Date.now()) {
      this.pendingBrowser.delete(mailbox.id);
      return { status: 'failed', message: 'Die Anmeldung ist abgelaufen. Bitte die Anmeldung neu starten.' };
    }
    if (!login.result) return { status: 'pending' };
    this.pendingBrowser.delete(mailbox.id);
    return login.result;
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
    try {
      return { status: 'done', account: await this.redeem(mailbox, login, result.code!) };
    } finally {
      this.pendingBrowser.delete(mailbox.id);
    }
  }

  /** Tauscht den Code gegen Tokens (mit derselben Rücksprungadresse wie beim Start) und speichert die Anmeldung. */
  private async redeem(mailbox: Mailbox, login: PendingBrowserLogin, code: string): Promise<string> {
    const tokenUrl = `${MICROSOFT_LOGIN}/${login.tenant}/oauth2/v2.0/token`;
    const response = await fetch(
      tokenUrl,
      formPost({
        grant_type: 'authorization_code',
        client_id: login.clientId,
        code,
        redirect_uri: login.redirectUri,
        code_verifier: login.verifier,
        scope: MICROSOFT_SCOPE,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!response.ok || !data.refresh_token) throw new BadRequestException(microsoftError(data, response.status));
    return this.store(mailbox, tokenUrl, login.clientId, data);
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
