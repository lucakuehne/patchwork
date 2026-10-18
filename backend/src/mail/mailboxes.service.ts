import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, ne } from 'drizzle-orm';
import { encryptSecret } from '../common/crypto';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { mailboxes, type Mailbox } from '../db/schema';

export interface MailboxInput {
  name: string;
  address: string;
  active: boolean;
  isDefault: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapFolder: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'none';
  authType: 'password' | 'oauth2';
  username: string;
  /** undefined = unverändert */
  password?: string;
  oauthTokenUrl?: string | null;
  oauthClientId?: string | null;
  /** undefined = unverändert */
  oauthClientSecret?: string;
  oauthScope?: string | null;
}

/** Postfach ohne Geheimnisse, für die Oberfläche. */
export function toPublicMailbox(m: Mailbox) {
  const { passwordEnc, oauthClientSecretEnc, uidValidity: _uv, ...rest } = m;
  return { ...rest, hasPassword: !!passwordEnc, hasClientSecret: !!oauthClientSecretEnc };
}

@Injectable()
export class MailboxesService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tx: Tx = this.db): Promise<Mailbox[]> {
    return tx.select().from(mailboxes).orderBy(asc(mailboxes.name));
  }

  async get(id: string, tx: Tx = this.db): Promise<Mailbox> {
    const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
    if (!mailbox) throw new NotFoundException('Postfach nicht gefunden');
    return mailbox;
  }

  /** Eigene Adressen aller Postfächer (Kleinbuchstaben), um Schleifen und CC-Einträge zu vermeiden. */
  async ownAddresses(tx: Tx = this.db): Promise<Set<string>> {
    const rows = await tx.select({ address: mailboxes.address, username: mailboxes.username }).from(mailboxes);
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.address.toLowerCase());
      if (r.username.includes('@')) set.add(r.username.toLowerCase());
    }
    return set;
  }

  /** Standard-Postfach für intern erfasste Vorgänge. */
  async getDefault(tx: Tx = this.db): Promise<Mailbox | undefined> {
    const all = (await this.list(tx)).filter((m) => m.active);
    return all.find((m) => m.isDefault) ?? all[0];
  }

  /** Postfach für den Versand zu einem Vorgang: Antwort-Postfach, sonst Standard. */
  async forSending(mailboxId: string | null, tx: Tx = this.db): Promise<Mailbox | undefined> {
    if (mailboxId) {
      const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
      if (mailbox?.active) return mailbox;
    }
    return this.getDefault(tx);
  }

  async create(input: MailboxInput): Promise<Mailbox> {
    return this.db.transaction(async (tx) => {
      await this.assertUniqueAddress(tx, input.address);
      const values = this.toValues(input, undefined);
      const isFirst = (await this.list(tx)).length === 0;
      if (values.isDefault || isFirst) {
        values.isDefault = true;
        await tx.update(mailboxes).set({ isDefault: false });
      }
      const [created] = await tx.insert(mailboxes).values(values).returning();
      return created!;
    });
  }

  async update(id: string, input: MailboxInput): Promise<Mailbox> {
    return this.db.transaction(async (tx) => {
      const current = await this.get(id, tx);
      await this.assertUniqueAddress(tx, input.address, id);
      const values = this.toValues(input, current);
      const connectionChanged =
        values.imapHost !== current.imapHost ||
        values.imapFolder !== current.imapFolder ||
        values.username !== current.username;
      if (values.isDefault) await tx.update(mailboxes).set({ isDefault: false }).where(ne(mailboxes.id, id));
      const [updated] = await tx
        .update(mailboxes)
        .set({
          ...values,
          // Anderer Server/Ordner: Abruf beginnt neu bei den ungelesenen Mails
          ...(connectionChanged ? { uidValidity: null, lastUid: 0 } : {}),
          lastError: null,
        })
        .where(eq(mailboxes.id, id))
        .returning();
      return updated!;
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.get(id, tx);
      await tx.delete(mailboxes).where(eq(mailboxes.id, id));
      if (current.isDefault) {
        const [next] = await tx.select().from(mailboxes).orderBy(asc(mailboxes.name)).limit(1);
        if (next) await tx.update(mailboxes).set({ isDefault: true }).where(eq(mailboxes.id, next.id));
      }
    });
  }

  async recordPoll(id: string, state: { uidValidity?: number | null; lastUid?: number; error: string | null }) {
    await this.db
      .update(mailboxes)
      .set({
        lastPollAt: new Date(),
        lastError: state.error,
        ...(state.uidValidity !== undefined ? { uidValidity: state.uidValidity } : {}),
        ...(state.lastUid !== undefined ? { lastUid: state.lastUid } : {}),
      })
      .where(eq(mailboxes.id, id));
  }

  private async assertUniqueAddress(tx: Tx, address: string, exceptId?: string) {
    const [other] = await tx
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.address, address.trim().toLowerCase()))
      .limit(1);
    if (other && other.id !== exceptId) throw new ConflictException('Ein Postfach mit dieser Adresse existiert bereits');
  }

  private toValues(input: MailboxInput, current: Mailbox | undefined): typeof mailboxes.$inferInsert {
    const passwordEnc =
      input.password === undefined ? (current?.passwordEnc ?? null) : input.password ? encryptSecret(input.password) : null;
    const oauthClientSecretEnc =
      input.oauthClientSecret === undefined
        ? (current?.oauthClientSecretEnc ?? null)
        : input.oauthClientSecret
          ? encryptSecret(input.oauthClientSecret)
          : null;

    if (input.authType === 'password' && !passwordEnc) {
      throw new BadRequestException('Für die Anmeldung mit Passwort fehlt das Passwort');
    }
    if (input.authType === 'oauth2' && (!input.oauthTokenUrl || !input.oauthClientId || !oauthClientSecretEnc)) {
      throw new BadRequestException('Für OAuth 2.0 braucht es Token-URL, Client-ID und Client-Secret');
    }

    return {
      name: input.name.trim(),
      address: input.address.trim().toLowerCase(),
      active: input.active,
      isDefault: input.isDefault,
      imapHost: input.imapHost.trim(),
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      imapFolder: input.imapFolder.trim() || 'INBOX',
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      authType: input.authType,
      username: input.username.trim(),
      passwordEnc,
      oauthTokenUrl: input.oauthTokenUrl?.trim() || null,
      oauthClientId: input.oauthClientId?.trim() || null,
      oauthClientSecretEnc,
      oauthScope: input.oauthScope?.trim() || null,
    };
  }
}
