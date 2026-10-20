import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { sign } from '../common/crypto';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { attachments, items, mailMessages, mutes, participants, statuses, users, type Item, type User } from '../db/schema';
import { embedImageTags, imagesAsText, imageSize, type EmbeddedImage } from '../items/inline-images';
import { PortalAccessService } from '../portal/portal-access.service';
import { StorageService } from '../storage/storage.service';
import { itemRef, subjectFor } from './mail-content';
import { composeMail, fill, personValues, type TemplateKey } from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';
import { MailboxesService } from './mailboxes.service';
import { MailSenderService, newMessageId } from './mail-sender.service';

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('de-CH', { timeZone: appConfig.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

interface ReporterMail {
  template: TemplateKey;
  /** Weitere Platzhalter der Vorlage, z.B. «Begründung» */
  values?: Record<string, string>;
  /** Öffentliche Antwort: Text des Bearbeiters (Markdown) statt des Texts der Vorlage */
  written?: string;
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
    private readonly templates: MailTemplatesService,
    private readonly storage: StorageService,
    private readonly portalAccess: PortalAccessService,
  ) {}

  /**
   * Eingangsbestätigung an den Melder. Der Vorgang wird neu gelesen: Regeln für neue Vorgänge (Zuständig, Typ) sind dann
   * schon gespeichert, z.B. für {{Zuständig Vorname}} und {{Status}}.
   */
  async confirmation(created: Item): Promise<void> {
    const [item = created] = await this.db.select().from(items).where(eq(items.id, created.id)).limit(1);
    const reporter = await this.eligible(item, item.reporterId, null);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], { template: 'confirmation', automated: true });
  }

  /** Öffentliche Antwort an Melder (An) und Beteiligte (CC). */
  async publicReply(item: Item, actorId: string, body: string, entryId: string, attachmentIds: string[]): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    const cc = await this.participantEmails(item, actorId);
    const to = reporter ? [reporter.email] : cc.splice(0, cc.length);
    await this.sendToReporter(item, to, cc, {
      template: 'reply',
      written: body,
      entryId,
      attachmentIds,
      automated: false,
    });
  }

  /** Vorgang wurde von Hand in einen abgeschlossenen Status (ausser dem Ablehnen-Status) gesetzt. */
  async done(item: Item, actorId: string, statusLabel: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], { template: 'done', values: { Status: statusLabel }, automated: true });
  }

  /** Vorgang wurde abgelehnt und «Melder informieren» war gewählt. */
  async rejected(item: Item, actorId: string, reason: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, actorId);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      template: 'rejected',
      values: { Begründung: reason },
      automated: true,
    });
  }

  /** Mail an den neu Zuständigen. «by» beschreibt den Auslöser ohne Benutzer, z.B. eine Regel. */
  async assigned(item: Item, actorId: string | null, by?: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, actorId);
    if (!assignee) return;
    const [actor, reporter] = await Promise.all([actorId ? this.user(actorId) : undefined, this.user(item.reporterId)]);
    await this.sendToStaff(item, assignee, 'assigned', {
      'Zugewiesen durch': by ?? actor?.name ?? '–',
      'Melder E-Mail': reporter?.email ?? '–',
    });
  }

  /** Mail an den Zuständigen, wenn Melder oder Beteiligte geantwortet haben. */
  async inboundReply(item: Item, author: User, text: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, author.id);
    if (!assignee) return;
    await this.sendToStaff(item, assignee, 'inboundReply', {
      Absender: author.name,
      'Absender E-Mail': author.email,
      // Bilder sieht der Zuständige in Patchwork; in der Benachrichtigung nur ihr Name
      Text: imagesAsText(text),
    });
  }

  /**
   * Ein Duplikat wurde zum Original umgeleitet: Hinweis an dessen Melder (An) und Beteiligte (CC).
   * Die Mail läuft unter der Nummer des Originals, damit Antworten dort landen.
   */
  async duplicateRedirected(original: Item, duplicate: Item, merged: boolean, actorId: string): Promise<void> {
    const reporter = await this.eligible(duplicate, duplicate.reporterId, actorId);
    const cc = await this.participantEmails(duplicate, actorId);
    const to = reporter ? [reporter.email] : cc.splice(0, cc.length);
    await this.sendToReporter(original, to, cc, {
      template: merged ? 'duplicateMerged' : 'duplicateRedirected',
      values: {
        Duplikat: `${itemRef(duplicate.number)} «${duplicate.title}»`,
        Original: `${itemRef(original.number)} «${original.title}»`,
        // Die Mail geht an den Melder des Duplikats; bei einem anderen Melder als beim Original nennt sie ihn
        ...personValues('Melder', reporter ?? (await this.user(duplicate.reporterId))),
      },
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
      template: 'waitingReminder',
      values: { Schliessung: closeOn ? `Ohne Rückmeldung schliessen wir den Vorgang am ${formatDate(closeOn)}.` : '' },
      automated: true,
    });
  }

  /** Vorgang wurde mangels Rückmeldung automatisch geschlossen (statt der üblichen Erledigt-Mail). */
  async waitingClosed(item: Item, days: number, statusLabel: string): Promise<void> {
    const reporter = await this.eligible(item, item.reporterId, null);
    if (!reporter) return;
    await this.sendToReporter(item, [reporter.email], [], {
      template: 'waitingClosed',
      values: { Status: statusLabel, Tage: String(days) },
      automated: true,
    });
  }

  /** Ein Vorgang, der diesen «behebt», wurde erledigt: Mail an den Zuständigen. */
  async fixCompleted(item: Item, fixing: Item, actorId: string): Promise<void> {
    if (!item.assigneeId) return;
    const assignee = await this.eligible(item, item.assigneeId, actorId);
    if (!assignee) return;
    const actor = await this.user(actorId);
    await this.sendToStaff(item, assignee, 'fixCompleted', {
      'Behebender Vorgang': `${itemRef(fixing.number)} «${fixing.title}»`,
      Bearbeiter: actor?.name ?? '–',
    });
  }

  /**
   * Werte der Platzhalter, die jede Mail zu einem Vorgang kennt. Vor- und Nachname von Melder und Zuständigem aus den
   * Benutzern des Vorgangs, ohne Zuständigen leer.
   */
  private async itemValues(item: Item, link: string): Promise<Record<string, string>> {
    const [reporter, assignee, status] = await Promise.all([
      this.user(item.reporterId),
      item.assigneeId ? this.user(item.assigneeId) : undefined,
      item.statusId
        ? this.db
            .select({ label: statuses.label })
            .from(statuses)
            .where(eq(statuses.id, item.statusId))
            .then((r) => r[0]?.label ?? '')
        : '',
    ]);
    return {
      Nummer: itemRef(item.number),
      Titel: item.title,
      Status: status,
      ...personValues('Melder', reporter),
      ...personValues('Zuständig', assignee),
      Link: link,
    };
  }

  /** Betreff aus der Vorlage; die Nummer steht immer davor, damit Antworten zugeordnet werden. */
  private subject(item: Item, template: string | null, values: Record<string, string>): string {
    const text = fill(template ?? '{{Titel}}', values).replace(/\s+/g, ' ').trim();
    return subjectFor(item.number, text || item.title);
  }

  private async sendToReporter(item: Item, to: string[], cc: string[], mail: ReporterMail) {
    if (to.length === 0 && cc.length === 0) return;
    const mailbox = await this.mailboxes.forSending(item.mailboxId);
    if (!mailbox) {
      this.logger.warn(`Kein aktives Postfach für den Versand zu ${itemRef(item.number)}`);
      return;
    }
    const previous = await this.db
      .select({ messageId: mailMessages.messageId, direction: mailMessages.direction })
      .from(mailMessages)
      .where(eq(mailMessages.itemId, item.id))
      .orderBy(asc(mailMessages.createdAt));
    const lastInbound = previous.filter((m) => m.direction === 'in').at(-1)?.messageId ?? null;

    const portalUrl = `${appConfig.publicUrl}/portal/v/${mail.portalNumber ?? item.number}`;
    const values = { ...(await this.itemValues(item, portalUrl)), ...mail.values };
    const [template, link, footer, reporter] = await Promise.all([
      this.templates.get(mail.template),
      this.templates.get('reporterLink'),
      this.templates.get('reporterFooter'),
      this.user(item.reporterId),
    ]);
    // Link-Zeile zum Portal nur, wenn das Portal für den Melder freigeschaltet ist
    const withLink = !!reporter && (await this.portalAccess.allowed(reporter));
    const { text, html, inline } = await this.embedImages(
      item,
      composeMail(
        {
          body: mail.written ?? template.body ?? '',
          link: withLink ? (link.body ?? '') : '',
          footer: footer.body ?? '',
          written: mail.written !== undefined,
        },
        values,
      ),
    );
    await this.sender.enqueue({
      mailboxId: mailbox.id,
      itemId: item.id,
      entryId: mail.entryId ?? null,
      to,
      cc,
      subject: this.subject(item, template.subject, values),
      text,
      html,
      messageId: newMessageId(mailbox),
      inReplyTo: lastInbound,
      references: previous.slice(-20).map((m) => m.messageId),
      attachmentIds: [...(mail.attachmentIds ?? []), ...inline],
      automated: mail.automated,
    });
  }

  /**
   * Bilder im Text: im HTML eingebettet («cid:», die Bilder gehen als eingebettete Teile mit), auf Textbreite verkleinert
   * und mit Link auf die volle Grösse. Im Text als «[Bild: Name]». Nur Bilder dieses Vorgangs; fremde fallen weg.
   */
  private async embedImages(item: Item, mail: { text: string; html: string }): Promise<{ text: string; html: string; inline: string[] }> {
    const ids = [...new Set([...mail.html.matchAll(/src="attachment:([0-9a-f-]{36})"/g)].map((m) => m[1]!))];
    const rows = ids.length
      ? await this.db
          .select()
          .from(attachments)
          .where(and(eq(attachments.itemId, item.id), inArray(attachments.id, ids)))
      : [];
    const images = new Map<string, EmbeddedImage>();
    for (const row of rows) {
      if (!row.contentId) continue;
      const size = await this.storage
        .read(row.storageKey)
        .then(imageSize)
        .catch(() => null);
      images.set(row.id, {
        cid: row.contentId,
        url: `${appConfig.publicUrl}/api/public/images/${row.id}?s=${sign('image', row.id)}`,
        width: size?.width ?? null,
        height: size?.height ?? null,
      });
    }
    return { text: imagesAsText(mail.text), html: embedImageTags(mail.html, images), inline: [...images.keys()] };
  }

  private async sendToStaff(item: Item, recipient: User, key: TemplateKey, extra: Record<string, string>) {
    const mailbox = await this.mailboxes.forSending(item.mailboxId);
    if (!mailbox) {
      this.logger.warn(`Kein aktives Postfach für Benachrichtigungen zu ${itemRef(item.number)}`);
      return;
    }
    const values = { ...(await this.itemValues(item, `${appConfig.publicUrl}/v/${item.number}`)), ...extra };
    const [template, link, footer] = await Promise.all([
      this.templates.get(key),
      this.templates.get('staffLink'),
      this.templates.get('staffFooter'),
    ]);
    const { text, html } = composeMail({ body: template.body ?? '', link: link.body ?? '', footer: footer.body ?? '' }, values);
    await this.sender.enqueue({
      mailboxId: mailbox.id,
      itemId: item.id,
      to: [recipient.email],
      cc: [],
      subject: this.subject(item, template.subject, values),
      text,
      // Bilder (nur aus einer bearbeiteten Vorlage möglich) werden nicht geladen
      html: embedImageTags(html, new Map()),
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
