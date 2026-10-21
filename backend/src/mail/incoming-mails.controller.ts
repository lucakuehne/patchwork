import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { incomingMails, incomingResult, items, mailboxes, users, type IncomingResult, type User } from '../db/schema';
import type { UploadedFile } from '../items/items.service';
import { StorageService } from '../storage/storage.service';
import { MailFetcherService } from './mail-fetcher.service';
import { MailSimulationService } from './mail-simulation.service';
import { disposition, mailView, sendMailAttachment } from './mail-view';

/** Ohne den Ablageschlüssel, der nur intern gebraucht wird */
const withoutKey = <T extends { storageKey: string }>({ storageKey: _, ...rest }: T) => rest;

const simulateSchema = z.object({
  replyTo: z.uuid().optional(),
  mailboxId: z.uuid().optional(),
  from: emailSchema,
  name: z.string().trim().max(200).default(''),
  subject: z.string().trim().max(500).default(''),
  text: z
    .string()
    .max(100000)
    .default('')
    .transform((s) => s.replace(/\r\n?/g, '\n')),
  automated: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Als Antwort auf diesen Vorgang (Nummer) */
  replyToItem: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),
  /** Aus dieser echten Mail erzeugt; Anhänge daraus als Liste von Indizes («0,2») */
  originalId: z.uuid().optional(),
  originalAttachments: z
    .string()
    .regex(/^(\d{1,3}(,\d{1,3})*)?$/, 'Ungültige Anhänge')
    .default('')
    .transform((s) => (s ? s.split(',').map(Number) : [])),
  discardOriginal: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/** Protokoll der eingehenden Mails: Liste, Ansicht, Originaldatei, Anhänge, erneut verarbeiten und im Testbetrieb simulieren. */
@AdminOnly()
@Controller('admin/incoming-mails')
export class IncomingMailsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly fetcher: MailFetcherService,
    private readonly simulation: MailSimulationService,
  ) {}

  /** Neueste zuerst; «result» filtert (mehrere mit Komma), «simulated» true/false nach Herkunft. */
  @Get()
  async list(@Query('result') result?: string, @Query('simulated') simulated?: string) {
    const wanted = (result ?? '').split(',').filter((r): r is IncomingResult => (incomingResult.enumValues as readonly string[]).includes(r));
    const conditions: SQL[] = [];
    if (wanted.length) conditions.push(inArray(incomingMails.result, wanted));
    if (simulated === 'true' || simulated === 'false') conditions.push(eq(incomingMails.simulated, simulated === 'true'));
    return (await this.summaries(conditions.length ? and(...conditions) : undefined, 500)).map(withoutKey);
  }

  /**
   * Testbetrieb: Vorbelegung für «Als simulierte Mail …» aus einer echten Mail, über ihre ID («id») oder ihre
   * Message-ID («messageId», die Originalmail eines Vorgangs).
   */
  @Get('draft')
  draft(@Query('id') id?: string, @Query('messageId') messageId?: string) {
    if (id !== undefined && !z.uuid().safeParse(id).success) throw new NotFoundException('Mail nicht gefunden');
    return this.simulation.draft({ id, messageId });
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const [summary] = await this.summaries(eq(incomingMails.id, id), 1);
    if (!summary) throw new NotFoundException('Mail nicht gefunden');
    // Fremdes HTML: bereinigt, externe Bilder fallen weg
    const view = await mailView(await this.read(summary.storageKey), (index) => `/api/admin/incoming-mails/${id}/attachments/${index}`, true);
    return { ...withoutKey(summary), ...view };
  }

  /** Die Mail, so wie sie abgeholt bzw. simuliert wurde. */
  @Get(':id/eml')
  async eml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const [summary] = await this.summaries(eq(incomingMails.id, id), 1);
    if (!summary) throw new NotFoundException('Mail nicht gefunden');
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', disposition(`${summary.subject || 'Mail'}.eml`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage
      .stream(summary.storageKey)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  @Get(':id/attachments/:index')
  async attachment(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number, @Res() res: Response) {
    const [summary] = await this.summaries(eq(incomingMails.id, id), 1);
    if (!summary) throw new NotFoundException('Mail nicht gefunden');
    if (!sendMailAttachment(await simpleParser(await this.read(summary.storageKey)), index, res)) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
  }

  /** Mail mit Fehler noch einmal verarbeiten. */
  @Post(':id/reprocess')
  @HttpCode(200)
  async reprocess(@Param('id', ParseUUIDPipe) id: string) {
    await this.fetcher.reprocess(id);
    const [summary] = await this.summaries(eq(incomingMails.id, id), 1);
    return withoutKey(summary!);
  }

  /** Testbetrieb: Antwort auf eine ausgehende Mail («replyTo») oder neue Mail an ein Postfach simulieren. */
  @Post('simulate')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: appConfig.maxUploadBytes, files: 20 } }))
  async simulate(
    @Body(new ZodPipe(simulateSchema)) body: z.infer<typeof simulateSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    const row = await this.simulation.simulate(user, body, files ?? []);
    const [summary] = await this.summaries(eq(incomingMails.id, row.id), 1);
    return withoutKey(summary!);
  }

  private async read(storageKey: string): Promise<Buffer> {
    try {
      return await this.storage.read(storageKey);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Die gespeicherte Mail ist nicht mehr vorhanden (Datei fehlt in der Ablage)');
      }
      throw err;
    }
  }

  private async summaries(where: SQL | undefined, limit: number) {
    const rows = await this.db
      .select({
        mail: incomingMails,
        item: { number: items.number, title: items.title },
        mailbox: { id: mailboxes.id, name: mailboxes.name, address: mailboxes.address },
        simulatedBy: users.name,
      })
      .from(incomingMails)
      .leftJoin(items, eq(items.id, incomingMails.itemId))
      .leftJoin(mailboxes, eq(mailboxes.id, incomingMails.mailboxId))
      .leftJoin(users, eq(users.id, incomingMails.simulatedById))
      .where(where)
      .orderBy(desc(incomingMails.createdAt))
      .limit(limit);
    return rows.map(({ mail, item, mailbox, simulatedBy }) => ({
      id: mail.id,
      createdAt: mail.createdAt,
      processedAt: mail.processedAt,
      mailDate: mail.mailDate,
      mailbox: mailbox?.id ? mailbox : null,
      fromAddress: mail.fromAddress,
      fromName: mail.fromName,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      result: mail.result,
      reason: mail.reason,
      attempts: mail.attempts,
      simulated: mail.simulated,
      simulatedBy,
      item: item?.number ? item : null,
      storageKey: mail.storageKey,
    }));
  }
}
