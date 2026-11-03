import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { concatMap, type Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.decorators';
import { AUDIT, type AuditSpec } from './audit.decorators';
import { AuditService } from './audit.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Schreibt Routen mit @Audit ins Aktionsprotokoll, sobald sie ohne Fehler durchgelaufen sind. Das Objekt wird vorher
 * gelesen (beim Löschen ist es danach weg). Ein Fehler beim Protokollieren bricht die Aktion nicht ab.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const spec = this.reflector.get<AuditSpec | false | undefined>(AUDIT, context.getHandler());
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!spec || !user || SAFE_METHODS.has(req.method)) return next.handle();

    const params = { ...(req.params as Record<string, string>) };
    const before = await this.audit.resolve(spec, params).catch((err: Error) => {
      this.logger.warn(`Objekt für das Aktionsprotokoll nicht gefunden: ${err.message}`);
      return null;
    });
    const impersonator = req.impersonator ?? null;
    return next.handle().pipe(
      concatMap(async (result: unknown) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        await this.audit
          .recordRequest(spec, user, impersonator, { body, params, result, before })
          .catch((err: Error) => this.logger.error(`Aktionsprotokoll: ${err.message}`));
        return result;
      }),
    );
  }
}
