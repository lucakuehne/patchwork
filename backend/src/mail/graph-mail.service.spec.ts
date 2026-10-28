import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, GraphSync, Mailbox } from '../db/schema';
import { GRAPH, GraphMailService, graphErrorMessage, graphSyncKey, tokenScopes } from './graph-mail.service';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = (scp: string) => `x.${Buffer.from(JSON.stringify({ scp })).toString('base64url')}.y`;
const START = new Date('2026-10-20T08:00:00Z');

/** Nachgebautes Microsoft Graph: beantwortet Aufrufe über eine Funktion und merkt sie sich. */
function graphApi(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { method: init.method ?? 'GET', url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

function setup(mailbox: Partial<Mailbox> = {}, scopes = 'Mail.ReadWrite Mail.Send User.Read', known: string[] = []) {
  const mailboxes = { recordGraphPoll: vi.fn() };
  const files = new Map<string, Buffer>();
  const storage = { read: async (key: string) => files.get(key)! };
  const service = new GraphMailService(
    undefined as never,
    { graphToken: async () => token(scopes) } as never,
    mailboxes as never,
    storage as never,
  );
  vi.spyOn(service as unknown as { known: (id: string) => Promise<boolean> }, 'known').mockImplementation(async (id) =>
    known.includes(id),
  );
  const box = {
    id: 'm1',
    address: 'helpdesk@firma.ch',
    imapFolder: 'INBOX',
    graphFolderId: null,
    fetchFrom: START,
    oauthAccount: 'mail.helpdesk@firma.ch',
    graphSync: null,
    ...mailbox,
  } as Mailbox;
  return { service, mailboxes, files, box };
}

/** Postfach mit einem Stand des Abrufs, der zu seinen Einstellungen passt */
function withSync(mailbox: Partial<Mailbox>, sync: Omit<GraphSync, 'key'>): Partial<Mailbox> {
  const box = { ...setup(mailbox).box };
  return { ...mailbox, graphSync: { key: graphSyncKey(box), ...sync } };
}

/** Zuletzt gespeicherter Stand des Abrufs */
function lastState(mailboxes: { recordGraphPoll: ReturnType<typeof vi.fn> }) {
  return mailboxes.recordGraphPoll.mock.calls.at(-1)![1] as { sync: GraphSync | null; error: string | null };
}

afterEach(() => vi.unstubAllGlobals());

describe('Abruf über Microsoft Graph', () => {
  it('erkennt das eigene Postfach, holt neue Mails ab dem Startzeitpunkt und merkt sich den Delta-Link', async () => {
    const calls = graphApi(({ url }) => {
      if (url.startsWith(`${GRAPH}/me?`)) {
        return json({ userPrincipalName: 'mail.helpdesk@firma.ch', mail: 'shared@firma.ch', proxyAddresses: ['SMTP:shared@firma.ch', 'smtp:helpdesk@firma.ch', 'X500:/o=x'] });
      }
      if (url.startsWith(`${GRAPH}/me/mailFolders/inbox/messages/delta?`)) {
        return json({
          value: [
            { id: 'a', receivedDateTime: '2026-10-20T08:01:00Z', internetMessageId: '<bekannt@x>' },
            { id: 'b', receivedDateTime: '2026-10-20T08:02:00Z', internetMessageId: '<neu@x>' },
            { id: 'weg', '@removed': { reason: 'deleted' } },
          ],
          '@odata.nextLink': `${GRAPH}/me/naechste-seite`,
        });
      }
      if (url === `${GRAPH}/me/naechste-seite`) {
        return json({
          value: [
            { id: 'c', receivedDateTime: '2026-10-20T08:03:00Z' },
            { id: 'alt', receivedDateTime: '2026-10-20T07:59:59Z', internetMessageId: '<alt@x>' },
          ],
          '@odata.deltaLink': `${GRAPH}/me/delta-link`,
        });
      }
      if (url === `${GRAPH}/me/messages/b/$value`) return new Response(Buffer.from('Mail b'));
      if (url === `${GRAPH}/me/messages/c/$value`) return new Response(Buffer.from('Mail c'));
      return json({ error: { code: 'Unerwartet', message: url } }, 500);
    });
    const { service, mailboxes, box } = setup({}, undefined, ['<bekannt@x>']);
    const ingested: string[] = [];

    await service.poll(box, async (raw) => ingested.push(raw.toString()));

    // Bekannte, entfernte und vor dem Startzeitpunkt eingegangene Mails werden nicht geholt
    expect(ingested).toEqual(['Mail b', 'Mail c']);
    const delta = calls.find((c) => c.url.includes('/messages/delta?'))!;
    expect(decodeURIComponent(delta.url)).toContain('$filter=receivedDateTime ge 2026-10-20T08:00:00.000Z');
    expect(delta.headers.Prefer).toBe('odata.maxpagesize=50');
    expect(lastState(mailboxes)).toEqual({
      sync: { key: graphSyncKey(box), user: 'me', link: `${GRAPH}/me/delta-link` },
      error: null,
    });
    // Nur gelesen: keine ändernden Aufrufe
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('macht beim gemerkten Stand weiter, auch mit Mails, die später in den Ordner kamen', async () => {
    const calls = graphApi(({ url }) => {
      if (url === `${GRAPH}/users/helpdesk%40firma.ch/delta-link`) {
        // Älterer Eingang, aber neu im Ordner (z.B. aus «Junk-E-Mail» zurückgeschoben)
        return json({
          value: [{ id: 'z', receivedDateTime: '2026-10-20T08:00:05Z', internetMessageId: '<spaet@x>' }],
          '@odata.deltaLink': `${GRAPH}/users/helpdesk%40firma.ch/delta-link-2`,
        });
      }
      if (url === `${GRAPH}/users/helpdesk%40firma.ch/messages/z/$value`) return new Response(Buffer.from('Mail z'));
      return json({}, 500);
    });
    const { service, mailboxes, box } = setup(
      withSync({}, { user: 'users/helpdesk%40firma.ch', link: `${GRAPH}/users/helpdesk%40firma.ch/delta-link` }),
    );
    const ingested: string[] = [];

    await service.poll(box, async (raw) => ingested.push(raw.toString()));

    expect(ingested).toEqual(['Mail z']);
    expect(calls).toHaveLength(2);
    expect(lastState(mailboxes).sync?.link).toBe(`${GRAPH}/users/helpdesk%40firma.ch/delta-link-2`);
  });

  it('nutzt für das Postfach eines anderen Kontos «users/<adresse>» und den gewählten Ordner', async () => {
    const calls = graphApi(({ url }) => {
      if (url.startsWith(`${GRAPH}/me?`)) return json({ userPrincipalName: 'luca@firma.ch', mail: 'luca@firma.ch', proxyAddresses: [] });
      if (url.startsWith(`${GRAPH}/users/helpdesk%40firma.ch/mailFolders/AAMk%3D%3D/messages/delta?`)) {
        return json({ value: [], '@odata.deltaLink': `${GRAPH}/users/helpdesk%40firma.ch/delta-link` });
      }
      return json({}, 500);
    });
    const { service, mailboxes, box } = setup({ graphFolderId: 'AAMk==', imapFolder: 'Inbox-Patchwork' });

    await service.poll(box, async () => undefined);

    expect(calls).toHaveLength(2);
    expect(lastState(mailboxes)).toEqual({
      sync: { key: graphSyncKey(box), user: 'users/helpdesk%40firma.ch', link: `${GRAPH}/users/helpdesk%40firma.ch/delta-link` },
      error: null,
    });
  });

  it('beginnt von vorne, wenn sich Ordner, Startzeitpunkt oder Konto geändert haben', async () => {
    const calls = graphApi(({ url }) => {
      if (url.startsWith(`${GRAPH}/me?`)) return json({ userPrincipalName: 'helpdesk@firma.ch', proxyAddresses: [] });
      if (url.startsWith(`${GRAPH}/me/mailFolders/new-folder/messages/delta?`)) return json({ value: [], '@odata.deltaLink': `${GRAPH}/me/d` });
      return json({}, 500);
    });
    // Stand zum Posteingang, gespeichert von einem Abruf, der beim Wechsel des Ordners noch lief
    const old = withSync({}, { user: 'me', link: `${GRAPH}/me/old-folder` });
    const { service, mailboxes, box } = setup({ ...old, graphFolderId: 'new-folder' });

    await service.poll(box, async () => undefined);

    expect(calls.map((c) => c.url)).not.toContain(`${GRAPH}/me/old-folder`);
    expect(lastState(mailboxes).sync).toEqual({ key: graphSyncKey(box), user: 'me', link: `${GRAPH}/me/d` });
  });

  it('beginnt einmal von vorne, wenn der gemerkte Stand abgelaufen ist', async () => {
    const calls = graphApi(({ url }) => {
      if (url === `${GRAPH}/me/abgelaufen`) return json({ error: { code: 'SyncStateNotFound', message: 'weg' } }, 410);
      if (url.startsWith(`${GRAPH}/me/mailFolders/inbox/messages/delta?`)) return json({ value: [], '@odata.deltaLink': `${GRAPH}/me/neu` });
      return json({}, 500);
    });
    const { service, mailboxes, box } = setup(withSync({}, { user: 'me', link: `${GRAPH}/me/abgelaufen` }));

    await service.poll(box, async () => undefined);

    expect(calls).toHaveLength(2);
    expect(lastState(mailboxes)).toMatchObject({ sync: { link: `${GRAPH}/me/neu` }, error: null });
  });

  it('behält nach einem Fehler den Stand der zuletzt verarbeiteten Seite', async () => {
    graphApi(({ url }) => {
      if (url.startsWith(`${GRAPH}/me/mailFolders/inbox/messages/delta?`)) {
        return json({ value: [{ id: 'a', internetMessageId: '<a@x>' }], '@odata.nextLink': `${GRAPH}/me/seite-2` });
      }
      if (url === `${GRAPH}/me/messages/a/$value`) return new Response(Buffer.from('Mail a'));
      return json({ error: { code: 'ServiceUnavailable', message: 'später' } }, 503);
    });
    const { service, mailboxes, box } = setup(withSync({}, { user: 'me', link: null }));

    await service.poll(box, async () => undefined);

    expect(lastState(mailboxes)).toMatchObject({ sync: { link: `${GRAPH}/me/seite-2` }, error: 'Microsoft Graph 503 ServiceUnavailable: später' });
  });

  it('schickt das Token nur an Microsoft Graph', async () => {
    const calls = graphApi(({ url }) =>
      url.startsWith(`${GRAPH}/me/mailFolders/inbox/messages/delta?`)
        ? json({ value: [], '@odata.nextLink': 'https://boese.example/seite' })
        : json({}, 500),
    );
    const { service, mailboxes, box } = setup(withSync({}, { user: 'me', link: 'https://boese.example/gespeichert' }));

    await service.poll(box, async () => undefined);

    expect(calls.map((c) => c.url).some((url) => url.startsWith('https://boese.example'))).toBe(false);
    expect(lastState(mailboxes).error).toMatch(/Unerwartete Adresse/);
  });

  it('vermerkt Fehler mit Hinweis am Postfach', async () => {
    graphApi(() => json({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, 403));
    const { service, mailboxes, box } = setup(withSync({}, { user: 'me', link: null }));
    await service.poll(box, async () => undefined);
    expect(lastState(mailboxes).error).toMatch(/Microsoft Graph 403 ErrorAccessDenied: Access is denied\. – Kein Zugriff.*Mail\.ReadWrite/);
  });
});

describe('Ordner über Microsoft Graph', () => {
  it('liefert alle Mail-Ordner mit Pfad, den Posteingang zuerst', async () => {
    graphApi(({ url }) => {
      if (url.startsWith(`${GRAPH}/me/mailFolders/inbox?`)) return json({ id: 'in' });
      if (url.startsWith(`${GRAPH}/me/mailFolders?`)) {
        return json({
          value: [
            { id: 'del', displayName: 'Gelöschte Elemente', childFolderCount: 0 },
            { id: 'pw', displayName: 'Inbox-Patchwork', childFolderCount: 0 },
          ],
          '@odata.nextLink': `${GRAPH}/me/mailFolders/seite-2`,
        });
      }
      if (url === `${GRAPH}/me/mailFolders/seite-2`) {
        return json({ value: [{ id: 'in', displayName: 'Posteingang', childFolderCount: 1 }] });
      }
      if (url.startsWith(`${GRAPH}/me/mailFolders/in/childFolders?`)) {
        return json({ value: [{ id: 'hd', displayName: 'Helpdesk', childFolderCount: 0 }] });
      }
      return json({}, 500);
    });
    const { service, box } = setup(withSync({}, { user: 'me', link: null }));

    expect(await service.folders(box)).toEqual([
      { id: 'in', path: 'Posteingang', names: ['Posteingang'], inbox: true },
      { id: 'hd', path: 'Posteingang/Helpdesk', names: ['Posteingang', 'Helpdesk'], inbox: false },
      { id: 'del', path: 'Gelöschte Elemente', names: ['Gelöschte Elemente'], inbox: false },
      { id: 'pw', path: 'Inbox-Patchwork', names: ['Inbox-Patchwork'], inbox: false },
    ]);
  });
});

describe('Versand über Microsoft Graph', () => {
  it('sendet kleine Mails direkt als MIME', async () => {
    const calls = graphApi(() => new Response(null, { status: 202 }));
    const { service, box } = setup(withSync({}, { user: 'me', link: null }));
    const mime = Buffer.from('Message-ID: <pw.1@firma.ch>\r\nSubject: Test\r\n\r\nHallo');

    await service.send(box, { to: ['anna@firma.ch'], cc: [], subject: 'Test', html: '<p>Hallo</p>', automated: false, fromName: 'IT' }, mime, []);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${GRAPH}/me/sendMail` });
    expect(calls[0]!.headers['Content-Type']).toBe('text/plain');
    expect(Buffer.from(String(calls[0]!.body), 'base64').toString()).toBe(mime.toString());
  });

  it('sendet grosse Mails über einen Entwurf, grosse Anhänge in Teilstücken', async () => {
    const calls = graphApi(({ method, url }) => {
      if (method === 'POST' && url === `${GRAPH}/users/shared%40firma.ch/messages`) return json({ id: 'd1' }, 201);
      if (url.endsWith('/messages/d1/attachments')) return json({ id: 'att' }, 201);
      if (url.endsWith('/attachments/createUploadSession')) return json({ uploadUrl: 'https://upload.example/sitzung' }, 201);
      if (url === 'https://upload.example/sitzung') return new Response(null, { status: 200 });
      if (url.endsWith('/messages/d1/send')) return new Response(null, { status: 202 });
      return json({}, 500);
    });
    const { service, files, box } = setup(withSync({ address: 'shared@firma.ch' }, { user: 'users/shared%40firma.ch', link: null }));
    files.set('klein', Buffer.alloc(1000, 1));
    files.set('gross', Buffer.alloc(5 * 1024 * 1024, 2));
    const attachments = [
      { filename: 'klein.txt', contentType: 'text/plain', storageKey: 'klein' },
      { filename: 'gross.pdf', contentType: 'application/pdf', storageKey: 'gross' },
    ] as Attachment[];

    await service.send(
      box,
      { to: ['anna@firma.ch'], cc: ['bob@firma.ch'], subject: 'Gross', html: '<p>Anbei</p>', automated: true, fromName: 'IT' },
      Buffer.alloc(3 * 1024 * 1024),
      attachments,
    );

    const draft = JSON.parse(String(calls[0]!.body));
    expect(draft).toMatchObject({
      subject: 'Gross',
      toRecipients: [{ emailAddress: { address: 'anna@firma.ch' } }],
      ccRecipients: [{ emailAddress: { address: 'bob@firma.ch' } }],
      from: { emailAddress: { address: 'shared@firma.ch', name: 'IT' } },
      internetMessageHeaders: [{ name: 'X-Auto-Response-Suppress', value: 'All' }],
    });
    expect(JSON.parse(String(calls[1]!.body))).toMatchObject({ name: 'klein.txt', contentBytes: Buffer.alloc(1000, 1).toString('base64') });
    expect(JSON.parse(String(calls[2]!.body))).toEqual({
      AttachmentItem: { attachmentType: 'file', name: 'gross.pdf', size: 5 * 1024 * 1024, contentType: 'application/pdf' },
    });
    const uploads = calls.filter((c) => c.url === 'https://upload.example/sitzung');
    expect(uploads.map((c) => c.headers['Content-Range'])).toEqual(['bytes 0-3932159/5242880', 'bytes 3932160-5242879/5242880']);
    expect(uploads.every((c) => !('Authorization' in c.headers))).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${GRAPH}/users/shared%40firma.ch/messages/d1/send` });
  });

  it('löscht den Entwurf, wenn der Versand scheitert', async () => {
    const calls = graphApi(({ method, url }) => {
      if (method === 'POST' && url === `${GRAPH}/me/messages`) return json({ id: 'd2' }, 201);
      if (url.endsWith('/messages/d2/send')) return json({ error: { code: 'ErrorSendAsDenied', message: 'nein' } }, 403);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json({}, 500);
    });
    const { service, box } = setup(withSync({}, { user: 'me', link: null }));
    await expect(
      service.send(box, { to: ['a@firma.ch'], cc: [], subject: 'x', html: 'x', automated: false, fromName: 'IT' }, Buffer.alloc(3 * 1024 * 1024), []),
    ).rejects.toThrow(/403 ErrorSendAsDenied/);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `${GRAPH}/me/messages/d2` });
  });
});

describe('Verbindung testen über Microsoft Graph', () => {
  it('zeigt den Ordner und prüft die Berechtigung für den Versand', async () => {
    graphApi(({ url }) =>
      url.startsWith(`${GRAPH}/me/mailFolders/inbox?`)
        ? json({ displayName: 'Posteingang', totalItemCount: 12, unreadItemCount: 3 })
        : json({}, 500),
    );
    const me = withSync({}, { user: 'me', link: null });
    const full = setup(me);
    expect(await full.service.test(full.box)).toEqual({
      ok: true,
      incoming: 'OK – Ordner «Posteingang»: 12 Mails, 3 ungelesen',
      outgoing: 'OK – Versand über Microsoft Graph',
    });
    const withoutSend = setup(me, 'Mail.ReadWrite User.Read');
    expect(await withoutSend.service.test(withoutSend.box)).toMatchObject({
      ok: false,
      outgoing: expect.stringMatching(/fehlt die Berechtigung Mail\.Send/),
    });
  });
});

describe('Hilfsfunktionen', () => {
  it('liest die Rechte aus dem Token', () => {
    expect(tokenScopes(token('Mail.ReadWrite Mail.Send'))).toEqual(['Mail.ReadWrite', 'Mail.Send']);
    expect(tokenScopes('kaputt')).toEqual([]);
  });

  it('erklärt typische Fehler', () => {
    expect(graphErrorMessage(401, 'InvalidAuthenticationToken', '', 'a@b.ch')).toMatch(/neu mit Microsoft anmelden/);
    expect(graphErrorMessage(404, 'ErrorInvalidUser', 'The requested user is invalid.', 'a@b.ch')).toMatch(/Postfach a@b\.ch nicht gefunden/);
    expect(graphErrorMessage(404, 'ErrorItemNotFound', 'The specified object was not found in the store.', 'a@b.ch')).toMatch(
      /anderen Ordner wählen/,
    );
    expect(graphErrorMessage(500, 'X', 'kaputt', 'a@b.ch')).toBe('Microsoft Graph 500 X: kaputt');
  });
});
