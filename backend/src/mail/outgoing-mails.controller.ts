import { Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { AdminOnly } from '../auth/auth.decorators';
import { InjectDb, type Db } from '../db/db.module';
import { items, outgoingMails, type OutgoingMailRow } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { MailSenderService } from './mail-sender.service';
import { disposition, mailView, sendMailAttachment } from './mail-view';

const STATUSES = ['queued', 'sent', 'partial', 'held', 'failed'] as const;
type Status = (typeof STATUSES)[number];

/** Protokoll aller ausgehenden Mails: Liste, vollständige Ansicht, Originaldatei, Anhänge und «Erneut senden». */
@AdminOnly()
@Controller('admin/outgoing-mails')
export class OutgoingMailsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly sender: MailSenderService,
  ) {}

  /** Neueste zuerst; «status» filtert, mehrere mit Komma (z.B. «partial,held»). */
  @Get()
  async list(@Query('status') status?: string) {
    const wanted = (status ?? '').split(',').filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
    const rows = await this.db
      .select({ mail: outgoingMails, number: items.number, title: items.title })
      .from(outgoingMails)
      .innerJoin(items, eq(items.id, outgoingMails.itemId))
      .where(wanted.length ? inArray(outgoingMails.status, wanted) : undefined)
      .orderBy(desc(outgoingMails.createdAt))
      .limit(500);
    return rows.map(({ mail, number, title }) => this.summary(mail, number, title));
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { mail, number, title } = await this.get(id);
    // Eigenes HTML; eingebettete Bilder («cid:») zeigen auf die Anhänge der gespeicherten Mail
    const view = await mailView(await this.read(mail), (index) => `/api/admin/outgoing-mails/${mail.id}/attachments/${index}`, false);
    return { ...this.summary(mail, number, title), ...view };
  }

  /** Die vollständige Mail, so wie sie ohne Testbetrieb versendet wird. */
  @Get(':id/eml')
  async eml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { mail } = await this.get(id);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', disposition(`${mail.subject || 'Mail'}.eml`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage
      .stream(mail.storageKey)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  @Get(':id/attachments/:index')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    const { mail } = await this.get(id);
    if (!sendMailAttachment(await simpleParser(await this.read(mail)), index, res)) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
  }

  /** Fehlgeschlagene Mail noch einmal versenden. */
  @Post(':id/resend')
  @HttpCode(204)
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    await this.sender.resend(id);
  }

  /** Die gespeicherte Mail (.eml); fehlt die Datei, eine verständliche Meldung statt Fehler 500. */
  private async read(mail: OutgoingMailRow): Promise<Buffer> {
    try {
      return await this.storage.read(mail.storageKey);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Die gespeicherte Mail ist nicht mehr vorhanden (Datei fehlt in der Ablage)');
      }
      throw err;
    }
  }

  private async get(id: string) {
    const [row] = await this.db
      .select({ mail: outgoingMails, number: items.number, title: items.title })
      .from(outgoingMails)
      .innerJoin(items, eq(items.id, outgoingMails.itemId))
      .where(eq(outgoingMails.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    return row;
  }

  private summary(mail: OutgoingMailRow, number: number, title: string) {
    return {
      id: mail.id,
      createdAt: mail.createdAt,
      sentAt: mail.sentAt,
      status: mail.status,
      fromAddress: mail.fromAddress,
      to: mail.to,
      cc: mail.cc,
      /** An diese Empfänger ging die Mail tatsächlich */
      deliveredTo: mail.deliveredTo,
      subject: mail.subject,
      automated: mail.automated,
      error: mail.error,
      attempts: mail.attempts,
      reply: !!mail.entryId,
      item: { number, title },
    };
  }
}
