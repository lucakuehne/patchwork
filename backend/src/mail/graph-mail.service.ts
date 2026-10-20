import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { mailMessages, type Attachment, type GraphSync, type Mailbox } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { sortFolders, type MailFolder } from './mail-folders';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Neue Mails pro Abruf; verarbeitet wird immer eine ganze Seite der Delta-Abfrage. */
const BATCH_SIZE = 50;
/** Seiten der Delta-Abfrage pro Abruf, auch wenn sie nur bekannte Mails enthalten */
const MAX_PAGES = 20;
const PAGE_SIZE = { Prefer: 'odata.maxpagesize=50' };
/** Obergrenze für die Ordnerliste */
const MAX_FOLDERS = 1000;
/** Graph nimmt höchstens 4 MB pro Anfrage; die fertige Mail geht base64-kodiert hinein. */
const MIME_LIMIT = 3_500_000;
/** Anhänge ab 3 MB müssen über eine Upload-Sitzung hochgeladen werden. */
const SMALL_ATTACHMENT = 3 * 1024 * 1024;
/** Teilstücke der Upload-Sitzung: unter 4 MB und ein Vielfaches von 320 KiB. */
const UPLOAD_CHUNK = 12 * 320 * 1024;

/** Angaben einer ausgehenden Mail für den Versand über einen Entwurf (grosse Mails). */
export interface GraphOutgoing {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  automated: boolean;
  fromName: string;
}

interface DeltaPage {
  value: { id: string; receivedDateTime?: string; internetMessageId?: string; '@removed'?: unknown }[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

interface GraphFolder {
  id: string;
  displayName: string;
  childFolderCount: number;
}

/** Der Stand der Delta-Abfrage gilt nur für diese Adresse, diesen Ordner, diesen Startzeitpunkt und dieses Konto. */
export function graphSyncKey(mailbox: Mailbox): string {
  return JSON.stringify([
    mailbox.address,
    mailbox.graphFolderId ?? mailbox.imapFolder,
    mailbox.fetchFrom.toISOString(),
    mailbox.oauthAccount ?? '',
  ]);
}

/** Meldung zu einem Fehler von Microsoft Graph, mit Hinweis, was zu tun ist. */
export function graphErrorMessage(status: number, code: string, detail: string, address: string): string {
  const base = `Microsoft Graph ${status}${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}`;
  if (status === 401) return `${base} – Die Anmeldung ist ungültig. Bitte unter Verwaltung → Postfächer neu mit Microsoft anmelden.`;
  if (status === 403 || code === 'ErrorAccessDenied') {
    return (
      `${base} – Kein Zugriff: In der App-Registrierung müssen unter Microsoft Graph die delegierten Berechtigungen ` +
      'Mail.ReadWrite und Mail.Send (bei freigegebenen Postfächern zusätzlich Mail.ReadWrite.Shared und Mail.Send.Shared) ' +
      'mit Administratorzustimmung eingetragen sein. Bei einem freigegebenen Postfach braucht das angemeldete Konto zudem ' +
      'Vollzugriff und «Senden als».'
    );
  }
  if (code === 'MailboxNotEnabledForRESTAPI') {
    return `${base} – Das Postfach ist für Microsoft Graph nicht verfügbar, z.B. weil es nicht in Exchange Online liegt.`;
  }
  if (status === 404 && code === 'ErrorItemNotFound') {
    return `${base} – Nicht gefunden. Wurde der gewählte Ordner gelöscht, beim Postfach einen anderen Ordner wählen.`;
  }
  if (status === 404 && /ErrorInvalidUser|ResourceNotFound|user|mailbox/i.test(`${code} ${detail}`)) {
    return `${base} – Postfach ${address} nicht gefunden. Bei einem freigegebenen Postfach dessen Hauptadresse eintragen.`;
  }
  if (status === 429) return `${base} – Microsoft bremst die Anfragen. Patchwork versucht es später wieder.`;
  return base;
}

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    address: string,
  ) {
    super(graphErrorMessage(status, code, detail, address));
  }
}

/** Rechte im Access-Token (scp), z.B. ['Mail.ReadWrite', 'Mail.Send']. */
export function tokenScopes(token: string): string[] {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { scp?: string };
    return (claims.scp ?? '').split(' ').filter(Boolean);
  } catch {
    return [];
  }
}

const wholeSecond = (d: Date) => new Date(Math.floor(d.getTime() / 1000) * 1000);
const isGraphUrl = (url: string | null | undefined): url is string => !!url?.startsWith(`${GRAPH}/`);

/**
 * Abruf und Versand für Postfächer mit angemeldetem Microsoft-Konto über Microsoft Graph, ohne IMAP und SMTP.
 * Patchwork liest nur: Mails bleiben ungelesen, nichts wird verschoben oder gelöscht. Nur grosse ausgehende Mails
 * entstehen kurz als Entwurf, weil Graph Anhänge über 3 MB nicht direkt annimmt.
 */
@Injectable()
export class GraphMailService {
  private readonly logger = new Logger(GraphMailService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly transport: MailTransportService,
    private readonly mailboxes: MailboxesService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Holt neue Mails über die Delta-Abfrage des Ordners und übergibt sie einzeln als MIME. Graph meldet jede Mail, die
   * neu im Ordner liegt, auch wenn sie erst später hineinverschoben wurde. Der erste Durchgang liefert alle Mails ab
   * «Mails abholen ab»; bekannte Message-IDs werden übersprungen.
   */
  async poll(mailbox: Mailbox, ingest: (raw: Buffer) => Promise<unknown>): Promise<void> {
    const key = graphSyncKey(mailbox);
    // Ein Stand zu anderen Einstellungen (z.B. von einem Abruf, der beim Speichern noch lief) gilt nicht
    const stored = mailbox.graphSync?.key === key ? mailbox.graphSync : null;
    let sync: GraphSync | null = stored && { ...stored, link: isGraphUrl(stored.link) ? stored.link : null };
    let error: string | null = null;
    try {
      const token = await this.transport.graphToken(mailbox);
      const user = sync?.user ?? (await this.mailboxUser(mailbox, token));
      sync = { key, user, link: sync?.link ?? null };
      const start = wholeSecond(mailbox.fetchFrom);
      let url = sync.link ?? (await this.deltaStart(mailbox, token, user));
      // Ein abgelaufener Stand oder ein gelöschter Ordner zeigt sich erst beim Aufruf: dann einmal von vorne beginnen
      let restarted = !sync.link;
      let processed = 0;
      for (let page = 0; page < MAX_PAGES && processed < BATCH_SIZE; ) {
        let data: DeltaPage;
        try {
          data = await this.json<DeltaPage>(token, mailbox, url, 'GET', undefined, PAGE_SIZE);
        } catch (err) {
          if (restarted || !(err instanceof GraphError) || ![400, 404, 410].includes(err.status)) throw err;
          restarted = true;
          sync = { ...sync, link: null };
          url = await this.deltaStart(mailbox, token, user);
          continue;
        }
        page++;
        for (const message of data.value) {
          if (message['@removed']) continue;
          const received = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
          if (received && received < start) continue;
          if (message.internetMessageId && (await this.known(message.internetMessageId))) continue;
          // Fehlt die Mail inzwischen (verschoben oder gelöscht), gibt es nichts mehr zu übernehmen
          const raw = await this.raw(token, mailbox, `${GRAPH}/${user}/messages/${message.id}/$value`);
          if (raw) {
            try {
              await ingest(raw);
            } catch (err) {
              error = `Mail vom ${received?.toISOString() ?? '?'}: ${(err as Error).message}`;
              this.logger.error(`Verarbeitung einer Mail in ${mailbox.address} fehlgeschlagen`, (err as Error).stack);
            }
          }
          processed++;
        }
        const next = data['@odata.nextLink'];
        const link = next ?? data['@odata.deltaLink'] ?? null;
        // Das Token geht nur an Microsoft Graph
        if (link && !isGraphUrl(link)) throw new Error(`Unerwartete Adresse von Microsoft Graph: ${link}`);
        sync = { ...sync, link };
        if (!next) break;
        url = next;
      }
    } catch (err) {
      error = (err as Error).message;
      this.logger.warn(`Abruf von ${mailbox.address} fehlgeschlagen: ${error}`);
    }
    await this.mailboxes.recordGraphPoll(mailbox.id, { sync, error });
  }

  /** Mail-Ordner des Postfachs zur Auswahl, ohne versteckte Ordner. */
  async folders(mailbox: Mailbox): Promise<MailFolder[]> {
    const token = await this.transport.graphToken(mailbox);
    const user = await this.mailboxPath(mailbox, token);
    const inbox: { id: string } = await this.json(token, mailbox, `${GRAPH}/${user}/mailFolders/inbox?$select=id`);
    const folders: MailFolder[] = [];
    const select = '$select=id,displayName,childFolderCount&$top=100';
    const walk = async (url: string, parents: string[]): Promise<void> => {
      for (let next: string | undefined = url; next && folders.length < MAX_FOLDERS; ) {
        const page: { value: GraphFolder[]; '@odata.nextLink'?: string } = await this.json(token, mailbox, next);
        for (const folder of page.value) {
          if (folders.length >= MAX_FOLDERS) return;
          const names = [...parents, folder.displayName];
          folders.push({ id: folder.id, path: names.join('/'), names, inbox: folder.id === inbox.id });
          if (folder.childFolderCount > 0) {
            await walk(`${GRAPH}/${user}/mailFolders/${encodeURIComponent(folder.id)}/childFolders?${select}`, names);
          }
        }
        next = page['@odata.nextLink'];
      }
    };
    await walk(`${GRAPH}/${user}/mailFolders?${select}`, []);
    return sortFolders(folders);
  }

  /** Versendet eine fertige Mail (MIME). Grosse Mails gehen über einen Entwurf mit einzeln hochgeladenen Anhängen. */
  async send(mailbox: Mailbox, mail: GraphOutgoing, mime: Buffer, files: Attachment[]): Promise<void> {
    const token = await this.transport.graphToken(mailbox);
    const base = await this.mailboxPath(mailbox, token);
    const encoded = mime.toString('base64');
    if (encoded.length <= MIME_LIMIT) {
      await this.request(token, mailbox, 'POST', `${GRAPH}/${base}/sendMail`, encoded, 'text/plain');
      return;
    }

    const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
    const draft: { id: string } = await this.json(token, mailbox, `${GRAPH}/${base}/messages`, 'POST', {
      subject: mail.subject,
      body: { contentType: 'HTML', content: mail.html },
      toRecipients: recipients(mail.to),
      ccRecipients: recipients(mail.cc),
      ...(base === 'me' ? {} : { from: { emailAddress: { address: mailbox.address, name: mail.fromName } } }),
      ...(mail.automated ? { internetMessageHeaders: [{ name: 'X-Auto-Response-Suppress', value: 'All' }] } : {}),
    });
    const draftUrl = `${GRAPH}/${base}/messages/${draft.id}`;
    try {
      for (const file of files) {
        const content = await this.storage.read(file.storageKey);
        // Bilder im Text eingebettet (Content-ID), übrige als Anhang
        const inline = file.contentId ? { isInline: true, contentId: file.contentId } : {};
        if (content.length < SMALL_ATTACHMENT) {
          await this.json(token, mailbox, `${draftUrl}/attachments`, 'POST', {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: file.filename,
            contentType: file.contentType,
            contentBytes: content.toString('base64'),
            ...inline,
          });
        } else {
          const session: { uploadUrl: string } = await this.json(token, mailbox, `${draftUrl}/attachments/createUploadSession`, 'POST', {
            AttachmentItem: { attachmentType: 'file', name: file.filename, size: content.length, contentType: file.contentType, ...inline },
          });
          await this.upload(session.uploadUrl, content);
        }
      }
      await this.request(token, mailbox, 'POST', `${draftUrl}/send`);
    } catch (err) {
      // Keine halbfertigen Entwürfe im Postfach liegen lassen
      await this.request(token, mailbox, 'DELETE', draftUrl).catch(() => undefined);
      throw err;
    }
  }

  /** Prüft Zugriff auf den Ordner und die Berechtigung für den Versand. */
  async test(mailbox: Mailbox): Promise<{ ok: boolean; incoming: string; outgoing: string }> {
    try {
      const token = await this.transport.graphToken(mailbox);
      const base = await this.mailboxPath(mailbox, token);
      const folder = await this.folderPath(mailbox, token, base);
      const info: { displayName: string; totalItemCount: number; unreadItemCount: number } = await this.json(
        token,
        mailbox,
        `${GRAPH}/${base}/${folder}?$select=displayName,totalItemCount,unreadItemCount`,
      );
      const incoming = `OK – Ordner «${info.displayName}»: ${info.totalItemCount} Mails, ${info.unreadItemCount} ungelesen`;
      const scopes = tokenScopes(token);
      const shared = base !== 'me';
      const send = shared ? 'Mail.Send.Shared' : 'Mail.Send';
      const write = shared ? 'Mail.ReadWrite.Shared' : 'Mail.ReadWrite';
      if (!scopes.includes(send)) {
        return {
          ok: false,
          incoming,
          outgoing: `Fehler: Für den Versand fehlt die Berechtigung ${send} (Microsoft Graph, delegiert, mit Administratorzustimmung).`,
        };
      }
      const outgoing = scopes.includes(write)
        ? 'OK – Versand über Microsoft Graph'
        : `OK – Versand über Microsoft Graph; für Mails über 3 MB fehlt noch die Berechtigung ${write}`;
      return { ok: true, incoming, outgoing };
    } catch (err) {
      return { ok: false, incoming: `Fehler: ${(err as Error).message}`, outgoing: '–' };
    }
  }

  /** Pfad zum Postfach aus dem Stand des Abrufs, sonst neu ermittelt. */
  private async mailboxPath(mailbox: Mailbox, token: string): Promise<string> {
    const sync = mailbox.graphSync;
    return sync && sync.key === graphSyncKey(mailbox) ? sync.user : this.mailboxUser(mailbox, token);
  }

  /** «me», wenn das angemeldete Konto selbst das Postfach ist (auch über eine weitere Adresse), sonst «users/<adresse>». */
  private async mailboxUser(mailbox: Mailbox, token: string): Promise<string> {
    const me: { userPrincipalName?: string; mail?: string; proxyAddresses?: string[] } = await this.json(
      token,
      mailbox,
      `${GRAPH}/me?$select=userPrincipalName,mail,proxyAddresses`,
    );
    const own = [me.userPrincipalName, me.mail, ...(me.proxyAddresses ?? []).map((a) => a.replace(/^smtp:/i, ''))]
      .filter((a): a is string => !!a)
      .map((a) => a.toLowerCase());
    return own.includes(mailbox.address.toLowerCase()) ? 'me' : `users/${encodeURIComponent(mailbox.address)}`;
  }

  /** Erster Aufruf der Delta-Abfrage: alle Mails im Ordner ab «Mails abholen ab». */
  private async deltaStart(mailbox: Mailbox, token: string, user: string): Promise<string> {
    const folder = await this.folderPath(mailbox, token, user);
    const filter = encodeURIComponent(`receivedDateTime ge ${wholeSecond(mailbox.fetchFrom).toISOString()}`);
    return `${GRAPH}/${user}/${folder}/messages/delta?$filter=${filter}&$select=receivedDateTime,internetMessageId`;
  }

  /**
   * Gewählter Ordner über seine ID. Ohne Auswahl (frühere Einstellung): «INBOX» ist der Posteingang, sonst ein Pfad
   * aus Anzeigenamen, z.B. «Posteingang/Helpdesk».
   */
  private async folderPath(mailbox: Mailbox, token: string, base: string): Promise<string> {
    if (mailbox.graphFolderId) return `mailFolders/${encodeURIComponent(mailbox.graphFolderId)}`;
    const name = mailbox.imapFolder.trim();
    if (!name || /^inbox$/i.test(name)) return 'mailFolders/inbox';
    let parent = 'mailFolders/msgfolderroot';
    for (const part of name.split('/').map((p) => p.trim()).filter(Boolean)) {
      const filter = encodeURIComponent(`displayName eq '${part.replace(/'/g, "''")}'`);
      const found: { value: { id: string }[] } = await this.json(
        token,
        mailbox,
        `${GRAPH}/${base}/${parent}/childFolders?$filter=${filter}&$select=id`,
      );
      if (!found.value[0]) throw new Error(`Ordner «${name}» im Postfach ${mailbox.address} nicht gefunden`);
      parent = `mailFolders/${found.value[0].id}`;
    }
    return parent;
  }

  private async known(messageId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: mailMessages.messageId })
      .from(mailMessages)
      .where(eq(mailMessages.messageId, messageId))
      .limit(1);
    return !!row;
  }

  private async raw(token: string, mailbox: Mailbox, url: string): Promise<Buffer | null> {
    try {
      return Buffer.from(await (await this.request(token, mailbox, 'GET', url)).arrayBuffer());
    } catch (err) {
      if (err instanceof GraphError && err.status === 404) return null;
      throw err;
    }
  }

  /** Lädt einen grossen Anhang in Teilstücken hoch; die Adresse der Upload-Sitzung enthält ihre eigene Berechtigung. */
  private async upload(uploadUrl: string, content: Buffer): Promise<void> {
    for (let start = 0; start < content.length; start += UPLOAD_CHUNK) {
      const chunk = content.subarray(start, Math.min(start + UPLOAD_CHUNK, content.length));
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${content.length}`,
        },
        body: chunk,
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Hochladen eines Anhangs fehlgeschlagen (Microsoft Graph ${response.status})`);
    }
  }

  private async json<T>(
    token: string,
    mailbox: Mailbox,
    url: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await this.request(
      token,
      mailbox,
      method,
      url,
      body === undefined ? undefined : JSON.stringify(body),
      'application/json',
      headers,
    );
    return (await response.json()) as T;
  }

  private async request(
    token: string,
    mailbox: Mailbox,
    method: string,
    url: string,
    body?: string,
    contentType = 'application/json',
    headers: Record<string, string> = {},
  ): Promise<Response> {
    // Das Token geht nur an Microsoft Graph, auch bei Adressen aus Antworten (nächste Seite)
    if (!isGraphUrl(url)) throw new Error(`Unerwartete Adresse für Microsoft Graph: ${url}`);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': contentType } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new GraphError(response.status, data.error?.code ?? '', data.error?.message ?? '', mailbox.address);
    }
    return response;
  }
}
