import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminOnly, Public } from '../auth/auth.decorators';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { GraphMailService } from './graph-mail.service';
import { explainMailError } from './mail-errors';
import { MailFetcherService } from './mail-fetcher.service';
import { imapFolders, type MailFolder } from './mail-folders';
import { MailTransportService } from './mail-transport.service';
import { MailboxesService, toPublicMailbox } from './mailboxes.service';
import { MicrosoftAuthService, type CallbackQuery } from './microsoft-auth.service';

const port = z.coerce.number().int().min(1).max(65535);
const optionalText = z.string().trim().max(1000).nullable().optional();

const mailboxSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(100),
  address: emailSchema,
  active: z.boolean(),
  isDefault: z.boolean(),
  imapHost: z.string().trim().min(1, 'IMAP-Server fehlt').max(255),
  imapPort: port,
  imapSecure: z.boolean(),
  imapFolder: z.string().trim().max(1000).default('INBOX'),
  /** Microsoft Graph: ID des gewählten Ordners, null = Posteingang; fehlt = unverändert */
  graphFolderId: z.string().trim().max(1000).nullable().optional(),
  smtpHost: z.string().trim().min(1, 'SMTP-Server fehlt').max(255),
  smtpPort: port,
  smtpSecurity: z.enum(['tls', 'starttls', 'none']),
  authType: z.enum(['password', 'oauth2', 'microsoft']),
  // Bei der Anmeldung mit Microsoft ist der Benutzername die Adresse des Postfachs
  username: z.string().trim().max(255).default(''),
  password: z.string().max(1000).optional(),
  oauthTokenUrl: optionalText,
  oauthClientId: optionalText,
  oauthClientSecret: z.string().max(1000).optional(),
  oauthScope: optionalText,
  /** Mails abholen ab (ISO-Zeitpunkt); fehlt = unverändert bzw. beim Anlegen ab jetzt */
  fetchFrom: z.coerce.date().optional(),
}).refine((m) => m.authType === 'microsoft' || m.username.length > 0, { message: 'Benutzername fehlt', path: ['username'] });

/** Eingefügte Adresse der Rücksprungseite nach der Anmeldung im Browser */
const browserFinishSchema = z.object({ url: z.string().trim().min(1, 'Adresse fehlt').max(8000) });

/** direct = Rücksprung zu Patchwork (nur mit HTTPS), paste = Adresse der leeren Seite einfügen */
const browserStartSchema = z.object({ mode: z.enum(['direct', 'paste']).default('direct') });

/** Rücksprung von Microsoft nach der Anmeldung im Browser (nur mit HTTPS). */
@Controller('microsoft')
export class MicrosoftCallbackController {
  constructor(private readonly microsoft: MicrosoftAuthService) {}

  /**
   * Ohne Sitzungsprüfung: Die Anmeldung ordnet «state» zu, den nur Patchwork vergeben hat, und den Code kann nur
   * Patchwork mit dem PKCE-Verifier einlösen. Danach geht der Tab zu den Postfächern.
   */
  @Public()
  @Get('callback')
  async callback(@Query() query: CallbackQuery, @Res() res: Response) {
    const result = await this.microsoft.completeCallback({
      code: typeof query.code === 'string' ? query.code : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
      error_description: typeof query.error_description === 'string' ? query.error_description : undefined,
    });
    res.redirect(303, `/admin/mailboxes?microsoft=${result.status === 'done' ? 'ok' : 'failed'}`);
  }
}

/** Aktive Postfächer zur Auswahl des Antwort-Postfachs (für IT). */
@Controller('mailboxes')
export class MailboxOptionsController {
  constructor(private readonly mailboxes: MailboxesService) {}

  /** Aktive Postfächer; «isDefault» markiert das tatsächlich verwendete Standard-Postfach. */
  @Get()
  async options() {
    const fallback = await this.mailboxes.getDefault();
    return (await this.mailboxes.list())
      .filter((m) => m.active)
      .map((m) => ({ id: m.id, name: m.name, address: m.address, isDefault: m.id === fallback?.id }));
  }
}

@AdminOnly()
@Controller('admin/mailboxes')
export class MailboxesController {
  constructor(
    private readonly mailboxes: MailboxesService,
    private readonly transport: MailTransportService,
    private readonly fetcher: MailFetcherService,
    private readonly microsoft: MicrosoftAuthService,
    private readonly graph: GraphMailService,
  ) {}

  @Get()
  async list() {
    return (await this.mailboxes.list()).map(toPublicMailbox);
  }

  @Post()
  async create(@Body(new ZodPipe(mailboxSchema)) body: z.infer<typeof mailboxSchema>) {
    return toPublicMailbox(await this.mailboxes.create(body));
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(mailboxSchema)) body: z.infer<typeof mailboxSchema>,
  ) {
    return toPublicMailbox(await this.mailboxes.update(id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.mailboxes.remove(id);
  }

  /** Prüft IMAP-Anmeldung und SMTP-Verbindung des gespeicherten Postfachs. */
  @Post(':id/test')
  @HttpCode(200)
  async test(@Param('id', ParseUUIDPipe) id: string) {
    const mailbox = await this.mailboxes.get(id);
    if (mailbox.authType === 'microsoft') {
      // Abruf und Versand über Microsoft Graph
      const graph = await this.graph.test(mailbox);
      return { imap: graph.incoming, smtp: graph.outgoing, ok: graph.ok };
    }
    const result = { imap: '', smtp: '', ok: true };
    try {
      const client = await this.transport.imapClient(mailbox);
      await client.connect();
      const status = await client.status(mailbox.imapFolder, { messages: true, unseen: true });
      await client.logout();
      result.imap = `OK – Ordner «${mailbox.imapFolder}»: ${status.messages ?? 0} Mails, ${status.unseen ?? 0} ungelesen`;
    } catch (err) {
      result.ok = false;
      const message = (err as Error & { responseText?: string }).responseText ?? (err as Error).message;
      result.imap = `Fehler: ${explainMailError(message, mailbox)}`;
    }
    try {
      const transporter = await this.transport.smtpTransport(mailbox);
      await transporter.verify();
      transporter.close();
      result.smtp = 'OK';
    } catch (err) {
      result.ok = false;
      result.smtp = `Fehler: ${explainMailError((err as Error).message, mailbox)}`;
    }
    return result;
  }

  /** Ordner des gespeicherten Postfachs zur Auswahl für den Abruf. */
  @Get(':id/folders')
  async folders(@Param('id', ParseUUIDPipe) id: string): Promise<MailFolder[]> {
    const mailbox = await this.mailboxes.get(id);
    if (mailbox.authType === 'microsoft') {
      try {
        return await this.graph.folders(mailbox);
      } catch (err) {
        throw new BadRequestException(`Ordner konnten nicht geladen werden: ${(err as Error).message}`);
      }
    }
    let client;
    try {
      client = await this.transport.imapClient(mailbox);
      await client.connect();
      const folders = await imapFolders(client);
      await client.logout();
      return folders;
    } catch (err) {
      client?.close();
      const message = (err as Error & { responseText?: string }).responseText ?? (err as Error).message;
      throw new BadRequestException(`Ordner konnten nicht geladen werden: ${explainMailError(message, mailbox)}`);
    }
  }

  /** Ruft das Postfach sofort ab. */
  @Post(':id/poll')
  @HttpCode(200)
  async poll(@Param('id', ParseUUIDPipe) id: string) {
    await this.fetcher.poll(await this.mailboxes.get(id));
    return toPublicMailbox(await this.mailboxes.get(id));
  }

  /** Startet die Anmeldung mit einem Microsoft-Konto im Browser (Adresse der Anmeldeseite). */
  @Post(':id/microsoft/browser/start')
  @HttpCode(200)
  async microsoftBrowserStart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(browserStartSchema)) body: z.infer<typeof browserStartSchema>,
  ) {
    return this.microsoft.startBrowser(await this.mailboxes.get(id), body.mode);
  }

  /** Anmeldung im Browser mit Rücksprung zu Patchwork: abgeschlossen? */
  @Get(':id/microsoft/browser/status')
  async microsoftBrowserStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.microsoft.browserStatus(await this.mailboxes.get(id));
  }

  /** Schliesst die Anmeldung im Browser mit der eingefügten Adresse der Rücksprungseite ab. */
  @Post(':id/microsoft/browser/finish')
  @HttpCode(200)
  async microsoftBrowserFinish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(browserFinishSchema)) body: z.infer<typeof browserFinishSchema>,
  ) {
    return this.microsoft.finishBrowser(await this.mailboxes.get(id), body.url);
  }

  /** Startet die Anmeldung mit einem Microsoft-Konto per Code (für microsoft.com/devicelogin). */
  @Post(':id/microsoft/start')
  @HttpCode(200)
  async microsoftStart(@Param('id', ParseUUIDPipe) id: string) {
    return this.microsoft.start(await this.mailboxes.get(id));
  }

  /** Fragt nach, ob die Anmeldung mit Microsoft abgeschlossen ist. */
  @Post(':id/microsoft/check')
  @HttpCode(200)
  async microsoftCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.microsoft.check(await this.mailboxes.get(id));
  }
}
