import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { auditArea } from '../db/schema';
import { AuditService } from './audit.service';

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v);

const listSchema = z.object({
  user: z.preprocess(emptyAsUndefined, z.uuid().optional()),
  area: z.preprocess(emptyAsUndefined, z.enum(auditArea.enumValues).optional()),
  from: z.preprocess(emptyAsUndefined, z.iso.date().optional()),
  to: z.preprocess(emptyAsUndefined, z.iso.date().optional()),
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Verwaltung → Aktionsprotokoll: nur Admins, nur lesen (Entscheid vom 03.11.2026) */
@AdminOnly()
@Controller('admin/audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.audit.list({ ...query, userId: query.user });
  }

  /** Personen mit Einträgen, für den Filter */
  @Get('people')
  people() {
    return this.audit.people();
  }
}
