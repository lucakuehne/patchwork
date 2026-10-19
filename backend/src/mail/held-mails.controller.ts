import { Controller, Get, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Res } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { AdminOnly } from '../auth/auth.decorators';
import { InjectDb, type Db } from '../db/db.module';
import { heldMails, items, type HeldMail } from '../db/schema';
import { StorageService } from '../storage/storage.service';

/** Dateiname für Content-Disposition: ASCII-Ersatz und UTF-8-Variante */
const disposition = (filename: string) =>
  `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

/** Im Testbetrieb zurückgehaltene Mails: Liste, vollständige Ansicht, Originaldatei und Anhänge. */
@AdminOnly()
@Controller('admin/held-mails')
export class HeldMailsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const rows = await this.db
      .select({ mail: heldMails, number: items.number, title: items.title })
      .from(heldMails)
      .innerJoin(items, eq(items.id, heldMails.itemId))
      .orderBy(desc(heldMails.createdAt))
      .limit(500);
    return rows.map(({ mail, number, title }) => this.summary(mail, number, title));
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { mail, number, title } = await this.get(id);
    const parsed = await simpleParser(await this.storage.read(mail.storageKey));
    return {
      ...this.summary(mail, number, title),
      text: parsed.text ?? '',
      html: parsed.html || null,
      attachments: parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename ?? `Anhang ${index + 1}`,
        contentType: a.contentType,
        size: a.size,
      })),
    };
  }

  /** Die fertige Mail, wie sie versendet worden wäre. */
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
    const attachment = (await simpleParser(await this.storage.read(mail.storageKey))).attachments[index];
    if (!attachment) throw new NotFoundException('Anhang nicht gefunden');
    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition(attachment.filename ?? `Anhang ${index + 1}`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(attachment.content);
  }

  private async get(id: string) {
    const [row] = await this.db
      .select({ mail: heldMails, number: items.number, title: items.title })
      .from(heldMails)
      .innerJoin(items, eq(items.id, heldMails.itemId))
      .where(eq(heldMails.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    return row;
  }

  private summary(mail: HeldMail, number: number, title: string) {
    return {
      id: mail.id,
      createdAt: mail.createdAt,
      fromAddress: mail.fromAddress,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      automated: mail.automated,
      reply: !!mail.entryId,
      item: { number, title },
    };
  }
}
