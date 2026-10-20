import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { PORTAL_REFUSED, PortalAccessService } from '../portal/portal-access.service';
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
    private readonly portalAccess: PortalAccessService,
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
    // Portal-Routen: angemeldete Benutzer, für die das Portal freigeschaltet ist (IT und Admins immer). Alles andere nur Admin und IT.
    if (this.reflector.getAllAndOverride<boolean>(PORTAL, targets)) {
      if (!(await this.portalAccess.allowed(req.user))) throw new ForbiddenException(PORTAL_REFUSED);
      return true;
    }
    if (req.user.role !== 'admin' && req.user.role !== 'it') throw new ForbiddenException('Kein Zugang');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && req.user.role !== 'admin') {
      throw new ForbiddenException('Nur für Administratoren');
    }
    return true;
  }
}
