import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { nullableUuid, ZodPipe } from '../common/zod.pipe';
import { StatusesService } from './statuses.service';

const typeSchema = z.enum(['incident', 'task']);
const categorySchema = z.enum(['new', 'in_progress', 'waiting', 'done', 'rejected']);
const labelSchema = z.string().trim().min(1, 'Bezeichnung fehlt').max(60);

const createSchema = z.object({ type: typeSchema, label: labelSchema, category: categorySchema });
const updateSchema = z.object({ label: labelSchema.optional(), category: categorySchema.optional() });
const reorderSchema = z.object({ type: typeSchema, ids: z.array(z.uuid()).min(1) });
const removeSchema = z.object({ replacementId: nullableUuid.optional() });

@Controller('statuses')
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  @Get()
  list() {
    return this.statuses.list();
  }

  @AdminOnly()
  @Get('usage')
  usage() {
    return this.statuses.usage();
  }

  @AdminOnly()
  @Post()
  create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.statuses.create(body);
  }

  @AdminOnly()
  @Put('order')
  @HttpCode(204)
  async reorder(@Body(new ZodPipe(reorderSchema)) body: z.infer<typeof reorderSchema>) {
    await this.statuses.reorder(body.type, body.ids);
  }

  @AdminOnly()
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.statuses.update(id, body);
  }

  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(removeSchema)) query: z.infer<typeof removeSchema>,
  ) {
    await this.statuses.remove(id, query.replacementId ?? null);
  }
}
