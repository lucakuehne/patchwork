import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { users, type User } from '../db/schema';
import { PORTAL_REFUSED, PortalAccessService } from '../portal/portal-access.service';
import { SettingsService } from '../settings/settings.service';
import { splitName } from '../users/user-names';
import { roleAtLogin } from '../users/user-roles';
import { hashPassword, MIN_PASSWORD_LENGTH, UsersService, verifyPassword } from '../users/users.service';
import { LdapAccountStateError, LdapService } from './ldap.service';

const FAILED = 'Anmeldung fehlgeschlagen. Bitte Benutzername und Passwort prüfen.';
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly attempts = new Map<string, { count: number; since: number }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
    private readonly portalAccess: PortalAccessService,
  ) {}

  async login(username: string, password: string, ip: string): Promise<User> {
    const throttleKey = `${ip}|${username.trim().toLowerCase()}`;
    this.checkThrottle(throttleKey);

    const user = await this.tryLogin(username.trim(), password);
    if (!user) {
      this.registerFailure(throttleKey);
      throw new UnauthorizedException(FAILED);
    }
    this.attempts.delete(throttleKey);
    if (!user.active) throw new ForbiddenException('Dieses Konto ist deaktiviert.');
    // Admin und IT nutzen die Oberfläche, Standard-Benutzer das Portal, sofern es für sie freigeschaltet ist
    if (!(await this.portalAccess.allowed(user))) throw new ForbiddenException(PORTAL_REFUSED);
    return user;
  }

  private async tryLogin(username: string, password: string): Promise<User | null> {
    const local = username.includes('@') ? await this.users.findByEmail(username) : undefined;
    if (local?.authSource === 'local' && local.passwordHash) {
      return (await verifyPassword(local.passwordHash, password)) ? local : null;
    }

    const ldapCfg = await this.settings.get('ldap');
    if (!ldapCfg.enabled) return null;

    let identity;
    try {
      identity = await this.ldap.authenticate(ldapCfg, username, password);
    } catch (err) {
      if (err instanceof LdapAccountStateError) throw new ForbiddenException(err.message);
      this.logger.error(`LDAP-Anmeldung fehlgeschlagen: ${this.ldap.explain(err)}`);
      throw new ServiceUnavailableException(
        'Die Anmeldung über das Verzeichnis (LDAP) ist zurzeit nicht möglich. Bitte die Administration informieren.',
      );
    }
    if (!identity) return null;

    const existing = await this.users.findByEmail(identity.email);
    if (existing && existing.authSource === 'local' && existing.passwordHash) {
      throw new ForbiddenException('Für diese E-Mail-Adresse besteht bereits ein lokales Konto.');
    }

    // Anlegen bzw. mit dem Kontakt aus Mails (gleiche E-Mail) zusammenführen; Name, Vor- und Nachname aus dem AD,
    // Rolle aus den AD-Gruppen, ausser sie ist von Hand festgelegt
    const values = {
      name: identity.name,
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email,
      role: roleAtLogin(existing, identity.role),
      authSource: 'ldap' as const,
      ldapDn: identity.dn,
      passwordHash: null,
    };
    if (existing) {
      const [updated] = await this.db.update(users).set(values).where(eq(users.id, existing.id)).returning();
      return updated!;
    }
    const [created] = await this.db.insert(users).values(values).returning();
    return created!;
  }

  async isSetupRequired(): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'admin'));
    return (row?.count ?? 0) === 0;
  }

  /** Einrichtungs-Assistent: legt den ersten Admin an. Nur möglich, solange es keinen Admin gibt. */
  async setup(input: { appName: string; name: string; email: string; password: string }): Promise<User> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`);
    }
    const passwordHash = await hashPassword(input.password);
    const admin = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4711001)`);
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.role, 'admin'));
      if ((row?.count ?? 0) > 0) throw new ForbiddenException('Patchwork ist bereits eingerichtet.');

      const email = input.email.trim().toLowerCase();
      const name = input.name.trim();
      const values = {
        name,
        ...splitName(name),
        email,
        role: 'admin' as const,
        authSource: 'local' as const,
        passwordHash,
      };
      const [created] = await tx
        .insert(users)
        .values(values)
        .onConflictDoUpdate({ target: users.email, set: values })
        .returning();
      return created!;
    });
    await this.settings.set('general', { appName: input.appName.trim() || 'Patchwork' });
    return admin;
  }

  private checkThrottle(key: string) {
    const entry = this.attempts.get(key);
    if (!entry) return;
    if (Date.now() - entry.since > WINDOW_MS) {
      this.attempts.delete(key);
      return;
    }
    if (entry.count >= MAX_ATTEMPTS) {
      throw new ForbiddenException('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    }
  }

  private registerFailure(key: string) {
    const entry = this.attempts.get(key);
    if (!entry || Date.now() - entry.since > WINDOW_MS) this.attempts.set(key, { count: 1, since: Date.now() });
    else entry.count += 1;
    if (this.attempts.size > 10000) this.attempts.clear();
  }
}
