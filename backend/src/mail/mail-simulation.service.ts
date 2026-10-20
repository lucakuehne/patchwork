import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import { InjectDb, type Db } from '../db/db.module';
import { incomingMails, outgoingMails, type IncomingMailRow, type User } from '../db/schema';
import { decodeFilename, type UploadedFile } from '../items/items.service';
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
  from: string;
  name: string;
  subject: string;
  text: string;
  /** Abwesenheitsnotiz */
  automated: boolean;
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
  ) {}

  /** Liefert den Eintrag im Protokoll der eingehenden Mails, auch wenn die Verarbeitung fehlschlug. */
  async simulate(admin: User, input: SimulationInput, files: UploadedFile[]): Promise<IncomingMailRow> {
    if (isLive(await this.settings.get('mail'))) {
      throw new BadRequestException('Mails lassen sich nur im Testbetrieb simulieren.');
    }
    const address = input.from.trim().toLowerCase();
    const name = input.name.trim() || (await this.users.findByEmail(address))?.name || '';
    const mail = input.replyTo ? await this.reply(input.replyTo, input.text) : await this.newMail(input);
    const { raw, messageId } = await buildSimulatedMail({
      from: { address, name },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      automated: input.automated,
      attachments: files.map((f) => ({
        filename: decodeFilename(f.originalname) || 'datei',
        contentType: f.mimetype || 'application/octet-stream',
        content: f.buffer,
      })),
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
    return row;
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
    return { mailbox, to: mailbox.address, subject: input.subject.trim(), text: input.text, inReplyTo: undefined };
  }
}
