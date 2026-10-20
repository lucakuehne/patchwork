import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { TemplateKey } from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';

const templateSchema = z.object({
  subject: z.string().max(500).nullable(),
  body: z.string().max(20000).nullable(),
});

/** E-Mail-Vorlagen: ansehen, bearbeiten, zurücksetzen und mit Beispieldaten ansehen. */
@AdminOnly()
@Controller('admin/mail-templates')
export class MailTemplatesController {
  constructor(private readonly templates: MailTemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Put(':key')
  @HttpCode(204)
  async save(@Param('key') key: string, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    await this.templates.save(key as TemplateKey, body);
  }

  @Delete(':key')
  @HttpCode(204)
  async reset(@Param('key') key: string) {
    await this.templates.reset(key as TemplateKey);
  }

  /** Vorschau des Entwurfs mit Beispieldaten */
  @Post(':key/preview')
  @HttpCode(200)
  preview(@Param('key') key: string, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.templates.preview(key as TemplateKey, body);
  }
}
