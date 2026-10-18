import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SnippetsService } from './snippets.service';

const snippetSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  body: z
    .string()
    .max(20000)
    .transform((s) => s.replace(/\r\n?/g, '\n'))
    .refine((s) => s.trim().length > 0, 'Der Text ist leer'),
});

@Controller()
export class SnippetsController {
  constructor(private readonly snippets: SnippetsService) {}

  /** Für Admin und IT zum Einfügen */
  @Get('snippets')
  list() {
    return this.snippets.list();
  }

  @AdminOnly()
  @Post('admin/snippets')
  create(@Body(new ZodPipe(snippetSchema)) body: z.infer<typeof snippetSchema>) {
    return this.snippets.create(body);
  }

  @AdminOnly()
  @Put('admin/snippets/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(snippetSchema)) body: z.infer<typeof snippetSchema>) {
    return this.snippets.update(id, body);
  }

  @AdminOnly()
  @Delete('admin/snippets/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.snippets.remove(id);
  }
}
