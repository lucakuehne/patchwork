import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type PgBoss from 'pg-boss';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { attachments, heldMails, mailMessages, type Mailbox } from '../db/schema';
import { BossService, QUEUE_MAIL_SEND } from '../jobs/boss.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';

export interface OutgoingMail {
  mailboxId: string;
  itemId: string;
  entryId?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachmentIds?: string[];
  /** Automatische Benachrichtigung (Auto-Submitted), keine persönliche Antwort */
  automated: boolean;
}

export function newMessageId(mailbox: Mailbox): string {
  const domain = mailbox.address.split('@')[1] ?? 'patchwork.local';
  return `<pw.${randomUUID()}@${domain}>`;
}

@Injectable()
export class MailSenderService implements OnModuleInit {
  private readonly logger = new Logger(MailSenderService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boss: BossService,
    private readonly mailboxes: MailboxesService,
    private readonly transport: MailTransportService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit() {
    await (await this.boss.boss()).work<OutgoingMail>(QUEUE_MAIL_SEND, { batchSize: 1 }, (jobs) => this.handle(jobs));
  }

  /**
   * Stellt eine Mail in die Versand-Queue. Die Message-ID wird sofort gespeichert,
   * damit Antworten auch vor dem eigentlichen Versand zugeordnet werden können.
   */
  async enqueue(mail: OutgoingMail, tx: Tx = this.db): Promise<void> {
    if (mail.to.length === 0 && mail.cc.length === 0) return;
    await tx
      .insert(mailMessages)
      .values({ messageId: mail.messageId, itemId: mail.itemId, entryId: mail.entryId ?? null, direction: 'out' })
      .onConflictDoNothing();
    await (await this.boss.boss()).send(QUEUE_MAIL_SEND, mail, { retryLimit: 10, retryDelay: 30, retryBackoff: true });
  }

  private async handle(jobs: PgBoss.Job<OutgoingMail>[]) {
    for (const job of jobs) await this.send(job.data);
  }

  private async send(mail: OutgoingMail) {
    let mailbox: Mailbox;
    try {
      mailbox = await this.mailboxes.get(mail.mailboxId);
    } catch {
      this.logger.warn(`Postfach ${mail.mailboxId} existiert nicht mehr, Mail «${mail.subject}» wird verworfen`);
      return;
    }

    const files = mail.attachmentIds?.length
      ? await this.db.select().from(attachments).where(inArray(attachments.id, mail.attachmentIds))
      : [];
    const { appName } = await this.settings.get('general');
    const message: SendMailOptions = {
      from: { name: `${mailbox.name || appName}`, address: mailbox.address },
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo ?? undefined,
      references: mail.references?.length ? mail.references : undefined,
      headers: mail.automated ? { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } : {},
      attachments: files.map((f) => ({
        filename: f.filename,
        contentType: f.contentType,
        content: this.storage.stream(f.storageKey),
      })),
      disableFileAccess: true,
      disableUrlAccess: true,
    };

    if ((await this.settings.get('mail')).testMode) {
      await this.hold(mail, mailbox, message);
      return;
    }

    const transporter = await this.transport.smtpTransport(mailbox);
    try {
      await transporter.sendMail(message);
      this.logger.log(`Mail «${mail.subject}» an ${[...mail.to, ...mail.cc].join(', ')} gesendet`);
    } catch (err) {
      this.logger.error(`Versand von «${mail.subject}» fehlgeschlagen: ${(err as Error).message}`);
      throw err;
    } finally {
      transporter.close();
    }
  }

  /** Testbetrieb: Mail fertig zusammenstellen und ablegen statt versenden. */
  private async hold(mail: OutgoingMail, mailbox: Mailbox, message: SendMailOptions) {
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message);
    const storageKey = await this.storage.save(built.message as Buffer, 'eml');
    await this.db
      .insert(heldMails)
      .values({
        messageId: mail.messageId,
        itemId: mail.itemId,
        entryId: mail.entryId ?? null,
        mailboxId: mailbox.id,
        fromAddress: mailbox.address,
        to: mail.to,
        cc: mail.cc,
        subject: mail.subject,
        automated: mail.automated,
        storageKey,
      })
      .onConflictDoNothing();
    this.logger.log(`Testbetrieb: Mail «${mail.subject}» an ${[...mail.to, ...mail.cc].join(', ')} nicht versendet`);
  }
}
