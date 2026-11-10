import { Body, Controller, HttpCode, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Audit, NoAudit } from '../audit/audit.decorators';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { appConfig } from '../config';
import type { User } from '../db/schema';
import type { UploadedFile } from '../items/items.service';
import { AreasService } from '../settings/areas';
import { MailImportService, type ImportRow } from './mail-import.service';

const uploads = () => FilesInterceptor('files', 20, { limits: { fileSize: appConfig.maxUploadBytes, files: 20 } });

const importSchema = z.object({ confirmation: z.enum(['true', 'false']).transform((v) => v === 'true') });

/** Kurzfassung für das Aktionsprotokoll, z.B. «Mails importiert: 2 neue Vorgänge, 1 Antwort» */
function importAction(rows: ImportRow[]): string {
  const count = (results: string[]) => rows.filter((r) => results.includes(r.result)).length;
  const parts = [
    [count(['created']), 'neuer Vorgang', 'neue Vorgänge'],
    [count(['reply', 'note', 'automated']), 'Antwort', 'Antworten'],
    [count(['duplicate', 'ignored']), 'übersprungen', 'übersprungen'],
    [count(['failed']), 'Fehler', 'Fehler'],
  ] as const;
  const text = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return `Mails importiert${text.length ? `: ${text.join(', ')}` : ''}`;
}

/** Mails importieren im Eingang (Entscheid vom 10.11.2026), für IT und Admins mit Zugriff auf den Eingang */
@Controller()
export class MailImportController {
  constructor(
    private readonly imports: MailImportService,
    private readonly areas: AreasService,
  ) {}

  /** Eckdaten und Hinweise je Datei, ohne etwas zu übernehmen */
  @NoAudit()
  @Post('mail-import/preview')
  @HttpCode(200)
  @UseInterceptors(uploads())
  async preview(@UploadedFiles() files: UploadedFile[] | undefined, @CurrentUser() user: User) {
    await this.areas.assertType(user, null);
    return this.imports.preview(user, files ?? []);
  }

  @Audit('items', (c) => importAction(c.result as ImportRow[]))
  @Post('mail-import')
  @HttpCode(200)
  @UseInterceptors(uploads())
  async import(
    @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, null);
    return this.imports.importAll(user, files ?? [], body.confirmation);
  }
}
