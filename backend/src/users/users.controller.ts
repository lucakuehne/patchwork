import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminOnly, CurrentUser, type AuthedRequest } from '../auth/auth.decorators';
import { LdapService, type DirectoryPerson, type LdapIdentity } from '../auth/ldap.service';
import { SessionService } from '../auth/session.service';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import type { User, UserRole } from '../db/schema';
import { WelcomeMailService } from '../mail/welcome-mail.service';
import { SettingsService } from '../settings/settings.service';
import { mergePreferences, preferencesPatchSchema, withDefaults } from './preferences';
import { toAdminUser, toPublicUser, UsersService } from './users.service';

const roleSchema = z.enum(['admin', 'it', 'standard']);

/** Vor- bzw. Nachname, darf leer sein (z.B. Konto ohne Nachname) */
const namePartSchema = z.string().trim().max(100, 'Höchstens 100 Zeichen');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  /** Ohne Angabe aus dem Namen geschätzt */
  firstName: namePartSchema.optional(),
  lastName: namePartSchema.optional(),
  email: emailSchema,
  role: roleSchema,
  password: z.string().max(500).optional(),
});

/** «auto» = Rolle aus den AD-Gruppen (nur AD-Konten), sonst von Hand festgelegt */
const roleChoiceSchema = z.enum(['auto', 'admin', 'it', 'standard']);

const directorySchema = z.object({
  email: emailSchema,
  role: roleChoiceSchema,
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200).optional(),
  firstName: namePartSchema.optional(),
  lastName: namePartSchema.optional(),
  email: emailSchema.optional(),
  role: roleChoiceSchema.optional(),
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
    private readonly welcomeMail: WelcomeMailService,
  ) {}

  /** Eigene Einstellungen: offene Störungen/Aufgaben als Board oder Liste, Vorgänge als Seite oder Fenster öffnen */
  @Get('me/preferences')
  preferences(@CurrentUser() user: User) {
    return withDefaults(user.preferences);
  }

  @Put('me/preferences')
  async updatePreferences(
    @Body(new ZodPipe(preferencesPatchSchema)) body: z.infer<typeof preferencesPatchSchema>,
    @CurrentUser() user: User,
  ) {
    const stored = mergePreferences(user.preferences, body);
    await this.users.setPreferences(user.id, stored);
    return withDefaults(stored);
  }

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
  async searchPeople(
    @Query('q') q = '',
    @Query('scope') scope?: string,
  ): Promise<{ people: PersonHit[]; directoryError: string | null }> {
    const query = q.trim().slice(0, 100);
    if (!query) return { people: [], directoryError: null };
    // scope=directory: nur Konten aus dem AD (Benutzer vorab anlegen), bekannte als Benutzer aus Patchwork
    const directoryOnly = scope === 'directory';

    const hits = new Map<string, PersonHit>();
    if (!directoryOnly) {
      for (const u of await this.users.search(query)) {
        hits.set(u.email, { ...toPublicUser(u), username: null, source: 'patchwork' });
      }
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

  /**
   * Legt einen Kontakt (Rolle Standard, ohne Login) an oder liefert den vorhandenen Benutzer. Vor- und Nachname
   * neuer Kontakte kommen bei aktiver LDAP-Anmeldung aus dem AD, sonst aus dem Namen.
   */
  @Post('users/contacts')
  async contact(@Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) {
    const directory = await this.users.directoryNames([body.email]);
    return toPublicUser(await this.users.findOrCreateContact(body.email, body.name, undefined, directory));
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

  /** Person im AD mit der Rolle aus den AD-Gruppen (Vorschlag beim Anlegen und Bearbeiten). */
  @AdminOnly()
  @Get('admin/users/directory')
  async directoryPerson(@Query('email') email = ''): Promise<LdapIdentity> {
    return this.lookup(email);
  }

  /** Legt eine Person aus dem AD an, bevor sie sich zum ersten Mal anmeldet. */
  @AdminOnly()
  @Post('admin/users/directory')
  async createFromDirectory(@Body(new ZodPipe(directorySchema)) body: z.infer<typeof directorySchema>) {
    const person = await this.lookup(body.email);
    return toAdminUser(await this.users.createFromDirectory(person, body.role === 'auto' ? null : body.role));
  }

  @AdminOnly()
  @Patch('admin/users/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    const { role, ...rest } = body;
    const user = await this.users.getById(id);
    let roleChange: { role?: UserRole; roleManual?: boolean } = {};
    if (role === 'auto') {
      if (user.authSource !== 'ldap') throw new BadRequestException('«Aus AD-Gruppen» gibt es nur für AD-Konten.');
      if (user.roleManual) {
        // Zurück von «von Hand»: Ohne Rolle aus dem AD geht das nicht
        roleChange = { role: (await this.lookup(user.email)).role, roleManual: false };
      } else {
        // Schon «Aus AD-Gruppen»: aktuelle Rolle nachziehen (z.B. vorab angelegt, Gruppe seither geändert);
        // ist das AD nicht erreichbar, bleibt die gespeicherte Rolle bis zur nächsten Anmeldung
        const current = await this.lookup(user.email).catch(() => null);
        if (current) roleChange = { role: current.role };
      }
    } else if (role !== undefined) {
      roleChange = { role, roleManual: user.authSource === 'ldap' };
    }
    const updated = await this.users.update(id, { ...rest, ...roleChange });
    if (body.active === false || body.password !== undefined) await this.sessions.destroyAllForUser(id);
    // Kein Admin mehr: «Als Benutzer»-Sitzungen, die er gestartet hat, enden sofort
    else if (user.role === 'admin' && updated.role !== 'admin') await this.sessions.destroyImpersonationsBy(id);
    return toAdminUser(updated);
  }

  /** Willkommens-Mail von Hand, nur an aktive Benutzer mit Rolle IT oder Admin (auch erneut). */
  @AdminOnly()
  @Post('admin/users/:id/welcome')
  @HttpCode(204)
  async welcome(@Param('id', ParseUUIDPipe) id: string) {
    await this.welcomeMail.send(await this.users.getById(id));
  }

  /**
   * «Als dieser Benutzer arbeiten»: Die Sitzung des Admins wird durch eine Sitzung des Benutzers ersetzt, die auf den
   * Admin verweist (zurück über POST /auth/impersonation/end). Nur für aktive Benutzer mit Rolle IT oder Admin.
   */
  @AdminOnly()
  @Post('admin/users/:id/impersonate')
  async impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = req.user!;
    if (req.impersonator) throw new BadRequestException('Bitte zuerst zu deinem eigenen Konto zurückkehren.');
    const target = await this.users.getById(id);
    if (target.id === admin.id) throw new BadRequestException('Das ist dein eigenes Konto.');
    if (!target.active) throw new BadRequestException('Der Benutzer ist deaktiviert.');
    if (target.role !== 'admin' && target.role !== 'it') {
      throw new BadRequestException('Nur als Benutzer mit Rolle IT oder Admin möglich.');
    }
    await this.sessions.switchTo(req.sessionId, target.id, res, admin.id);
    this.logger.log(`${admin.email} arbeitet als ${target.email}`);
    return toPublicUser(target);
  }

  private async lookup(email: string): Promise<LdapIdentity> {
    const cfg = await this.settings.get('ldap');
    if (!cfg.enabled) throw new BadRequestException('Die Anmeldung über LDAP/AD ist ausgeschaltet.');
    let person: LdapIdentity | null;
    try {
      person = await this.ldap.lookupPerson(cfg, email);
    } catch (err) {
      this.logger.warn(`Abfrage im Verzeichnis fehlgeschlagen: ${this.ldap.explain(err)}`);
      throw new ServiceUnavailableException('Das Verzeichnis (AD) ist zurzeit nicht erreichbar.');
    }
    if (!person) {
      throw new NotFoundException(
        'Diese Person ist im AD nicht zu finden, deaktiviert oder nicht eindeutig (mehrere Konten mit dieser E-Mail).',
      );
    }
    return person;
  }
}
