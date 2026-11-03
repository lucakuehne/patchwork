import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Audit, NoAudit } from '../audit/audit.decorators';
import { AuditService, type AuditRecord } from '../audit/audit.service';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { toPublicUser } from '../users/users.service';
import { AuthedRequest, Public } from './auth.decorators';
import { AuthService, TOO_MANY_ATTEMPTS } from './auth.service';
import { SessionService } from './session.service';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Benutzername fehlt'),
  password: z.string().min(1, 'Passwort fehlt'),
});

const setupSchema = z.object({
  appName: z.string().trim().max(100).default('Patchwork'),
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  email: emailSchema,
  password: z.string().max(500),
});

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Im Aktionsprotokoll auch fehlgeschlagene Anmeldungen, ausser gebremste (zu viele Versuche) */
  @Public()
  @NoAudit()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    let user;
    try {
      user = await this.auth.login(body.username, body.password, req.ip ?? '');
    } catch (err) {
      const message = (err as Error).message;
      if (message !== TOO_MANY_ATTEMPTS) {
        await this.record({ user: null, userName: body.username, area: 'account', action: 'Anmeldung fehlgeschlagen', target: message });
      }
      throw err;
    }
    await this.sessions.create(user.id, res);
    await this.record({ user, area: 'account', action: 'Angemeldet' });
    return toPublicUser(user);
  }

  /** Eintrag im Aktionsprotokoll; ein Fehler dabei verhindert die Anmeldung nicht */
  private record(entry: AuditRecord) {
    return this.audit.record(entry).catch((err: Error) => this.logger.error(`Aktionsprotokoll: ${err.message}`));
  }

  @Public()
  @Audit('account', 'Abgemeldet')
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req.sessionId, res);
  }

  /** Aktueller Benutzer oder null; bei «Als dieser Benutzer arbeiten» auch der Admin dahinter. */
  @Public()
  @Get('auth/me')
  me(@Req() req: AuthedRequest) {
    return {
      user: req.user ? toPublicUser(req.user) : null,
      impersonator: req.impersonator ? toPublicUser(req.impersonator) : null,
    };
  }

  /**
   * «Als dieser Benutzer arbeiten» beenden: zurück zur Sitzung des Admins. Ohne Rollenprüfung, damit der Weg zurück auch
   * offen bleibt, wenn der Benutzer inzwischen die Rolle Standard hat; die Sitzung selbst prüft den Admin dahinter.
   */
  @Public()
  @NoAudit()
  @Post('auth/impersonation/end')
  async endImpersonation(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const admin = req.impersonator;
    if (!admin) throw new BadRequestException('Du arbeitest nicht als anderer Benutzer.');
    await this.sessions.switchTo(req.sessionId, admin.id, res, null);
    this.logger.log(`${admin.email} arbeitet nicht mehr als ${req.user?.email}`);
    // Im Protokoll unter dem Admin, nicht unter dem Benutzer
    await this.record({ user: admin, area: 'account', action: '«Als dieser Benutzer arbeiten» beendet', target: req.user?.name });
    return toPublicUser(admin);
  }

  @Public()
  @NoAudit()
  @Post('setup')
  async setup(
    @Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.auth.setup(body);
    await this.sessions.create(admin.id, res);
    await this.record({ user: admin, area: 'admin', action: 'Ersteinrichtung' });
    return toPublicUser(admin);
  }
}
