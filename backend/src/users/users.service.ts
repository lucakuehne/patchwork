import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { LdapService, type LdapIdentity, type PersonNames } from '../auth/ldap.service';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { users, type User, type UserRole } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { splitName } from './user-names';
import { directoryConflict } from './user-roles';

/** Vor- und Nachname neuer Kontakte aus dem Verzeichnis, nach E-Mail-Adresse in Kleinbuchstaben. */
export type DirectoryNames = Map<string, PersonNames>;

export interface PublicUser {
  id: string;
  name: string;
  /** Vor- und Nachname für Platzhalter (siehe splitName) */
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}

export interface AdminUser extends PublicUser {
  authSource: User['authSource'];
  /** AD-Konto mit von Hand festgelegter Rolle */
  roleManual: boolean;
  active: boolean;
  hasPassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  name: u.name,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  role: u.role,
});

export const toAdminUser = (u: User): AdminUser => ({
  ...toPublicUser(u),
  authSource: u.authSource,
  roleManual: u.roleManual,
  active: u.active,
  hasPassword: !!u.passwordHash,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password).catch(() => false);
}

function displayNameFromEmail(email: string): string {
  return email.split('@')[0] ?? email;
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  // LdapService und SettingsService hängen nur von der Datenbank ab, deshalb kein Zyklus mit AuthService
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
  ) {}

  async getById(id: string, tx: Tx = this.db): Promise<User> {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException('Benutzer nicht gefunden');
    return user;
  }

  async findByEmail(email: string, tx: Tx = this.db): Promise<User | undefined> {
    const [user] = await tx.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    return user;
  }

  /**
   * Sucht einen Benutzer per E-Mail oder legt ihn als Standard-Benutzer ohne Login an
   * (z.B. unbekannter Absender oder CC-Empfänger einer Mail). Vor- und Nachname kommen aus «directory»
   * (vorher mit directoryNames im AD nachgeschlagen), sonst werden sie aus dem Namen geschätzt.
   */
  async findOrCreateContact(
    email: string,
    name: string | undefined,
    tx: Tx = this.db,
    directory?: DirectoryNames,
  ): Promise<User> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.findByEmail(normalized, tx);
    if (existing) return existing;
    const displayName = name?.trim() || displayNameFromEmail(normalized);
    const { firstName, lastName } = directory?.get(normalized) ?? splitName(displayName);
    const [created] = await tx
      .insert(users)
      .values({ email: normalized, name: displayName, firstName, lastName, role: 'standard', authSource: 'local' })
      .onConflictDoNothing({ target: users.email })
      .returning();
    // Gleichzeitig angelegt: vorhandenen Datensatz nehmen
    return created ?? (await this.findByEmail(normalized, tx))!;
  }

  /**
   * Schlägt E-Mail-Adressen, die es in Patchwork noch nicht gibt, bei aktiver LDAP-Anmeldung im Verzeichnis nach:
   * Vor- und Nachname für neue Kontakte (findOrCreateContact). Fehler und fehlende Treffer bleiben still, dann wird
   * der Name geschätzt. Ausserhalb von Transaktionen aufrufen, die Abfrage geht übers Netz.
   */
  async directoryNames(emails: string[]): Promise<DirectoryNames> {
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const known = new Set((await this.byEmails(wanted)).map((u) => u.email));
    const unknown = wanted.filter((e) => !known.has(e));
    if (unknown.length === 0) return new Map();
    const cfg = await this.settings.get('ldap');
    if (!cfg.enabled || !cfg.url.trim()) return new Map();
    try {
      return await this.ldap.lookupNames(cfg, unknown);
    } catch (err) {
      this.logger.warn(`Vor- und Nachname im Verzeichnis nicht abrufbar: ${this.ldap.explain(err)}`);
      return new Map();
    }
  }

  /** Beim Start im Hintergrund, damit ein langsames Verzeichnis den Start nicht aufhält */
  onApplicationBootstrap() {
    void this.syncDirectoryNamesOnce().catch((err) =>
      this.logger.warn(`Vor- und Nachname der Kontakte nicht aus dem Verzeichnis übernommen, nächster Versuch beim nächsten Start: ${this.ldap.explain(err)}`),
    );
  }

  /**
   * Einmalig nach dem Update (bestätigt am 20.10.2026): Kontakte ohne Anmeldung über das AD (bisher nur geschätzt) per
   * E-Mail im Verzeichnis nachschlagen und Vor- und Nachname übernehmen, wo es einen Treffer gibt. Ohne LDAP gibt es
   * nichts nachzuschlagen; ist das Verzeichnis nicht erreichbar, folgt der nächste Versuch beim nächsten Start.
   */
  async syncDirectoryNamesOnce(): Promise<number> {
    if ((await this.settings.get('userNames')).directorySyncedAt) return 0;
    const cfg = await this.settings.get('ldap');
    let updated = 0;
    if (cfg.enabled && cfg.url.trim()) {
      const contacts = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.authSource, 'local'));
      const names = contacts.length ? await this.ldap.lookupNames(cfg, contacts.map((c) => c.email)) : new Map<string, PersonNames>();
      for (const contact of contacts) {
        const found = names.get(contact.email);
        if (!found) continue;
        await this.db.update(users).set(found).where(eq(users.id, contact.id));
        updated++;
      }
      this.logger.log(`Vor- und Nachname von ${updated} von ${contacts.length} Kontakten aus dem Verzeichnis übernommen`);
    }
    await this.settings.set('userNames', { directorySyncedAt: new Date().toISOString() });
    return updated;
  }

  /** Aktive Benutzer mit Rolle Admin oder IT, z.B. für die Auswahl «Zuständig». */
  listStaff(): Promise<User[]> {
    return this.db
      .select()
      .from(users)
      .where(and(eq(users.active, true), inArray(users.role, ['admin', 'it'])))
      .orderBy(asc(users.name));
  }

  /** Benutzer zu E-Mail-Adressen (in Kleinbuchstaben), auch deaktivierte. */
  byEmails(emails: string[]): Promise<User[]> {
    if (emails.length === 0) return Promise.resolve([]);
    return this.db.select().from(users).where(inArray(users.email, emails));
  }

  /** Suche über alle aktiven Benutzer: Jedes Wort muss in Name oder E-Mail vorkommen (wie im Verzeichnis). */
  search(query: string, limit = 20): Promise<User[]> {
    const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    if (words.length === 0) return Promise.resolve([]);
    const matches = words.map((word) => {
      const pattern = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return or(ilike(users.name, pattern), ilike(users.email, pattern));
    });
    return this.db
      .select()
      .from(users)
      .where(and(eq(users.active, true), ...matches))
      .orderBy(asc(users.name))
      .limit(limit);
  }

  listAll(): Promise<User[]> {
    return this.db.select().from(users).orderBy(asc(users.name));
  }

  async countActiveAdmins(tx: Tx = this.db, excludeId?: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(eq(users.role, 'admin'), eq(users.active, true), excludeId ? ne(users.id, excludeId) : undefined),
      );
    return row?.count ?? 0;
  }

  /** Lokales Konto anlegen; fehlen Vor- oder Nachname, werden sie aus dem Namen geschätzt. */
  async create(input: {
    name: string;
    firstName?: string;
    lastName?: string;
    email: string;
    role: UserRole;
    password?: string | null;
  }): Promise<User> {
    if (await this.findByEmail(input.email)) {
      throw new ConflictException('Es gibt bereits einen Benutzer mit dieser E-Mail-Adresse');
    }
    const passwordHash = input.password ? await this.checkedHash(input.password) : null;
    const name = input.name.trim();
    const estimated = splitName(name);
    const [created] = await this.db
      .insert(users)
      .values({
        name,
        firstName: input.firstName?.trim() ?? estimated.firstName,
        lastName: input.lastName?.trim() ?? estimated.lastName,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        passwordHash,
      })
      .returning();
    return created!;
  }

  /**
   * Legt ein AD-Konto an, bevor sich die Person zum ersten Mal anmeldet, bzw. übernimmt den Kontakt mit derselben
   * E-Mail. «manualRole» null = Rolle aus den AD-Gruppen, sonst von Hand festgelegt.
   */
  async createFromDirectory(person: LdapIdentity, manualRole: UserRole | null): Promise<User> {
    return this.db.transaction(async (tx) => {
      const existing = await this.findByEmail(person.email, tx);
      const conflict = directoryConflict(existing);
      if (conflict) throw new ConflictException(conflict);
      const values = {
        name: person.name,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        role: manualRole ?? person.role,
        roleManual: manualRole !== null,
        authSource: 'ldap' as const,
        ldapDn: person.dn,
        passwordHash: null,
      };
      const [saved] = existing
        ? await tx.update(users).set(values).where(eq(users.id, existing.id)).returning()
        : await tx.insert(users).values(values).returning();
      return saved!;
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      /** Bei AD-Konten nur bis zur nächsten Anmeldung, dann gelten wieder die Angaben aus dem AD */
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: UserRole;
      roleManual?: boolean;
      active?: boolean;
      password?: string | null;
    },
  ): Promise<User> {
    return this.db.transaction(async (tx) => {
      const user = await this.getById(id, tx);
      const changes: Partial<typeof users.$inferInsert> = {};
      if (input.name !== undefined) changes.name = input.name.trim();
      if (input.firstName !== undefined) changes.firstName = input.firstName.trim();
      if (input.lastName !== undefined) changes.lastName = input.lastName.trim();
      if (input.email !== undefined) {
        const email = input.email.trim().toLowerCase();
        const other = await this.findByEmail(email, tx);
        if (other && other.id !== id) {
          throw new ConflictException('Es gibt bereits einen Benutzer mit dieser E-Mail-Adresse');
        }
        changes.email = email;
      }
      if (input.role !== undefined) changes.role = input.role;
      if (input.roleManual !== undefined) changes.roleManual = input.roleManual;
      if (input.active !== undefined) changes.active = input.active;
      if (input.password !== undefined) {
        if (user.authSource !== 'local') {
          throw new BadRequestException('Das Passwort von LDAP-Benutzern wird im Verzeichnis verwaltet');
        }
        changes.passwordHash = input.password ? await this.checkedHash(input.password) : null;
      }

      const losesAdmin =
        user.role === 'admin' &&
        ((changes.role !== undefined && changes.role !== 'admin') || changes.active === false);
      if (losesAdmin && (await this.countActiveAdmins(tx, id)) === 0) {
        throw new BadRequestException('Es muss mindestens ein aktiver Admin bestehen bleiben');
      }

      if (Object.keys(changes).length === 0) return user;
      const [updated] = await tx.update(users).set(changes).where(eq(users.id, id)).returning();
      return updated!;
    });
  }

  private async checkedHash(password: string): Promise<string> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`);
    }
    return hashPassword(password);
  }
}
