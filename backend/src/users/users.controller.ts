import { Body, Controller, Get, Logger, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { LdapService, type DirectoryPerson } from '../auth/ldap.service';
import { SessionService } from '../auth/session.service';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import type { UserRole } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { toAdminUser, toPublicUser, UsersService } from './users.service';

const roleSchema = z.enum(['admin', 'it', 'standard']);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  email: emailSchema,
  role: roleSchema,
  password: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200).optional(),
  email: emailSchema.optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  /** '' = Passwort entfernen */
  password: z.string().max(500).optional(),
});

/** Treffer der Personensuche: Benutzer aus Patchwork (mit id) oder Konto aus dem Verzeichnis (id null). */
interface PersonHit {
  id: string | null;
  name: string;
  email: string;
  role: UserRole | null;
  /** Anmeldename im Verzeichnis */
  username: string | null;
  source: 'patchwork' | 'directory';
}

const contactSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: emailSchema,
});

@Controller()
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
  ) {}

  /** Admin- und IT-Benutzer, z.B. für «Zuständig». */
  @Get('users/staff')
  async staff() {
    return (await this.users.listStaff()).map(toPublicUser);
  }

  /**
   * Personen für Melder und Beteiligte: Benutzer und Kontakte aus Patchwork (Name, E-Mail) und, wenn die
   * LDAP-Anmeldung aktiv ist, Konten aus dem Verzeichnis (Name, Anmeldename, E-Mail; ab 2 Zeichen).
   */
  @Get('people/search')
  async searchPeople(@Query('q') q = ''): Promise<{ people: PersonHit[]; directoryError: string | null }> {
    const query = q.trim().slice(0, 100);
    if (!query) return { people: [], directoryError: null };

    const hits = new Map<string, PersonHit>();
    for (const u of await this.users.search(query)) {
      hits.set(u.email, { ...toPublicUser(u), username: null, source: 'patchwork' });
    }

    let directory: DirectoryPerson[] = [];
    let directoryError: string | null = null;
    const ldap = await this.settings.get('ldap');
    if (ldap.enabled && query.length >= 2) {
      try {
        directory = await this.ldap.searchPeople(ldap, query);
      } catch (err) {
        this.logger.warn(`Personensuche im Verzeichnis fehlgeschlagen: ${this.ldap.explain(err)}`);
        directoryError = 'Die Suche im Verzeichnis (AD) ist zurzeit nicht möglich.';
      }
    }
    // Konten, die es in Patchwork schon gibt, als diese Benutzer zeigen; in Patchwork deaktivierte weglassen
    const known = new Map((await this.users.byEmails(directory.map((p) => p.email))).map((u) => [u.email, u]));
    for (const person of directory) {
      const user = known.get(person.email);
      if (user && !user.active) continue;
      if (user) hits.set(user.email, { ...toPublicUser(user), username: person.username, source: 'patchwork' });
      else if (!hits.has(person.email)) hits.set(person.email, { id: null, role: null, ...person, source: 'directory' });
    }
    const people = [...hits.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return { people, directoryError };
  }

  /** Legt einen Kontakt (Rolle Standard, ohne Login) an oder liefert den vorhandenen Benutzer. */
  @Post('users/contacts')
  async contact(@Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) {
    return toPublicUser(await this.users.findOrCreateContact(body.email, body.name));
  }

  @AdminOnly()
  @Get('admin/users')
  async list() {
    return (await this.users.listAll()).map(toAdminUser);
  }

  @AdminOnly()
  @Post('admin/users')
  async create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return toAdminUser(await this.users.create(body));
  }

  @AdminOnly()
  @Patch('admin/users/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    const updated = await this.users.update(id, body);
    if (body.active === false || body.password !== undefined) await this.sessions.destroyAllForUser(id);
    return toAdminUser(updated);
  }
}
