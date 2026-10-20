import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { LdapIdentity } from '../auth/ldap.service';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { users, type User, type UserRole } from '../db/schema';
import { directoryConflict } from './user-roles';

export interface PublicUser {
  id: string;
  name: string;
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

export const toPublicUser = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

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
export class UsersService {
  constructor(@InjectDb() private readonly db: Db) {}

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
   * (z.B. unbekannter Absender oder CC-Empfänger einer Mail).
   */
  async findOrCreateContact(email: string, name: string | undefined, tx: Tx = this.db): Promise<User> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.findByEmail(normalized, tx);
    if (existing) return existing;
    const [created] = await tx
      .insert(users)
      .values({
        email: normalized,
        name: name?.trim() || displayNameFromEmail(normalized),
        role: 'standard',
        authSource: 'local',
      })
      .onConflictDoNothing({ target: users.email })
      .returning();
    // Gleichzeitig angelegt: vorhandenen Datensatz nehmen
    return created ?? (await this.findByEmail(normalized, tx))!;
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

  async create(input: {
    name: string;
    email: string;
    role: UserRole;
    password?: string | null;
  }): Promise<User> {
    if (await this.findByEmail(input.email)) {
      throw new ConflictException('Es gibt bereits einen Benutzer mit dieser E-Mail-Adresse');
    }
    const passwordHash = input.password ? await this.checkedHash(input.password) : null;
    const [created] = await this.db
      .insert(users)
      .values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, passwordHash })
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
