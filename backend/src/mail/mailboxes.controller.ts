import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { MailFetcherService } from './mail-fetcher.service';
import { MailTransportService } from './mail-transport.service';
import { MailboxesService, toPublicMailbox } from './mailboxes.service';

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
  imapFolder: z.string().trim().max(255).default('INBOX'),
  smtpHost: z.string().trim().min(1, 'SMTP-Server fehlt').max(255),
  smtpPort: port,
  smtpSecurity: z.enum(['tls', 'starttls', 'none']),
  authType: z.enum(['password', 'oauth2']),
  username: z.string().trim().min(1, 'Benutzername fehlt').max(255),
  password: z.string().max(1000).optional(),
  oauthTokenUrl: optionalText,
  oauthClientId: optionalText,
  oauthClientSecret: z.string().max(1000).optional(),
  oauthScope: optionalText,
});

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
    const result = { imap: '', smtp: '', ok: true };
    try {
      const client = await this.transport.imapClient(mailbox);
      await client.connect();
      const status = await client.status(mailbox.imapFolder, { messages: true, unseen: true });
      await client.logout();
      result.imap = `OK – Ordner «${mailbox.imapFolder}»: ${status.messages ?? 0} Mails, ${status.unseen ?? 0} ungelesen`;
    } catch (err) {
      result.ok = false;
      result.imap = `Fehler: ${(err as Error & { responseText?: string }).responseText ?? (err as Error).message}`;
    }
    try {
      const transporter = await this.transport.smtpTransport(mailbox);
      await transporter.verify();
      transporter.close();
      result.smtp = 'OK';
    } catch (err) {
      result.ok = false;
      result.smtp = `Fehler: ${(err as Error).message}`;
    }
    return result;
  }

  /** Ruft das Postfach sofort ab. */
  @Post(':id/poll')
  @HttpCode(200)
  async poll(@Param('id', ParseUUIDPipe) id: string) {
    await this.fetcher.poll(await this.mailboxes.get(id));
    return toPublicMailbox(await this.mailboxes.get(id));
  }
}
