import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { mailMessages, mutes, participants, users, type Item, type User } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { htmlMail, itemRef, renderMarkdown, subjectFor } from './mail-content';
import { MailboxesService } from './mailboxes.service';
import { MailSenderService, newMessageId } from './mail-sender.service';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const textToHtml = (s: string) => `<p>${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('de-CH', { timeZone: appConfig.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

interface ReporterMail {
  subject: string;
  /** Markdown */
  body: string;
  entryId?: string;
  attachmentIds?: string[];
  automated: boolean;
  /** Vorgang für den Link ins Portal, falls abweichend */
  portalNumber?: number;
}

/**
 * Entscheidet, wer zu welchem Ereignis eine Mail erhält, und stellt sie in die Versand-Queue.
 * Grundregeln: keine Mail an den Auslöser selbst, keine Mail an Benutzer, die den Vorgang
 * stummgeschaltet haben, keine Mail an deaktivierte Benutzer.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mailboxes: MailboxesService,
    private readonly sender: MailSenderService,
    private readonly settings: SettingsService,
  ) {}

  /** Eingangsbestätigung an den Melder. */
  async confirmation(item: Item): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, null);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      subject: subjectFor(item.number, item.title),
      body:
        `Guten Tag\n\nIhre Nachricht ist bei uns eingegangen und wurde unter der Nummer **${itemRef(item.number)}** erfasst. ` +
        `Wir melden uns so bald wie möglich.\n\nFür Ergänzungen antworten Sie bitte direkt auf diese Mail.`,
      automated: true,
    });
  }

  /** Öffentliche Antwort an Melder (An) und Beteiligte (CC). */
  async publicReply(item: Item, actorId: string, body: string, entryId: string, attachmentIds: string[]): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    const cc = await this.participantEmails(item, actorId);
    const to = reporter ? [reporter.email] : cc.splice(0, cc.length);
    await this.sendToReporter(item, to, cc, {
      subject: subjectFor(item.number, item.title),
      body,
      entryId,
      attachmentIds,
      automated: false,
    });
  }

  /** Vorgang wurde in einen Status der Kategorie «Erledigt» gesetzt. */
  async done(item: Item, actorId: string, statusLabel: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      subject: subjectFor(item.number, item.title, statusLabel),
      body:
        `Guten Tag\n\nIhr Anliegen «${item.title}» (${itemRef(item.number)}) wurde auf «${statusLabel}» gesetzt.\n\n` +
        `Falls noch etwas offen ist, antworten Sie einfach auf diese Mail.`,
      automated: true,
    });
  }

  /** Aufgabe wurde abgelehnt und «Melder informieren» war gewählt. */
  async rejected(item: Item, actorId: string, reason: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      subject: subjectFor(item.number, item.title, 'Abgelehnt'),
      body: `Guten Tag\n\nIhr Anliegen «${item.title}» (${itemRef(item.number)}) wurde abgelehnt.\n\n**Begründung:**\n\n${reason}`,
      automated: true,
    });
  }

  /** Mail an den neu Zuständigen. «by» beschreibt den Auslöser ohne Benutzer, z.B. eine Regel. */
  async assigned(item: Item, actorId: string | null, by?: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, actorId);
    if (!assignee) return;
    const [actor, reporter] = await Promise.all([actorId ? this.user(actorId) : undefined, this.user(item.reporterId)]);
    await this.sendToStaff(item, assignee, subjectFor(item.number, item.title, 'Zugewiesen'), [
      `Zugewiesen: ${itemRef(item.number)} «${item.title}»`,
      `Zugewiesen durch: ${by ?? actor?.name ?? '–'}`,
      `Melder: ${reporter ? `${reporter.name} <${reporter.email}>` : '–'}`,
    ]);
  }

  /** Mail an den Zuständigen, wenn Melder oder Beteiligte geantwortet haben. */
  async inboundReply(item: Item, author: User, text: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, author.id);
    if (!assignee) return;
    await this.sendToStaff(item, assignee, subjectFor(item.number, item.title, 'Neue Antwort'), [
      `Neue Antwort von ${author.name} <${author.email}> auf ${itemRef(item.number)} «${item.title}»:`,
      '',
      text,
    ]);
  }

  /**
   * Ein Duplikat wurde zum Original umgeleitet: Hinweis an dessen Melder (An) und Beteiligte (CC).
   * Die Mail läuft unter der Nummer des Originals, damit Antworten dort landen.
   */
  async duplicateRedirected(original: Item, duplicate: Item, merged: boolean, actorId: string): Promise<void> {
    const reporter = await this.eligible(duplicate, duplicate.reporterId, actorId);
    const cc = await this.participantEmails(duplicate, actorId);
    const to = reporter ? [reporter.email] : cc.splice(0, cc.length);
    const dup = `${itemRef(duplicate.number)} «${duplicate.title}»`;
    const orig = `${itemRef(original.number)} «${original.title}»`;
    await this.sendToReporter(original, to, cc, {
      subject: subjectFor(original.number, original.title),
      body: merged
        ? `Guten Tag

Ihre Nachricht ${dup} betrifft denselben Vorgang wie ${orig} und wurde dort hinzugefügt. ` +
          `Für Ergänzungen antworten Sie bitte auf diese Mail.`
        : `Guten Tag

Ihre Meldung ${dup} betrifft dasselbe wie ${orig} und wird dort weiterbearbeitet. ` +
          `Sie erhalten die Updates per Mail.`,
      automated: true,
      // Im Portal sieht der Melder sein Duplikat; das Original nur, wenn er auch dort Melder ist
      portalNumber: merged ? original.number : duplicate.number,
    });
  }

  /** Erinnerung an den Melder, wenn ein Vorgang länger auf seine Rückmeldung wartet. */
  async waitingReminder(item: Item, closeOn: Date | null): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, null);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      subject: subjectFor(item.number, item.title, 'Erinnerung'),
      body:
        `Guten Tag\n\nWir warten noch auf Ihre Rückmeldung zu «${item.title}» (${itemRef(item.number)}). ` +
        `Bitte antworten Sie direkt auf diese Mail.` +
        (closeOn ? `\n\nOhne Rückmeldung schliessen wir den Vorgang am ${formatDate(closeOn)}.` : ''),
      automated: true,
    });
  }

  /** Vorgang wurde mangels Rückmeldung automatisch geschlossen (statt der üblichen Erledigt-Mail). */
  async waitingClosed(item: Item, days: number, statusLabel: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, null);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      subject: subjectFor(item.number, item.title, statusLabel),
      body:
        `Guten Tag\n\nZu «${item.title}» (${itemRef(item.number)}) haben wir seit ${days} Tagen keine Rückmeldung erhalten ` +
        `und den Vorgang deshalb geschlossen.\n\nFalls noch etwas offen ist, antworten Sie einfach auf diese Mail.`,
      automated: true,
    });
  }

  /** Ein Vorgang, der diesen «behebt», wurde erledigt: Mail an den Zuständigen. */
  async fixCompleted(item: Item, fixing: Item, actorId: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, actorId);
    if (!assignee) return;
    const actor = await this.user(actorId);
    await this.sendToStaff(item, assignee, subjectFor(item.number, item.title, 'Behebender Vorgang erledigt'), [
      `${itemRef(fixing.number)} «${fixing.title}» wurde erledigt${actor ? ` (durch ${actor.name})` : ''}.`,
      `Dieser Vorgang behebt ${itemRef(item.number)} «${item.title}». Bitte prüfen, ob ${itemRef(item.number)} abgeschlossen werden kann.`,
    ]);
  }

  private async sendToReporter(item: Item, to: string[], cc: string[], mail: ReporterMail) {
    if (to.length === 0 && cc.length === 0) return;
    const mailbox = await this.mailboxes.forSending(item.mailboxId);
    if (!mailbox) {
      this.logger.warn(`Kein aktives Postfach für den Versand zu ${itemRef(item.number)}`);
      return;
    }
    const { appName } = await this.settings.get('general');
    const previous = await this.db
      .select({ messageId: mailMessages.messageId, direction: mailMessages.direction })
      .from(mailMessages)
      .where(eq(mailMessages.itemId, item.id))
      .orderBy(asc(mailMessages.createdAt));
    const lastInbound = previous.filter((m) => m.direction === 'in').at(-1)?.messageId ?? null;

    const footer = `${appName} · ${itemRef(item.number)}\nBitte lassen Sie bei Antworten die Nummer [${itemRef(item.number)}] im Betreff stehen.`;
    const portalUrl = `${appConfig.publicUrl}/portal/v/${mail.portalNumber ?? item.number}`;
    await this.sender.enqueue({
      mailboxId: mailbox.id,
      itemId: item.id,
      entryId: mail.entryId ?? null,
      to,
      cc,
      subject: mail.subject,
      text: `${mail.body}\n\nIhre Meldung online ansehen: ${portalUrl}\n\n-- \n${footer}`,
      html: htmlMail(
        `${renderMarkdown(mail.body)}<p><a href="${escapeHtml(portalUrl)}">Ihre Meldung online ansehen</a></p>`,
        footer,
      ),
      messageId: newMessageId(mailbox),
      inReplyTo: lastInbound,
      references: previous.slice(-20).map((m) => m.messageId),
      attachmentIds: mail.attachmentIds ?? [],
      automated: mail.automated,
    });
  }

  private async sendToStaff(item: Item, recipient: User, subject: string, lines: string[]) {
    const mailbox = await this.mailboxes.forSending(item.mailboxId);
    if (!mailbox) {
      this.logger.warn(`Kein aktives Postfach für Benachrichtigungen zu ${itemRef(item.number)}`);
      return;
    }
    const { appName } = await this.settings.get('general');
    const url = `${appConfig.publicUrl}/v/${item.number}`;
    const text = [...lines, '', `Öffnen: ${url}`].join('\n');
    const footer = `${appName} · Benachrichtigung zu ${itemRef(item.number)}`;
    await this.sender.enqueue({
      mailboxId: mailbox.id,
      itemId: item.id,
      to: [recipient.email],
      cc: [],
      subject,
      text: `${text}\n\n-- \n${footer}`,
      html: htmlMail(`${textToHtml(lines.join('\n'))}<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`, footer),
      messageId: newMessageId(mailbox),
      automated: true,
    });
  }

  /** Empfänger, sofern aktiv, nicht der Auslöser und nicht stummgeschaltet. */
  private async eligible(item: Item, userId: string, actorId: string | null): Promise<User | null> {
    if (userId === actorId) return null;
    const user = await this.user(userId);
    if (!user?.active) return null;
    const [muted] = await this.db
      .select({ userId: mutes.userId })
      .from(mutes)
      .where(and(eq(mutes.itemId, item.id), eq(mutes.userId, userId)))
      .limit(1);
    return muted ? null : user;
  }

  /** Adressen der Beteiligten für CC: aktiv, nicht stummgeschaltet, ohne Melder und Auslöser. */
  private async participantEmails(item: Item, actorId: string): Promise<string[]> {
    const rows = await this.db
      .select({ user: users })
      .from(participants)
      .innerJoin(users, eq(users.id, participants.userId))
      .where(eq(participants.itemId, item.id));
    const muted = await this.mutedUserIds(item.id);
    return rows
      .map((r) => r.user)
      .filter((u) => u.active && u.id !== actorId && u.id !== item.reporterId && !muted.has(u.id))
      .map((u) => u.email);
  }

  private async mutedUserIds(itemId: string): Promise<Set<string>> {
    const rows = await this.db.select({ userId: mutes.userId }).from(mutes).where(eq(mutes.itemId, itemId));
    return new Set(rows.map((r) => r.userId));
  }

  private async user(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(inArray(users.id, [id])).limit(1);
    return user;
  }
}
