import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { toPublicUser } from '../users/users.service';
import { AuthedRequest, Public } from './auth.decorators';
import { AuthService } from './auth.service';
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
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body.username, body.password, req.ip ?? '');
    await this.sessions.create(user.id, res);
    return toPublicUser(user);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req.sessionId, res);
  }

  /** Aktueller Benutzer oder null. */
  @Public()
  @Get('auth/me')
  me(@Req() req: AuthedRequest) {
    return { user: req.user ? toPublicUser(req.user) : null };
  }

  @Public()
  @Post('setup')
  async setup(
    @Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.auth.setup(body);
    await this.sessions.create(admin.id, res);
    return toPublicUser(admin);
  }
}
