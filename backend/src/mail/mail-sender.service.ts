import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type PgBoss from 'pg-boss';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import {
  attachments,
  items,
  mailMessages,
  outgoingMails,
  users,
  type Attachment,
  type ItemType,
  type Mailbox,
  type MailAttempt,
} from '../db/schema';
import { BossService, QUEUE_MAIL_RETRY, QUEUE_MAIL_SEND } from '../jobs/boss.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { GraphMailService } from './graph-mail.service';
import { errorText, explainMailError } from './mail-errors';
import { MailboxesService } from './mailboxes.service';
import { MailTransportService } from './mail-transport.service';
import { nextAttemptAt, type MailRetrySettings } from './mail-retry';
import { isPermanentSendError } from './send-errors';
import { deliveryBlock, deliveryFilter, isBlockLive, triggerCircles } from './test-delivery';

/** Zustellversuch ans Protokoll der Mail anhängen (Entscheid vom 13.11.2026) */
const appendAttempt = (attempt: MailAttempt) => sql`${outgoingMails.attemptLog} || ${JSON.stringify([attempt])}::jsonb`;

/** So lange darf eine Mail bei «wird versendet» stehen, danach reiht der Versand sie neu ein (z.B. Job verloren) */
const STALE_QUEUED_MS = 10 * 60_000;

/**
 * Noch offen: in der Versand-Queue, wartend oder nach einem vorübergehenden Fehler mit geplantem nächstem Versuch. Eine
 * offene ältere Mail hält die neueren desselben Postfachs auf (Reihenfolge, Entscheid vom 13.11.2026).
 */
const isOpen: SQL = and(
  isNotNull(outgoingMails.payload),
  or(inArray(outgoingMails.status, ['queued', 'waiting']), and(eq(outgoingMails.status, 'failed'), isNotNull(outgoingMails.nextAttemptAt))),
)!;

/** Ältere Mail, auf die eine wartende Mail wartet */
export interface WaitingFor {
  id: string;
  subject: string;
  createdAt: Date;
}

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
  /** Nur im Job: «Erneut senden» von dieser Person (für das Protokoll der Zustellversuche) */
  manualBy?: string;
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
    const boss = await this.boss.boss();
    await boss.work<OutgoingMail>(QUEUE_MAIL_SEND, { batchSize: 1 }, (jobs) => this.handle(jobs));
    // Fällige Wiederholungen jede Minute (Entscheid vom 13.11.2026)
    await boss.work(QUEUE_MAIL_RETRY, { batchSize: 1 }, async () => {
      await this.retryDue();
    });
    await boss.schedule(QUEUE_MAIL_RETRY, '* * * * *');
  }

  /** In die Versand-Queue; Wiederholungen nach einem Fehler plant der Versand selbst (siehe retryDue). */
  private async queue(mail: OutgoingMail) {
    await (await this.boss.boss()).send(QUEUE_MAIL_SEND, mail, { retryLimit: 1, retryDelay: 60 });
  }

  /**
   * Jede Minute: fehlgeschlagene Mails, deren nächster Versuch fällig ist, wieder in die Versand-Queue stellen (in der
   * Reihenfolge des Einreihens), hängengebliebene neu einreihen und wartende freigeben, falls die Freigabe nach dem
   * Versand der älteren nicht geklappt hat.
   */
  async retryDue(): Promise<number> {
    const now = new Date();
    const due = await this.db
      .update(outgoingMails)
      .set({ status: 'queued', nextAttemptAt: null, queuedAt: now })
      .where(
        and(
          eq(outgoingMails.status, 'failed'),
          isNull(outgoingMails.dismissedAt),
          isNotNull(outgoingMails.payload),
          lte(outgoingMails.nextAttemptAt, now),
        ),
      )
      .returning({ payload: outgoingMails.payload, createdAt: outgoingMails.createdAt });
    await this.queueInOrder(due);

    // Zu lange bei «wird versendet» (z.B. Job verloren): hielte die neueren auf, also neu einreihen
    const staleBefore = new Date(now.getTime() - STALE_QUEUED_MS);
    const stale = await this.db
      .update(outgoingMails)
      .set({ queuedAt: now })
      .where(
        and(
          eq(outgoingMails.status, 'queued'),
          isNotNull(outgoingMails.payload),
          or(lt(outgoingMails.queuedAt, staleBefore), and(isNull(outgoingMails.queuedAt), lt(outgoingMails.createdAt, staleBefore))),
        ),
      )
      .returning({ payload: outgoingMails.payload, createdAt: outgoingMails.createdAt, subject: outgoingMails.subject });
    for (const row of stale) this.logger.warn(`Mail «${row.subject}» hing in der Versand-Queue und wird neu eingereiht`);
    await this.queueInOrder(stale);

    const boxes = await this.db
      .selectDistinct({ mailboxId: outgoingMails.mailboxId })
      .from(outgoingMails)
      .where(eq(outgoingMails.status, 'waiting'));
    for (const { mailboxId } of boxes) await this.release(mailboxId);
    return due.length;
  }

  private async queueInOrder(rows: { payload: Record<string, unknown> | null; createdAt: Date }[]) {
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const row of ordered) if (row.payload) await this.queue(row.payload as unknown as OutgoingMail);
  }

  /**
   * Älteste noch offene Mail desselben Postfachs, die vor dieser eingereiht wurde: Solange es sie gibt, wartet diese
   * (Reihenfolge je Postfach, Entscheid vom 13.11.2026). null = keine, die Mail darf hinaus.
   */
  async waitingFor(ref: { id: string } | { messageId: string }): Promise<WaitingFor | null> {
    const [row] = await this.db
      .select({ mailboxId: outgoingMails.mailboxId, createdAt: outgoingMails.createdAt })
      .from(outgoingMails)
      .where('id' in ref ? eq(outgoingMails.id, ref.id) : eq(outgoingMails.messageId, ref.messageId))
      .limit(1);
    if (!row?.mailboxId) return null;
    const [older] = await this.db
      .select({ id: outgoingMails.id, subject: outgoingMails.subject, createdAt: outgoingMails.createdAt })
      .from(outgoingMails)
      .where(and(eq(outgoingMails.mailboxId, row.mailboxId), lt(outgoingMails.createdAt, row.createdAt), isOpen))
      .orderBy(asc(outgoingMails.createdAt))
      .limit(1);
    return older ?? null;
  }

  /**
   * Gibt die wartenden Mails eines Postfachs frei, sobald keine ältere mehr offen ist: in der Reihenfolge des
   * Einreihens zurück in die Versand-Queue. Jede prüft beim Versand noch einmal; schlägt eine wieder vorübergehend fehl,
   * warten die folgenden wieder.
   */
  private async release(mailboxId: string | null): Promise<void> {
    const sameBox = mailboxId ? eq(outgoingMails.mailboxId, mailboxId) : isNull(outgoingMails.mailboxId);
    const [first] = await this.db
      .select({ createdAt: outgoingMails.createdAt })
      .from(outgoingMails)
      .where(and(sameBox, eq(outgoingMails.status, 'waiting')))
      .orderBy(asc(outgoingMails.createdAt))
      .limit(1);
    if (!first) return;
    // Ohne Postfach (gelöscht) gibt es keine Reihenfolge mehr: der Versand hält sie als Fehler fest
    if (mailboxId) {
      const [blocking] = await this.db
        .select({ id: outgoingMails.id })
        .from(outgoingMails)
        .where(and(sameBox, lt(outgoingMails.createdAt, first.createdAt), isOpen, sql`${outgoingMails.status} <> 'waiting'`))
        .limit(1);
      if (blocking) return;
    }
    const released = await this.db
      .update(outgoingMails)
      .set({ status: 'queued', queuedAt: new Date() })
      .where(and(sameBox, eq(outgoingMails.status, 'waiting')))
      .returning({ payload: outgoingMails.payload, createdAt: outgoingMails.createdAt });
    await this.queueInOrder(released);
  }

  /**
   * Neue Einstellungen der Wiederholungen gelten sofort: Mails, die auf ihren nächsten Versuch warten, erhalten den
   * Zeitpunkt nach den neuen Abständen (oder keinen mehr, wenn die Anzahl schon erreicht ist).
   */
  async applyRetrySettings(settings: MailRetrySettings): Promise<void> {
    const waiting = await this.db
      .select({ id: outgoingMails.id, attemptLog: outgoingMails.attemptLog, mailboxId: outgoingMails.mailboxId })
      .from(outgoingMails)
      .where(and(eq(outgoingMails.status, 'failed'), isNotNull(outgoingMails.nextAttemptAt)));
    const givenUp = new Set<string | null>();
    for (const row of waiting) {
      const next = nextAttemptAt(settings, row.attemptLog);
      await this.db
        .update(outgoingMails)
        .set({ nextAttemptAt: next })
        .where(and(eq(outgoingMails.id, row.id), isNotNull(outgoingMails.nextAttemptAt)));
      if (!next) givenUp.add(row.mailboxId);
    }
    // Keine Wiederholung mehr: Die Mails, die auf sie warteten, gehen weiter
    for (const mailboxId of givenUp) await this.release(mailboxId);
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
    await this.queue(mail);
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

  /**
   * Eine fehlgeschlagene Mail noch einmal in die Versand-Queue stellen. «by»: wer es auslöst, steht beim Zustellversuch;
   * mit ihm beginnt eine neue Reihe von Wiederholungen.
   */
  async resend(id: string, by: string): Promise<void> {
    const [row] = await this.db.select().from(outgoingMails).where(eq(outgoingMails.id, id)).limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    if (row.status !== 'failed' || !row.payload) throw new BadRequestException('Erneut senden geht nur bei fehlgeschlagenen Mails');
    // Schlägt sie wieder fehl, erscheint sie wieder im Hinweis für die Admins
    await this.db
      .update(outgoingMails)
      .set({ status: 'queued', dismissedAt: null, nextAttemptAt: null, queuedAt: new Date() })
      .where(eq(outgoingMails.id, id));
    await this.queue({ ...(row.payload as unknown as OutgoingMail), manualBy: by });
  }

  /**
   * Fehlgeschlagene Mail als erledigt markieren: kein Hinweis mehr an die Admins und keine weiteren automatischen
   * Versuche; sie bleibt im Protokoll.
   */
  async dismiss(id: string): Promise<void> {
    const [row] = await this.db
      .select({ status: outgoingMails.status, mailboxId: outgoingMails.mailboxId })
      .from(outgoingMails)
      .where(eq(outgoingMails.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    if (row.status !== 'failed') throw new BadRequestException('Als erledigt markieren geht nur bei fehlgeschlagenen Mails');
    await this.db.update(outgoingMails).set({ dismissedAt: new Date(), nextAttemptAt: null }).where(eq(outgoingMails.id, id));
    // Aufgegeben: Die wartenden Mails des Postfachs gehen weiter
    await this.release(row.mailboxId);
  }

  /** Massenaktion «Erneut senden» (Entscheid vom 13.11.2026): nur fehlgeschlagene, die übrigen werden übersprungen. */
  async resendMany(ids: string[], by: string): Promise<{ done: number; skipped: number }> {
    let done = 0;
    for (const id of ids) {
      try {
        await this.resend(id, by);
        done++;
      } catch (err) {
        if (!(err instanceof BadRequestException || err instanceof NotFoundException)) throw err;
      }
    }
    return { done, skipped: ids.length - done };
  }

  /** Massenaktion «Als erledigt markieren»: fehlgeschlagene, noch nicht erledigte; die übrigen werden übersprungen. */
  async dismissMany(ids: string[]): Promise<{ done: number; skipped: number }> {
    const rows = ids.length
      ? await this.db
          .update(outgoingMails)
          .set({ dismissedAt: new Date(), nextAttemptAt: null })
          .where(and(inArray(outgoingMails.id, ids), eq(outgoingMails.status, 'failed'), isNull(outgoingMails.dismissedAt)))
          .returning({ id: outgoingMails.id, mailboxId: outgoingMails.mailboxId })
      : [];
    for (const mailboxId of new Set(rows.map((r) => r.mailboxId))) await this.release(mailboxId);
    return { done: rows.length, skipped: ids.length - rows.length };
  }

  /**
   * Versendet eine Mail und hält sie im Protokoll fest: vollständig (.eml), mit Status, Empfängern und Fehlern.
   * Im Testbetrieb geht sie nur an freigegebene Empfänger; die übrigen stehen dann auch nicht im Kopf.
   */
  private async send(job: OutgoingMail) {
    // «Erneut senden» von … steht nur beim Zustellversuch, nicht in der gespeicherten Mail
    const { manualBy, ...mail } = job;
    // Nur Mails in der Versand-Queue: Ein doppelter oder überholter Job (z.B. neu eingereiht, während der Versand noch
    // lief) versendet nichts und plant nichts um
    const [current] = await this.db
      .select({ status: outgoingMails.status })
      .from(outgoingMails)
      .where(eq(outgoingMails.messageId, mail.messageId))
      .limit(1);
    if (current && current.status !== 'queued') return;
    const attempt = (result: MailAttempt['result'], deliveredTo: string[], mailbox: string, error: string | null = null): MailAttempt => ({
      at: new Date().toISOString(),
      result,
      error,
      deliveredTo,
      mailbox,
      by: manualBy ?? null,
    });
    let mailbox: Mailbox;
    try {
      mailbox = await this.mailboxes.get(mail.mailboxId);
    } catch {
      this.logger.warn(`Postfach ${mail.mailboxId} existiert nicht mehr, Mail «${mail.subject}» wird verworfen`);
      // Im Protokoll nicht bei «wird versendet» stehen lassen; ohne Postfach keine Wiederholung
      const error = 'Das Postfach für den Versand existiert nicht mehr';
      await this.db
        .update(outgoingMails)
        .set({ status: 'failed', error, nextAttemptAt: null, attemptLog: appendAttempt(attempt('failed', [], '', error)) })
        .where(and(eq(outgoingMails.messageId, mail.messageId), inArray(outgoingMails.status, ['queued', 'failed'])));
      return;
    }

    const { files, fromName, build } = await this.compose(mail, mailbox);

    // Testbetrieb: nur an freigegebene Empfänger, nach dem Block des Vorgangstyps beim Versand und dem Auslöser
    const block = (await this.settings.get('mail'))[deliveryBlock(await this.itemType(mail.itemId))];
    const circles = triggerCircles(block, mail.template);
    const allowed = isBlockLive(circles)
      ? () => true
      : deliveryFilter(circles, await this.staffAddresses([...mail.to, ...mail.cc]));
    const to = mail.to.filter(allowed);
    const cc = mail.cc.filter(allowed);
    const deliveredTo = [...to, ...cc];
    const withheld = [...mail.to, ...mail.cc].filter((a) => !deliveredTo.includes(a));

    // Reihenfolge je Postfach: Ist eine ältere Mail noch offen (z.B. Server nicht erreichbar), wartet diese, bis die
    // ältere versendet oder aufgegeben ist. Zurückgehaltene (Testbetrieb) gehen ohnehin nicht hinaus.
    if (deliveredTo.length > 0) {
      const blocker = await this.waitingFor({ messageId: mail.messageId });
      if (blocker) {
        await this.db
          .update(outgoingMails)
          .set({ status: 'waiting', nextAttemptAt: null, queuedAt: null })
          .where(and(eq(outgoingMails.messageId, mail.messageId), eq(outgoingMails.status, 'queued')));
        this.logger.log(`Mail «${mail.subject}» wartet auf die ältere Mail «${blocker.subject}»`);
        return;
      }
    }

    // Im Protokoll steht die vollständige Mail, so wie sie ohne Testbetrieb versendet würde
    const logged = await this.log(mail, mailbox, () => buildMime(build(mail.to, mail.cc)));
    if (!logged) return; // schon versendet, z.B. «Erneut senden» und Wiederholung der Queue
    const { id: logId, full, attemptLog } = logged;
    if (deliveredTo.length === 0) {
      await this.finish(logId, 'held', [], attempt('held', [], mailbox.address));
      await this.release(mailbox.id);
      this.logger.log(`Testbetrieb: Mail «${mail.subject}» an ${withheld.join(', ')} nicht versendet`);
      return;
    }

    try {
      const mime = withheld.length === 0 ? full : await buildMime(build(to, cc));
      await this.deliver(mailbox, { ...mail, to, cc }, mime, files, fromName);
    } catch (err) {
      const message = mailbox.authType === 'microsoft' ? errorText(err) : explainMailError(errorText(err), mailbox);
      // Status «Fehler» gleich nach dem ersten Fehlversuch (Vermerk im Verlauf, Hinweis an die Admins); der nächste
      // Versuch nach den Wiederholungen unter Verwaltung → Ausgehende Mails. Lehnt der Server genau diese Mail ab
      // (dauerhaft, z.B. Empfänger unbekannt), gibt es keine Wiederholung.
      const permanent = isPermanentSendError(err);
      const failed: MailAttempt = { ...attempt('failed', [], mailbox.address, message), ...(permanent ? { permanent: true } : {}) };
      const next = permanent ? null : nextAttemptAt(await this.settings.get('mailRetry'), [...attemptLog, failed]);
      await this.db
        .update(outgoingMails)
        .set({ status: 'failed', error: message, nextAttemptAt: next, queuedAt: null, attemptLog: appendAttempt(failed) })
        .where(eq(outgoingMails.id, logId));
      this.logger.error(
        `Versand von «${mail.subject}» fehlgeschlagen${permanent ? ' (dauerhaft)' : ''}: ${message}${next ? ` (nächster Versuch ${next.toISOString()})` : ''}`,
      );
      // Kein weiterer Versuch (dauerhafter Fehler oder Wiederholungen aufgebraucht): die wartenden Mails gehen weiter
      if (!next) await this.release(mailbox.id);
      return;
    }
    await this.finish(logId, withheld.length === 0 ? 'sent' : 'partial', deliveredTo, attempt(withheld.length === 0 ? 'sent' : 'partial', deliveredTo, mailbox.address));
    await this.release(mailbox.id);
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
  private async log(
    mail: OutgoingMail,
    mailbox: Mailbox,
    buildFull: () => Promise<Buffer>,
  ): Promise<{ id: string; full: Buffer; attemptLog: MailAttempt[] } | null> {
    const [existing] = await this.db
      .select({
        id: outgoingMails.id,
        status: outgoingMails.status,
        storageKey: outgoingMails.storageKey,
        attempts: outgoingMails.attempts,
        attemptLog: outgoingMails.attemptLog,
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
        .set({
          status: 'queued',
          attempts: sql`${outgoingMails.attempts} + 1`,
          storageKey,
          fromAddress: mailbox.address,
          nextAttemptAt: null,
        })
        .where(eq(outgoingMails.id, existing.id));
      if (storageKey !== existing.storageKey) await this.storage.remove(existing.storageKey).catch(() => undefined);
      return { id: existing.id, full, attemptLog: existing.attemptLog };
    }
    const full = await buildFull();
    const storageKey = await this.storage.save(full, 'eml');
    const [row] = await this.db
      .insert(outgoingMails)
      .values(this.logValues(mail, mailbox, storageKey, 1))
      .returning({ id: outgoingMails.id });
    return { id: row!.id, full, attemptLog: [] };
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
      queuedAt: new Date(),
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

  private async finish(id: string, status: 'sent' | 'partial' | 'held', deliveredTo: string[], attempt: MailAttempt) {
    await this.db
      .update(outgoingMails)
      .set({
        status,
        deliveredTo,
        error: null,
        sentAt: status === 'held' ? null : new Date(),
        nextAttemptAt: null,
        queuedAt: null,
        attemptLog: appendAttempt(attempt),
      })
      .where(eq(outgoingMails.id, id));
  }

  /** Adressen von IT-Mitarbeitenden (Rolle IT oder Admin) unter den Empfängern. */
  /** Typ des Vorgangs zur Mail, null ohne Vorgang oder im Eingang */
  private async itemType(itemId: string | null): Promise<ItemType | null> {
    if (!itemId) return null;
    const [row] = await this.db.select({ type: items.type }).from(items).where(eq(items.id, itemId)).limit(1);
    return row?.type ?? null;
  }

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
