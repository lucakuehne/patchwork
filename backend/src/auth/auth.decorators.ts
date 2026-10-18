import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../db/schema';

export const IS_PUBLIC = 'isPublic';
export const ADMIN_ONLY = 'adminOnly';
export const PORTAL = 'portal';

/** Route ohne Anmeldung erreichbar. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Portal-Route: für alle angemeldeten Benutzer, auch mit Rolle Standard. */
export const PortalRoute = () => SetMetadata(PORTAL, true);

/** Route nur für die Rolle Admin. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

export interface AuthedRequest extends Request {
  user?: User;
  sessionId?: string;
}

/** Angemeldeter Benutzer der aktuellen Anfrage. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser ohne Anmeldung verwendet');
  return req.user;
});
