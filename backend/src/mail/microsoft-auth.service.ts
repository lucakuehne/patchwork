import { BadRequestException, Injectable } from '@nestjs/common';
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
  tenantFromTokenEndpoint,
  type MicrosoftTokenResponse,
} from './microsoft';

interface PendingLogin {
  deviceCode: string;
  tenant: string;
  clientId: string;
  expiresAt: number;
}

export type LoginCheck = { status: 'pending' } | { status: 'done'; account: string } | { status: 'failed'; message: string };

/**
 * Meldet ein Postfach mit einem Microsoft-Konto an (Gerätecode): Patchwork zeigt einen Code, den man unter
 * microsoft.com/devicelogin eingibt. Das geht ohne Rückleitung zu Patchwork und damit auch ohne HTTPS.
 */
@Injectable()
export class MicrosoftAuthService {
  /** Laufende Anmeldungen pro Postfach. Patchwork läuft als ein Prozess. */
  private readonly pending = new Map<string, PendingLogin>();

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

  /** Startet die Anmeldung und liefert den Code für microsoft.com/devicelogin. */
  async start(mailbox: Mailbox) {
    const { clientId } = await this.settings.get('microsoft');
    if (!clientId) {
      throw new BadRequestException(
        'Microsoft 365 ist noch nicht eingerichtet: Es fehlt die Anwendungs-ID (Verwaltung → Postfächer → Microsoft 365)',
      );
    }
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
    this.pending.set(mailbox.id, { deviceCode: data.device_code, tenant, clientId, expiresAt: Date.now() + expiresIn * 1000 });
    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri ?? 'https://microsoft.com/devicelogin',
      expiresIn,
      interval: data.interval ?? 5,
    };
  }

  /** Fragt bei Microsoft nach, ob die Anmeldung abgeschlossen ist, und speichert sie dann am Postfach. */
  async check(mailbox: Mailbox): Promise<LoginCheck> {
    const login = this.pending.get(mailbox.id);
    if (!login || login.expiresAt < Date.now()) {
      this.pending.delete(mailbox.id);
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
    this.pending.delete(mailbox.id);
    if (!response.ok || !data.refresh_token) return { status: 'failed', message: microsoftError(data, response.status) };

    const account = accountFromIdToken(data.id_token) ?? mailbox.address;
    await this.mailboxes.storeMicrosoftLogin(mailbox.id, {
      tokenUrl,
      clientId: login.clientId,
      refreshTokenEnc: encryptSecret(data.refresh_token),
      account,
    });
    this.transport.forget(mailbox.id);
    return { status: 'done', account };
  }
}
