import { BadRequestException, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { items, users, type User } from '../db/schema';
import { itemRef } from '../items/item-ref';
import { decodeFilename, type UploadedFile } from '../items/items.service';
import { AreasService } from '../settings/areas';
import { MailFetcherService, type ImportOutcome } from './mail-fetcher.service';
import { isMsgFile, looksLikeMail, msgToEml } from './msg-mail';

/** Vorgang zu einer importierten Mail; ohne Zugriff auf seinen Bereich nur, dass es ihn gibt */
interface ItemHint {
  ref: string | null;
  title: string | null;
}

/** Vorschau einer Datei vor dem Import */
export interface ImportPreview {
  file: string;
  /** Datei nicht lesbar bzw. keine Mail */
  error: string | null;
  from: { address: string; name: string } | null;
  to: string[];
  subject: string;
  date: Date | null;
  /** Absender ist IT-Mitarbeitender oder Admin: vermutlich eine Weiterleitung statt der Originalmail */
  staffSender: boolean;
  /** Abwesenheitsnotiz oder andere automatische Mail */
  automated: boolean;
  /** Absender ist ein Postfach von Patchwork (wird ignoriert) */
  own: boolean;
  /** Schon in Patchwork (gleiche Message-ID) */
  duplicate: ItemHint | null;
  /** Antwort auf diesen Vorgang; null = neuer Vorgang im Eingang */
  target: ItemHint | null;
}

export interface ImportRow extends ImportOutcome {
  file: string;
  item: ItemHint | null;
}

/**
 * Mails importieren (Entscheid vom 10.11.2026): Mails, die an eine andere Adresse gingen (z.B. eine persönliche), als
 * .eml oder .msg in den Eingang übernehmen, wie eine abgerufene Mail. Erst die Vorschau mit Hinweisen, dann der Import.
 */
@Injectable()
export class MailImportService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly fetcher: MailFetcherService,
    private readonly areas: AreasService,
  ) {}

  /** Datei als Mail (MIME): .eml unverändert, .msg umgewandelt */
  async toMail(file: UploadedFile): Promise<Buffer> {
    if (isMsgFile(file.buffer)) return msgToEml(file.buffer);
    if (decodeFilename(file.originalname).toLowerCase().endsWith('.eml') || looksLikeMail(file.buffer)) return file.buffer;
    throw new BadRequestException('Keine Mail: Importieren lassen sich Mails als .eml oder .msg.');
  }

  async preview(user: User, files: UploadedFile[]): Promise<ImportPreview[]> {
    const staff = await this.staffAddresses();
    const hint = await this.itemHints(user);
    const result: ImportPreview[] = [];
    for (const file of files) {
      const name = decodeFilename(file.originalname);
      try {
        const described = await this.fetcher.describeImport(await this.toMail(file));
        result.push({
          file: name,
          error: described.from ? null : 'Die Mail hat keinen Absender.',
          from: described.from,
          to: described.to,
          subject: described.subject,
          date: described.date,
          staffSender: !!described.from && staff.has(described.from.address),
          automated: described.automated,
          own: described.own,
          duplicate: described.known === undefined ? null : await hint(described.known),
          target: described.target ? await hint(described.target.id) : null,
        });
      } catch (err) {
        result.push({
          file: name,
          error: (err as Error).message,
          from: null,
          to: [],
          subject: '',
          date: null,
          staffSender: false,
          automated: false,
          own: false,
          duplicate: null,
          target: null,
        });
      }
    }
    return result;
  }

  /** Nacheinander importieren; eine nicht lesbare Datei hält die übrigen nicht auf. */
  async importAll(user: User, files: UploadedFile[], confirmation: boolean): Promise<ImportRow[]> {
    const hint = await this.itemHints(user);
    const rows: ImportRow[] = [];
    for (const file of files) {
      const name = decodeFilename(file.originalname);
      let outcome: ImportOutcome;
      try {
        outcome = await this.fetcher.importMail(user, await this.toMail(file), confirmation);
      } catch (err) {
        if (err instanceof BadRequestException && /Postfach/.test(err.message)) throw err;
        outcome = { result: 'failed', reason: (err as Error).message };
      }
      rows.push({ ...outcome, file: name, item: outcome.itemId ? await hint(outcome.itemId) : null });
    }
    return rows;
  }

  private async staffAddresses(): Promise<Set<string>> {
    const rows = await this.db.select({ email: users.email }).from(users).where(inArray(users.role, ['it', 'admin']));
    return new Set(rows.map((r) => r.email.trim().toLowerCase()));
  }

  /** Kennung und Titel eines Vorgangs, nur mit Zugriff auf seinen Bereich (Bereiche je Rolle) */
  private async itemHints(user: User): Promise<(itemId: string | null) => Promise<ItemHint>> {
    const sees = await this.areas.checker();
    return async (itemId) => {
      if (!itemId) return { ref: null, title: null };
      const [item] = await this.db.select().from(items).where(inArray(items.id, [itemId])).limit(1);
      if (!item || !sees(user, item.type)) return { ref: null, title: null };
      return { ref: itemRef(item), title: item.title };
    };
  }
}
