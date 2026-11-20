import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../db/schema';
import type { Permission } from '../settings/areas';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const PORTAL = 'portal';

/** Route ohne Anmeldung erreichbar. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Portal-Route: für alle angemeldeten Benutzer, auch mit Rolle Standard. */
export const PortalRoute = () => SetMetadata(PORTAL, true);

/** Route nur mit diesem Recht (Verwaltung → Rechte, Entscheid vom 20.11.2026); Admins haben alle Rechte. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

/** Route nur mit dem Recht «Verwaltung» (bis 20.11.2026: nur die Rolle Admin). */
export const AdminOnly = () => RequirePermission('admin');

export interface AuthedRequest extends Request {
  user?: User;
  sessionId?: string;
  /** «Als dieser Benutzer arbeiten»: der Admin dahinter; alle Rechte richten sich nach «user» */
  impersonator?: User;
}

/** Angemeldeter Benutzer der aktuellen Anfrage. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser ohne Anmeldung verwendet');
  return req.user;
});
