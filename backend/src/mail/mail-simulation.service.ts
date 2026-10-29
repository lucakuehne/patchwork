import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { simpleParser, type ParsedMail } from 'mailparser';
import { InjectDb, type Db } from '../db/db.module';
import { incomingMails, items, mailMessages, outgoingMails, type IncomingMailRow, type User } from '../db/schema';
import { decodeFilename, ItemsService, type UploadedFile } from '../items/items.service';
import { itemKeyFromSubject, itemRef, type ItemKey } from '../items/item-ref';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { MailFetcherService } from './mail-fetcher.service';
import { MailboxesService } from './mailboxes.service';
import { buildSimulatedMail, replySubject, replyText } from './simulated-mail';
import { isLive } from './test-delivery';

export interface SimulationInput {
  /** Antwort auf diese ausgehende Mail; sonst eine neue Mail an «mailboxId» */
  replyTo?: string;
  mailboxId?: string;
  /** Neue Mail als Antwort auf diesen Vorgang: [PW-…] im Betreff und Verweis auf seine letzte Mail */
  /** Kennung des Vorgangs, auf den die simulierte Mail antwortet */
  replyToItem?: ItemKey;
  from: string;
  name: string;
  subject: string;
  text: string;
  /** Abwesenheitsnotiz */
  automated: boolean;
  /** Aus dieser echten Mail (Protokoll der eingehenden Mails) erzeugt */
  originalId?: string;
  /** Anhänge der echten Mail, die mitgehen (Index wie in der Ansicht) */
  originalAttachments?: number[];
  /** Den Vorgang im Eingang verwerfen, den die echte Mail erzeugt hat */
  discardOriginal?: boolean;
}

/** Vorbelegung des Dialogs «Als simulierte Mail …» aus einer echten Mail */
export interface SimulationDraft {
  incomingMailId: string;
  mailboxId: string | null;
  from: string;
  name: string;
  subject: string;
  text: string;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
  /** Vorgang im Eingang, den die echte Mail erzeugt hat und der sich verwerfen lässt; sonst null */
  discardable: { number: number; title: string } | null;
}

/**
 * Testbetrieb: eingehende Mails simulieren. Patchwork verarbeitet sie wie abgeholte Mails, sie landen aber nicht im
 * Postfach (und damit auch nicht bei einem anderen System, das das Postfach liest).
 */
@Injectable()
export class MailSimulationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly mailboxes: MailboxesService,
    private readonly fetcher: MailFetcherService,
    private readonly items: ItemsService,
  ) {}

  /** Liefert den Eintrag im Protokoll der eingehenden Mails, auch wenn die Verarbeitung fehlschlug. */
  async simulate(admin: User, input: SimulationInput, files: UploadedFile[]): Promise<IncomingMailRow> {
    if (isLive(await this.settings.get('mail'))) {
      throw new BadRequestException('Mails lassen sich nur im Testbetrieb simulieren.');
    }
    const address = input.from.trim().toLowerCase();
    const name = input.name.trim() || (await this.users.findByEmail(address))?.name || '';
    const mail = input.replyTo ? await this.reply(input.replyTo, input.text) : await this.newMail(input);
    // Anhänge der echten Mail, aus der die Simulation stammt
    const original = input.originalId ? await this.original(input.originalId) : null;
    const kept = original
      ? (input.originalAttachments ?? []).map((index) => {
          const attachment = original.parsed.attachments[index];
          if (!attachment) throw new BadRequestException('Anhang der echten Mail nicht gefunden');
          return {
            filename: attachment.filename ?? `Anhang ${index + 1}`,
            contentType: attachment.contentType || 'application/octet-stream',
            content: attachment.content,
          };
        })
      : [];
    const { raw, messageId } = await buildSimulatedMail({
      from: { address, name },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      automated: input.automated,
      attachments: [
        ...kept,
        ...files.map((f) => ({
          filename: decodeFilename(f.originalname) || 'datei',
          contentType: f.mimetype || 'application/octet-stream',
          content: f.buffer,
        })),
      ],
      inReplyTo: mail.inReplyTo,
      simulatedBy: admin.email,
    });
    try {
      await this.fetcher.ingest(mail.mailbox, raw, admin);
    } catch {
      // Der Fehler steht im Protokoll
    }
    const [row] = await this.db.select().from(incomingMails).where(eq(incomingMails.messageId, messageId)).limit(1);
    if (!row) throw new Error('Die simulierte Mail fehlt im Protokoll');
    // Echten Vorgang im Eingang verwerfen (lässt sich wiederherstellen)
    if (original && input.discardOriginal) {
      const discardable = await this.discardable(original.row);
      if (discardable) await this.items.setDiscarded(admin, discardable, true);
    }
    return row;
  }

  /** Vorbelegung aus einer echten Mail im Protokoll, über ihre ID oder Message-ID (Originalmail eines Vorgangs). */
  async draft(by: { id?: string; messageId?: string }): Promise<SimulationDraft> {
    const { row, parsed } = await this.original(by.id, by.messageId);
    const from = parsed.from?.value[0];
    return {
      incomingMailId: row.id,
      mailboxId: row.mailboxId,
      from: from?.address ?? row.fromAddress,
      name: from?.name ?? row.fromName,
      subject: (parsed.subject ?? row.subject).trim(),
      text: (parsed.text ?? '').replace(/\r\n?/g, '\n').trim(),
      attachments: parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename ?? `Anhang ${index + 1}`,
        contentType: a.contentType,
        size: a.size,
      })),
      discardable: await this.discardable(row),
    };
  }

  /** Echte Mail aus dem Protokoll samt gespeicherter Fassung (.eml) */
  private async original(id?: string, messageId?: string): Promise<{ row: IncomingMailRow; parsed: ParsedMail }> {
    const where = id ? eq(incomingMails.id, id) : messageId ? eq(incomingMails.messageId, messageId) : undefined;
    const [row] = where ? await this.db.select().from(incomingMails).where(where).limit(1) : [];
    if (!row) throw new NotFoundException('Mail nicht gefunden');
    const raw = await this.storage.read(row.storageKey).catch(() => {
      throw new NotFoundException('Die gespeicherte Mail ist nicht mehr vorhanden (Datei fehlt in der Ablage)');
    });
    return { row, parsed: await simpleParser(raw) };
  }

  /** Vorgang, den die echte Mail im Eingang erzeugt hat, sofern er noch dort liegt und nicht verworfen ist */
  private async discardable(row: IncomingMailRow): Promise<{ prefix: string; number: number; title: string } | null> {
    if (row.result !== 'created' || !row.itemId) return null;
    const [item] = await this.db.select().from(items).where(eq(items.id, row.itemId)).limit(1);
    return item && !item.type && !item.discarded ? { prefix: item.prefix, number: item.number, title: item.title } : null;
  }

  /** Antwort auf eine Mail von Patchwork: an deren Postfach, mit Zitat und Verweisen wie aus Outlook. */
  private async reply(outgoingId: string, text: string) {
    const [out] = await this.db.select().from(outgoingMails).where(eq(outgoingMails.id, outgoingId)).limit(1);
    if (!out) throw new NotFoundException('Mail nicht gefunden');
    const mailbox = (out.mailboxId ? await this.mailboxes.get(out.mailboxId).catch(() => undefined) : undefined) ??
      (await this.mailboxes.getDefault());
    if (!mailbox) throw new BadRequestException('Es ist kein Postfach eingerichtet');
    const original = await this.storage
      .read(out.storageKey)
      .then((raw) => simpleParser(raw))
      .catch(() => null);
    const references = original?.references ? [original.references].flat() : [];
    return {
      mailbox,
      // An die Adresse, von der die Mail kam
      to: out.fromAddress,
      subject: replySubject(out.subject),
      text: replyText(text, {
        from: original?.from?.text || out.fromAddress,
        date: out.sentAt ?? out.createdAt,
        to: out.to,
        cc: out.cc,
        subject: out.subject,
        text: original?.text ?? '',
      }),
      inReplyTo: { messageId: out.messageId, references },
    };
  }

  private async newMail(input: SimulationInput) {
    if (!input.mailboxId) throw new BadRequestException('Bitte ein Postfach wählen.');
    if (!input.subject.trim()) throw new BadRequestException('Bitte einen Betreff angeben.');
    const mailbox = await this.mailboxes.get(input.mailboxId);
    let subject = input.subject.trim();
    let inReplyTo: { messageId: string; references: string[] } | undefined;
    // Als Antwort auf einen Vorgang: Nummer im Betreff und Verweis auf seine letzte Mail
    if (input.replyToItem !== undefined) {
      const item = await this.items.byKey(input.replyToItem);
      const inSubject = itemKeyFromSubject(subject);
      if (!inSubject || itemRef(inSubject) !== itemRef(item)) subject = `[${itemRef(item)}] ${subject}`;
      const previous = await this.db
        .select({ messageId: mailMessages.messageId })
        .from(mailMessages)
        .where(eq(mailMessages.itemId, item.id))
        .orderBy(desc(mailMessages.createdAt))
        .limit(20);
      if (previous.length > 0) {
        inReplyTo = { messageId: previous[0]!.messageId, references: previous.slice(1).reverse().map((m) => m.messageId) };
      }
    }
    return { mailbox, to: mailbox.address, subject, text: input.text, inReplyTo };
  }
}
