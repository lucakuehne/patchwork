import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../common/crypto';
import type { Mailbox } from '../db/schema';
import { MailTransportService } from './mail-transport.service';
import { accountFromIdToken, microsoftError, tenantFromTokenEndpoint } from './microsoft';
import { MicrosoftAuthService } from './microsoft-auth.service';

const TENANT = '11111111-2222-3333-4444-555555555555';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

/** Antworten von Microsoft der Reihe nach je Endpunkt; merkt sich die gesendeten Formulare. */
function microsoft(responses: Record<string, Response[]>) {
  const calls: { endpoint: string; form: URLSearchParams }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const endpoint = Object.keys(responses).find((k) => url.endsWith(k));
      if (!endpoint) throw new Error(`Unerwarteter Aufruf: ${url}`);
      calls.push({ endpoint, form: new URLSearchParams(String(init?.body ?? '')) });
      return responses[endpoint]!.shift()!;
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const mailbox = { id: 'm1', address: 'helpdesk@firma.ch' } as Mailbox;

function service(clientId = 'app-id') {
  const mailboxes = { storeMicrosoftLogin: vi.fn() };
  const transport = { forget: vi.fn() };
  const settings = { get: async () => ({ clientId }) };
  return {
    auth: new MicrosoftAuthService(settings as never, mailboxes as never, transport as never),
    mailboxes,
    transport,
  };
}

describe('Hilfsfunktionen', () => {
  it('liest den Tenant aus dem Token-Endpunkt', () => {
    expect(tenantFromTokenEndpoint(TOKEN_URL)).toBe(TENANT);
    expect(tenantFromTokenEndpoint('https://login.microsoftonline.com/common/oauth2/v2.0/token')).toBeNull();
    expect(tenantFromTokenEndpoint('')).toBeNull();
  });

  it('liest das angemeldete Konto aus dem ID-Token', () => {
    expect(accountFromIdToken(idToken({ preferred_username: 'Luca@Firma.ch' }))).toBe('luca@firma.ch');
    expect(accountFromIdToken(idToken({ upn: 'it@firma.ch' }))).toBe('it@firma.ch');
    expect(accountFromIdToken('kaputt')).toBeNull();
    expect(accountFromIdToken(undefined)).toBeNull();
  });

  it('erklärt Fehler von Microsoft verständlich, mit AADSTS-Code', () => {
    expect(microsoftError({ error: 'unauthorized_client', error_codes: [700016] }, 400)).toMatch(
      /App-Registrierung wurde in diesem Tenant nicht gefunden.*\(AADSTS700016\)$/,
    );
    expect(microsoftError({ error: 'invalid_client', error_description: 'AADSTS7000218: The request body must contain …' }, 401)).toMatch(
      /Öffentliche Clientflows zulassen.*\(AADSTS7000218\)$/,
    );
    expect(microsoftError({ error: 'invalid_grant' }, 400)).toMatch(/neu mit Microsoft anmelden/);
    expect(microsoftError({ error: 'x', error_description: 'AADSTS1234: Etwas anderes.\r\nTrace ID: …' }, 400)).toBe(
      'Etwas anderes. (AADSTS1234)',
    );
    expect(microsoftError({}, 502)).toBe('Antwort 502 von Microsoft');
  });
});

describe('Anmeldung im Browser', () => {
  it('öffnet die Anmeldeseite mit PKCE und tauscht den eingefügten Code gegen Tokens', async () => {
    const calls = microsoft({
      '/firma.ch/v2.0/.well-known/openid-configuration': [json({ token_endpoint: TOKEN_URL })],
      '/oauth2/v2.0/token': [
        json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken({ preferred_username: 'luca@firma.ch' }) }),
      ],
    });
    const { auth, mailboxes, transport } = service();

    const authorize = new URL((await auth.startBrowser(mailbox)).url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    const params = authorize.searchParams;
    expect(params.get('client_id')).toBe('app-id');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('redirect_uri')).toBe('https://login.microsoftonline.com/common/oauth2/nativeclient');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('scope')).toContain('https://outlook.office.com/SMTP.Send');

    const pasted = `https://login.microsoftonline.com/common/oauth2/nativeclient?code=abc-123&state=${params.get('state')}&session_state=x`;
    expect(await auth.finishBrowser(mailbox, ` ${pasted} `)).toEqual({ status: 'done', account: 'luca@firma.ch' });
    const form = calls[1]!.form;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('abc-123');
    expect(form.get('redirect_uri')).toBe('https://login.microsoftonline.com/common/oauth2/nativeclient');
    // Der geheime Prüfwert passt zum Hash auf der Anmeldeseite
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(params.get('code_challenge'));

    const [id, login] = mailboxes.storeMicrosoftLogin.mock.calls[0]!;
    expect(id).toBe('m1');
    expect(login).toMatchObject({ tokenUrl: TOKEN_URL, clientId: 'app-id', account: 'luca@firma.ch' });
    expect(decryptSecret(login.refreshTokenEnc)).toBe('rt');
    expect(transport.forget).toHaveBeenCalledWith('m1');
    // Dieselbe Adresse ein zweites Mal einfügen geht nicht
    await expect(auth.finishBrowser(mailbox, pasted)).rejects.toThrow(/abgelaufen/);
  });

  it('erkennt Adressen ohne Code, fremde und abgelehnte Anmeldungen', async () => {
    microsoft({ '/firma.ch/v2.0/.well-known/openid-configuration': [json({ token_endpoint: TOKEN_URL })] });
    const { auth } = service();
    await auth.startBrowser(mailbox);
    await expect(auth.finishBrowser(mailbox, 'irgendwas')).rejects.toThrow(/kein Anmeldecode/);
    await expect(auth.finishBrowser(mailbox, '?code=abc&state=fremd')).rejects.toThrow(/gehört nicht zu dieser Anmeldung/);
    await expect(
      auth.finishBrowser(
        mailbox,
        'https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied&error_description=AADSTS53003%3A+Blocked+by+Conditional+Access',
      ),
    ).rejects.toThrow(/bedingten Zugriff.*\(AADSTS53003\)$/);
  });
});

describe('Anmeldung mit Code', () => {
  it('ermittelt den Tenant aus der Domain, zeigt den Code und speichert die Anmeldung', async () => {
    const calls = microsoft({
      '/firma.ch/v2.0/.well-known/openid-configuration': [json({ token_endpoint: TOKEN_URL })],
      '/oauth2/v2.0/devicecode': [
        json({ device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 }),
      ],
      '/oauth2/v2.0/token': [
        json({ error: 'authorization_pending' }, 400),
        json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken({ preferred_username: 'luca@firma.ch' }) }),
      ],
    });
    const { auth, mailboxes, transport } = service();

    expect(await auth.start(mailbox)).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
    });
    expect(calls[1]!.form.get('client_id')).toBe('app-id');
    expect(calls[1]!.form.get('scope')).toContain('https://outlook.office.com/IMAP.AccessAsUser.All');

    expect(await auth.check(mailbox)).toEqual({ status: 'pending' });
    expect(await auth.check(mailbox)).toEqual({ status: 'done', account: 'luca@firma.ch' });
    expect(calls[3]!.form.get('device_code')).toBe('dc');

    const [id, login] = mailboxes.storeMicrosoftLogin.mock.calls[0]!;
    expect(id).toBe('m1');
    expect(login).toMatchObject({ tokenUrl: TOKEN_URL, clientId: 'app-id', account: 'luca@firma.ch' });
    expect(decryptSecret(login.refreshTokenEnc)).toBe('rt');
    expect(transport.forget).toHaveBeenCalledWith('m1');
    // Danach ist die Anmeldung abgeschlossen
    expect((await auth.check(mailbox)).status).toBe('failed');
  });

  it('meldet abgelehnte Anmeldungen und fehlende Einrichtung', async () => {
    microsoft({
      '/firma.ch/v2.0/.well-known/openid-configuration': [json({ token_endpoint: TOKEN_URL })],
      '/oauth2/v2.0/devicecode': [json({ device_code: 'dc', user_code: 'X', expires_in: 900 })],
      '/oauth2/v2.0/token': [json({ error: 'authorization_declined' }, 400)],
    });
    const { auth } = service();
    await auth.start(mailbox);
    expect(await auth.check(mailbox)).toEqual({ status: 'failed', message: 'Die Anmeldung wurde abgelehnt.' });
    await expect(service('').auth.start(mailbox)).rejects.toThrow(/noch nicht eingerichtet/);
  });

  it('erkennt Domains ohne Microsoft-365-Tenant', async () => {
    microsoft({ '/beispiel.ch/v2.0/.well-known/openid-configuration': [json({ error: 'invalid_tenant' }, 400)] });
    await expect(service().auth.tenantFor('it@beispiel.ch')).rejects.toThrow(/gehört zu keinem Microsoft-365-Tenant/);
  });
});

describe('Verbindung mit angemeldetem Konto', () => {
  it('erneuert das Access-Token, speichert das neue Refresh-Token und nutzt den Zwischenspeicher', async () => {
    const calls = microsoft({ [TOKEN_URL]: [json({ access_token: 'at', refresh_token: 'rt2', expires_in: 3600 })] });
    const mailboxes = { storeRefreshToken: vi.fn() };
    const transport = new MailTransportService(mailboxes as never);
    const mailbox = {
      id: 'm1',
      authType: 'microsoft',
      username: 'helpdesk@firma.ch',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true,
      oauthTokenUrl: TOKEN_URL,
      oauthClientId: 'app-id',
      oauthRefreshTokenEnc: encryptSecret('rt'),
      oauthAccount: 'luca@firma.ch',
    } as Mailbox;

    await transport.imapClient(mailbox);
    await transport.imapClient(mailbox);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.form.get('grant_type')).toBe('refresh_token');
    expect(calls[0]!.form.get('refresh_token')).toBe('rt');
    expect(decryptSecret(mailboxes.storeRefreshToken.mock.calls[0]![1])).toBe('rt2');
  });

  it('meldet eine fehlende Anmeldung verständlich', async () => {
    const transport = new MailTransportService({} as never);
    await expect(transport.imapClient({ id: 'm2', authType: 'microsoft' } as Mailbox)).rejects.toThrow(
      /Noch nicht mit Microsoft angemeldet/,
    );
  });
});
