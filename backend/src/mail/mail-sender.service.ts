import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type PgBoss from 'pg-boss';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { attachments, mailMessages, outgoingMails, users, type Attachment, type Mailbox } from '../db/schema';
import { BossService, QUEUE_MAIL_SEND } from '../jobs/boss.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { GraphMailService } from './graph-mail.service';
import { explainMailError } from './mail-errors';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';
import { deliveryFilter, isLive } from './test-delivery';

export interface OutgoingMail {
  mailboxId: string;
  /** null = Mail ohne Vorgang (Willkommens-Mail) */
  itemId: string | null;
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
  /** Vorlage, aus der die Mail entstand (z.B. «done»), für den Verlauf des Vorgangs */
  template?: string;
  /** Weiterer Vorgang, in dessen Verlauf die Mail erscheint (Duplikat-Hinweis: das Duplikat) */
  relatedItemId?: string | null;
}

export function newMessageId(mailbox: Mailbox): string {
  const domain = mailbox.address.split('@')[1] ?? 'patchwork.local';
  return `<pw.${randomUUID()}@${domain}>`;
}

/** Stellt die Mail fertig zusammen (MIME), so wie sie versendet würde. */
async function buildMime(message: SendMailOptions): Promise<Buffer> {
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message);
  return built.message as Buffer;
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
    private readonly graph: GraphMailService,
  ) {}

  async onModuleInit() {
    await (await this.boss.boss()).work<OutgoingMail>(QUEUE_MAIL_SEND, { batchSize: 1 }, (jobs) => this.handle(jobs));
  }

  /**
   * Stellt eine Mail in die Versand-Queue. Die Message-ID wird sofort gespeichert,
   * damit Antworten auch vor dem eigentlichen Versand zugeordnet werden können. Ins Protokoll kommt die Mail ebenfalls
   * sofort («wird versendet»), damit sie gleich nach der Aktion im Verlauf des Vorgangs steht.
   */
  async enqueue(mail: OutgoingMail, tx: Tx = this.db): Promise<void> {
    if (mail.to.length === 0 && mail.cc.length === 0) return;
    // Für die Zuordnung von Antworten; Mails ohne Vorgang haben nichts zuzuordnen
    if (mail.itemId) {
      await tx
        .insert(mailMessages)
        .values({ messageId: mail.messageId, itemId: mail.itemId, entryId: mail.entryId ?? null, direction: 'out' })
        .onConflictDoNothing();
    }
    await this.record(mail, tx);
    await (await this.boss.boss()).send(QUEUE_MAIL_SEND, mail, { retryLimit: 10, retryDelay: 30, retryBackoff: true });
  }

  /**
   * Protokoll-Eintrag beim Einreihen: die vollständige Mail (.eml), Status «wird versendet», noch kein Versuch.
   * Gelingt das nicht (z.B. Postfach entfernt), legt der Versand den Eintrag an.
   */
  private async record(mail: OutgoingMail, tx: Tx): Promise<void> {
    try {
      const mailbox = await this.mailboxes.get(mail.mailboxId);
      const { build } = await this.compose(mail, mailbox);
      const storageKey = await this.storage.save(await buildMime(build(mail.to, mail.cc)), 'eml');
      await tx.insert(outgoingMails).values(this.logValues(mail, mailbox, storageKey, 0)).onConflictDoNothing();
    } catch (err) {
      this.logger.warn(`Mail «${mail.subject}» kommt erst beim Versand ins Protokoll: ${(err as Error).message}`);
    }
  }

  private async handle(jobs: PgBoss.Job<OutgoingMail>[]) {
    for (const job of jobs) await this.send(job.data);
  }

  /** Eine fehlgeschlagene Mail noch einmal in die Versand-Queue stellen. */
  async resend(id: string): Promise<void> {
    const [row] = await this.db.select().from(outgoingMails).where(eq(outgoingMails.id, id)).limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    if (row.status !== 'failed' || !row.payload) throw new BadRequestException('Erneut senden geht nur bei fehlgeschlagenen Mails');
    await this.db.update(outgoingMails).set({ status: 'queued' }).where(eq(outgoingMails.id, id));
    await (await this.boss.boss()).send(QUEUE_MAIL_SEND, row.payload, { retryLimit: 10, retryDelay: 30, retryBackoff: true });
  }

  /**
   * Versendet eine Mail und hält sie im Protokoll fest: vollständig (.eml), mit Status, Empfängern und Fehlern.
   * Im Testbetrieb geht sie nur an freigegebene Empfänger; die übrigen stehen dann auch nicht im Kopf.
   */
  private async send(mail: OutgoingMail) {
    let mailbox: Mailbox;
    try {
      mailbox = await this.mailboxes.get(mail.mailboxId);
    } catch {
      this.logger.warn(`Postfach ${mail.mailboxId} existiert nicht mehr, Mail «${mail.subject}» wird verworfen`);
      // Im Protokoll nicht bei «wird versendet» stehen lassen
      await this.db
        .update(outgoingMails)
        .set({ status: 'failed', error: 'Das Postfach für den Versand existiert nicht mehr' })
        .where(and(eq(outgoingMails.messageId, mail.messageId), eq(outgoingMails.status, 'queued')));
      return;
    }

    const { files, fromName, build } = await this.compose(mail, mailbox);

    // Testbetrieb: nur an freigegebene Empfänger
    const delivery = await this.settings.get('mail');
    const allowed = isLive(delivery)
      ? () => true
      : deliveryFilter(delivery, await this.staffAddresses([...mail.to, ...mail.cc]));
    const to = mail.to.filter(allowed);
    const cc = mail.cc.filter(allowed);
    const deliveredTo = [...to, ...cc];
    const withheld = [...mail.to, ...mail.cc].filter((a) => !deliveredTo.includes(a));

    // Im Protokoll steht die vollständige Mail, so wie sie ohne Testbetrieb versendet würde
    const logged = await this.log(mail, mailbox, () => buildMime(build(mail.to, mail.cc)));
    if (!logged) return; // schon versendet, z.B. «Erneut senden» und Wiederholung der Queue
    const { id: logId, full } = logged;
    if (deliveredTo.length === 0) {
      await this.finish(logId, 'held', []);
      this.logger.log(`Testbetrieb: Mail «${mail.subject}» an ${withheld.join(', ')} nicht versendet`);
      return;
    }

    try {
      const mime = withheld.length === 0 ? full : await buildMime(build(to, cc));
      await this.deliver(mailbox, { ...mail, to, cc }, mime, files, fromName);
    } catch (err) {
      const message = mailbox.authType === 'microsoft' ? (err as Error).message : explainMailError((err as Error).message, mailbox);
      await this.db.update(outgoingMails).set({ status: 'failed', error: message }).where(eq(outgoingMails.id, logId));
      this.logger.error(`Versand von «${mail.subject}» fehlgeschlagen: ${message}`);
      throw err;
    }
    await this.finish(logId, withheld.length === 0 ? 'sent' : 'partial', deliveredTo);
    this.logger.log(
      withheld.length === 0
        ? `Mail «${mail.subject}» an ${deliveredTo.join(', ')} gesendet`
        : `Testbetrieb: Mail «${mail.subject}» nur an ${deliveredTo.join(', ')} versendet, nicht an ${withheld.join(', ')}`,
    );
  }

  /** Mit angemeldetem Microsoft-Konto über Microsoft Graph, sonst über SMTP; versendet wird die fertige Mail (MIME). */
  private async deliver(mailbox: Mailbox, mail: OutgoingMail, mime: Buffer, files: Attachment[], fromName: string) {
    if (mailbox.authType === 'microsoft') {
      await this.graph.send(mailbox, { ...mail, fromName }, mime, files);
      return;
    }
    const transporter = await this.transport.smtpTransport(mailbox);
    try {
      await transporter.sendMail({ envelope: { from: mailbox.address, to: [...mail.to, ...mail.cc] }, raw: mime });
    } finally {
      transporter.close();
    }
  }

  /**
   * Eintrag im Protokoll für diesen Versuch, mit der gespeicherten Mail (.eml): beim Einreihen angelegt, sonst jetzt
   * (falls das beim Einreihen nicht gelang oder die Mail schon vorher in der Queue lag). Zählt die Versuche.
   * null = schon versendet oder im Testbetrieb abgelegt, nichts mehr zu tun.
   */
  private async log(mail: OutgoingMail, mailbox: Mailbox, buildFull: () => Promise<Buffer>): Promise<{ id: string; full: Buffer } | null> {
    const [existing] = await this.db
      .select({
        id: outgoingMails.id,
        status: outgoingMails.status,
        storageKey: outgoingMails.storageKey,
        attempts: outgoingMails.attempts,
      })
      .from(outgoingMails)
      .where(eq(outgoingMails.messageId, mail.messageId))
      .limit(1);
    if (existing) {
      if (existing.status === 'sent' || existing.status === 'partial' || existing.status === 'held') return null;
      // Erster Versuch: die beim Einreihen gespeicherte Mail. Wiederholungen und «Erneut senden» neu mit den aktuellen
      // Daten des Postfachs (z.B. nach einer Korrektur der Absenderadresse); das Protokoll zeigt dann diese Fassung.
      const first = existing.attempts === 0;
      const stored = first ? await this.storage.read(existing.storageKey).catch(() => null) : null;
      const full = stored ?? (await buildFull());
      const storageKey = stored ? existing.storageKey : await this.storage.save(full, 'eml');
      await this.db
        .update(outgoingMails)
        .set({ status: 'queued', attempts: sql`${outgoingMails.attempts} + 1`, storageKey, fromAddress: mailbox.address })
        .where(eq(outgoingMails.id, existing.id));
      if (storageKey !== existing.storageKey) await this.storage.remove(existing.storageKey).catch(() => undefined);
      return { id: existing.id, full };
    }
    const full = await buildFull();
    const storageKey = await this.storage.save(full, 'eml');
    const [row] = await this.db
      .insert(outgoingMails)
      .values(this.logValues(mail, mailbox, storageKey, 1))
      .returning({ id: outgoingMails.id });
    return { id: row!.id, full };
  }

  private logValues(mail: OutgoingMail, mailbox: Mailbox, storageKey: string, attempts: number) {
    return {
      messageId: mail.messageId,
      itemId: mail.itemId,
      entryId: mail.entryId ?? null,
      mailboxId: mailbox.id,
      fromAddress: mailbox.address,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      automated: mail.automated,
      template: mail.template ?? null,
      relatedItemId: mail.relatedItemId ?? null,
      status: 'queued' as const,
      attempts,
      payload: mail as unknown as Record<string, unknown>,
      storageKey,
    };
  }

  /** Anhänge, Absendername und die Mail für beliebige Empfänger (MIME-Optionen), so wie sie versendet wird. */
  private async compose(mail: OutgoingMail, mailbox: Mailbox) {
    const files = mail.attachmentIds?.length
      ? await this.db.select().from(attachments).where(inArray(attachments.id, mail.attachmentIds))
      : [];
    const { appName } = await this.settings.get('general');
    const fromName = mailbox.name || appName;
    // Anhänge als Streams: für jede Fassung der Mail neu
    const build = (to: string[], cc: string[]): SendMailOptions => ({
      from: { name: fromName, address: mailbox.address },
      to,
      cc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo ?? undefined,
      references: mail.references?.length ? mail.references : undefined,
      headers: mail.automated ? { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } : {},
      // Bilder im Text (mit Content-ID) gehen eingebettet mit, nicht als Anhang
      attachments: files.map((f) => ({
        filename: f.filename,
        contentType: f.contentType,
        content: this.storage.stream(f.storageKey),
        ...(f.contentId ? { cid: f.contentId } : {}),
      })),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return { files, fromName, build };
  }

  private async finish(id: string, status: 'sent' | 'partial' | 'held', deliveredTo: string[]) {
    await this.db
      .update(outgoingMails)
      .set({ status, deliveredTo, error: null, sentAt: status === 'held' ? null : new Date() })
      .where(eq(outgoingMails.id, id));
  }

  /** Adressen von IT-Mitarbeitenden (Rolle IT oder Admin) unter den Empfängern. */
  private async staffAddresses(addresses: string[]): Promise<Set<string>> {
    const normalized = [...new Set(addresses.map((a) => a.trim().toLowerCase()))];
    if (normalized.length === 0) return new Set();
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.email, normalized), inArray(users.role, ['it', 'admin'])));
    return new Set(rows.map((r) => r.email));
  }
}
