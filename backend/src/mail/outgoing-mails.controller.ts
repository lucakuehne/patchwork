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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { Audit, NoAudit } from '../audit/audit.decorators';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { safeFileName, uniqueNames, zipFiles } from '../common/zip';
import { ZodPipe } from '../common/zod.pipe';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { items, outgoingMails, type ItemType, type OutgoingMailRow, type User } from '../db/schema';
import { DEFAULT_PREFIX, itemRef } from '../items/item-ref';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { MAIL_RETRY_LIMITS } from './mail-retry';
import { MailSenderService } from './mail-sender.service';
import { disposition, mailAttachmentPreview, mailView, sendMailAttachment } from './mail-view';

const STATUSES = ['queued', 'sent', 'partial', 'held', 'failed', 'waiting'] as const;
type Status = (typeof STATUSES)[number];

/** Ausgewählte Mails für Massenaktionen (höchstens so viele, wie die Liste zeigt) */
const idsSchema = z.object({ ids: z.array(z.uuid()).min(1, 'Keine Mail ausgewählt').max(500) });

const minutes = (label: string) =>
  z
    .number()
    .int(`${label}: bitte ganze Minuten angeben`)
    .min(MAIL_RETRY_LIMITS.minutes.min, `${label}: mindestens ${MAIL_RETRY_LIMITS.minutes.min} Minute`)
    .max(MAIL_RETRY_LIMITS.minutes.max, `${label}: höchstens ${MAIL_RETRY_LIMITS.minutes.max} Minuten`);
const retrySchema = z.object({
  retries: z
    .number()
    .int('Anzahl Wiederholungen: bitte eine ganze Zahl')
    .min(MAIL_RETRY_LIMITS.retries.min)
    .max(MAIL_RETRY_LIMITS.retries.max, `Höchstens ${MAIL_RETRY_LIMITS.retries.max} Wiederholungen`),
  firstDelayMinutes: minutes('Erster Abstand'),
  doubling: z.boolean(),
  maxDelayMinutes: minutes('Höchster Abstand'),
});

/** Kurzfassung einer Massenaktion fürs Aktionsprotokoll */
const bulkAction = (label: string) => (c: { result: unknown }) => {
  const r = c.result as { done: number; skipped: number };
  return `${label}: ${r.done}${r.skipped ? `, ${r.skipped} übersprungen` : ''}`;
};

/** Protokoll aller ausgehenden Mails: Liste, vollständige Ansicht, Originaldatei, Anhänge und «Erneut senden». */
@AdminOnly()
@Controller('admin/outgoing-mails')
export class OutgoingMailsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly sender: MailSenderService,
    private readonly settings: SettingsService,
  ) {}

  /** Wiederholungen beim Versand (Entscheid vom 13.11.2026) */
  @Get('retry-settings')
  retrySettings() {
    return this.settings.get('mailRetry');
  }

  /** Gilt sofort, auch für Mails, die auf ihren nächsten Versuch warten. */
  @Audit('admin', 'Wiederholungen beim Versand geändert')
  @Put('retry-settings')
  async saveRetrySettings(@Body(new ZodPipe(retrySchema)) body: z.infer<typeof retrySchema>) {
    await this.settings.set('mailRetry', body);
    await this.sender.applyRetrySettings(body);
    return body;
  }

  /** Massenaktion «Erneut senden»: nur fehlgeschlagene, die übrigen werden übersprungen. */
  @Audit('admin', bulkAction('Mails erneut gesendet'))
  @Post('bulk/resend')
  @HttpCode(200)
  async resendMany(@Body(new ZodPipe(idsSchema)) body: z.infer<typeof idsSchema>, @CurrentUser() user: User) {
    return this.sender.resendMany(body.ids, user.name);
  }

  @Audit('admin', bulkAction('Fehlgeschlagene Mails als erledigt markiert'))
  @Post('bulk/dismiss')
  @HttpCode(200)
  async dismissMany(@Body(new ZodPipe(idsSchema)) body: z.infer<typeof idsSchema>) {
    return this.sender.dismissMany(body.ids);
  }

  /**
   * Massenaktion «Als .eml herunterladen»: die gewählten Mails als ZIP, je Mail «PW-123 Betreff.eml». Fehlt eine
   * gespeicherte Datei, steht sie in «Nicht gefunden.txt».
   */
  @NoAudit()
  @Post('bulk/eml')
  @HttpCode(200)
  async emlZip(@Body(new ZodPipe(idsSchema)) body: z.infer<typeof idsSchema>, @Res() res: Response) {
    const rows = await this.db
      .select({ mail: outgoingMails, prefix: items.prefix, number: items.number })
      .from(outgoingMails)
      .leftJoin(items, eq(items.id, outgoingMails.itemId))
      .where(inArray(outgoingMails.id, body.ids))
      .orderBy(desc(outgoingMails.createdAt));
    const files: { name: string; data: Buffer; date: Date }[] = [];
    const missing: string[] = [];
    for (const { mail, prefix, number } of rows) {
      const ref = number !== null ? itemRef({ prefix: prefix ?? DEFAULT_PREFIX, number }) : 'Ohne Vorgang';
      // Die Kennung steht vorne, also nicht noch einmal aus dem Betreff («[PW-123] …»)
      const subject = mail.subject.replace(`[${ref}]`, '').trim() || '(ohne Betreff)';
      const name = `${safeFileName(`${ref} ${subject}`)}.eml`;
      try {
        files.push({ name, data: await this.storage.read(mail.storageKey), date: mail.createdAt });
      } catch {
        missing.push(name);
      }
    }
    const names = uniqueNames(files.map((f) => f.name));
    const entries = files.map((f, i) => ({ ...f, name: names[i]! }));
    if (missing.length) {
      entries.push({ name: 'Nicht gefunden.txt', data: Buffer.from(`Datei fehlt in der Ablage:\r\n${missing.join('\r\n')}\r\n`), date: new Date() });
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: appConfig.timeZone }).format(new Date());
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', disposition(`Ausgehende Mails ${today}.zip`));
    res.end(zipFiles(entries));
  }

  /** Neueste zuerst; «status» filtert, mehrere mit Komma (z.B. «partial,held»). */
  @Get()
  async list(@Query('status') status?: string) {
    const wanted = (status ?? '').split(',').filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
    const rows = await this.db
      .select({ mail: outgoingMails, prefix: items.prefix, number: items.number, title: items.title, type: items.type })
      .from(outgoingMails)
      .leftJoin(items, eq(items.id, outgoingMails.itemId))
      .where(wanted.length ? inArray(outgoingMails.status, wanted) : undefined)
      .orderBy(desc(outgoingMails.createdAt))
      .limit(500);
    return rows.map(({ mail, prefix, number, title, type }) => this.summary(mail, prefix, number, title, type));
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { mail, prefix, number, title, type } = await this.get(id);
    // Eigenes HTML; eingebettete Bilder («cid:») zeigen auf die Anhänge der gespeicherten Mail
    const view = await mailView(await this.read(mail), (index) => `/api/admin/outgoing-mails/${mail.id}/attachments/${index}`, false);
    // Wartet sie, auf welche ältere Mail des Postfachs (Reihenfolge, Entscheid vom 13.11.2026)
    const waitingFor = mail.status === 'waiting' ? await this.sender.waitingFor({ id: mail.id }) : null;
    return { ...this.summary(mail, prefix, number, title, type), ...view, waitingFor };
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

  /** Anhang der Mail; «inline=1» zeigt Bilder und PDF im Browser an (Vorschau). */
  @Get(':id/attachments/:index')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ) {
    const { mail } = await this.get(id);
    if (!sendMailAttachment(await simpleParser(await this.read(mail)), index, res, inline === '1')) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
  }

  @Get(':id/attachments/:index/preview')
  async attachmentPreview(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const { mail } = await this.get(id);
    return mailAttachmentPreview(await simpleParser(await this.read(mail)), index);
  }

  /** Fehlgeschlagene Mail noch einmal versenden. */
  @Audit('admin', 'Mail erneut gesendet', { target: 'outgoingMail' })
  @Post(':id/resend')
  @HttpCode(204)
  async resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.sender.resend(id, user.name);
  }

  /** Fehlgeschlagene Mail als erledigt markieren (Hinweis an die Admins verschwindet). */
  @Audit('admin', 'Fehlgeschlagene Mail als erledigt markiert', { target: 'outgoingMail' })
  @Post(':id/dismiss')
  @HttpCode(204)
  async dismiss(@Param('id', ParseUUIDPipe) id: string) {
    await this.sender.dismiss(id);
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
      .select({ mail: outgoingMails, prefix: items.prefix, number: items.number, title: items.title, type: items.type })
      .from(outgoingMails)
      .leftJoin(items, eq(items.id, outgoingMails.itemId))
      .where(eq(outgoingMails.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    return row;
  }

  /** «item» null: Mail ohne Vorgang (Willkommens-Mail) */
  private summary(mail: OutgoingMailRow, prefix: string | null, number: number | null, title: string | null, type: ItemType | null) {
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
      /** Fehlgeschlagen, aber als erledigt markiert */
      dismissedAt: mail.dismissedAt,
      attempts: mail.attempts,
      /** Zustellversuche, ältester zuerst (seit 13.11.2026), und der nächste automatische Versuch */
      attemptLog: mail.attemptLog,
      nextAttemptAt: mail.nextAttemptAt,
      reply: !!mail.entryId,
      template: mail.template,
      item: number !== null ? { prefix: prefix ?? DEFAULT_PREFIX, number, title: title ?? '', type } : null,
    };
  }
}
