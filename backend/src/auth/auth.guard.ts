import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ADMIN_ONLY, AuthedRequest, IS_PUBLIC, PORTAL } from './auth.decorators';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Globaler Guard: Alle Routen verlangen eine Anmeldung mit Rolle Admin oder IT,
 * ausser sie sind mit @Public markiert. Schreibende Anfragen brauchen zusätzlich
 * den Header «X-Patchwork» als Schutz gegen Cross-Site-Requests.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const targets = [context.getHandler(), context.getClass()];

    if (!SAFE_METHODS.has(req.method) && req.header('x-patchwork') !== '1') {
      throw new ForbiddenException('Anfrage abgelehnt');
    }

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) {
      const found = await this.sessions.resolve(token, res);
      if (found) {
        req.user = found.user;
        req.sessionId = found.sessionId;
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    if (!req.user) throw new UnauthorizedException('Nicht angemeldet');
    // Portal-Routen stehen allen angemeldeten Benutzern offen, alles andere nur Admin und IT
    if (this.reflector.getAllAndOverride<boolean>(PORTAL, targets)) return true;
    if (req.user.role !== 'admin' && req.user.role !== 'it') throw new ForbiddenException('Kein Zugang');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && req.user.role !== 'admin') {
      throw new ForbiddenException('Nur für Administratoren');
    }
    return true;
  }
}
