import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Audit, NoAudit } from '../audit/audit.decorators';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { InjectDb, type Db } from '../db/db.module';
import { rules } from '../db/schema';
import { mailKinds, type TemplateKey } from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';

const templateSchema = z.object({
  subject: z.string().max(500).nullable(),
  body: z.string().max(20000).nullable(),
});

/** E-Mail-Vorlagen: ansehen, bearbeiten, zurücksetzen und mit Beispieldaten ansehen. */
@AdminOnly()
@Controller('admin/mail-templates')
export class MailTemplatesController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly templates: MailTemplatesService,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  /** Arten von Mails mit Erklärung und aktuellem Stand (Tooltips unter Verwaltung → Ausgehende Mails) */
  @Get('kinds')
  async kinds() {
    const active = await this.db.select({ name: rules.name, actions: rules.actions }).from(rules).where(eq(rules.active, true));
    return mailKinds(active);
  }

  @Audit('admin', 'E-Mail-Vorlage geändert', { target: 'mailTemplate' })
  @Put(':key')
  @HttpCode(204)
  async save(@Param('key') key: string, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    await this.templates.save(key as TemplateKey, body);
  }

  @Audit('admin', 'E-Mail-Vorlage zurückgesetzt', { target: 'mailTemplate' })
  @Delete(':key')
  @HttpCode(204)
  async reset(@Param('key') key: string) {
    await this.templates.reset(key as TemplateKey);
  }

  /** Vorschau des Entwurfs mit Beispieldaten */
  @NoAudit()
  @Post(':key/preview')
  @HttpCode(200)
  preview(@Param('key') key: string, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.templates.preview(key as TemplateKey, body);
  }
}
