import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { nullableUuid, ZodPipe } from '../common/zod.pipe';
import { CHANNEL_ICONS, ChannelsService } from './channels.service';

const labelSchema = z.string().trim().min(1, 'Bezeichnung fehlt').max(60);
const iconSchema = z.enum(CHANNEL_ICONS);
const createSchema = z.object({ label: labelSchema, icon: iconSchema });
const updateSchema = z.object({ label: labelSchema.optional(), icon: iconSchema.optional() });
const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1) });
const removeSchema = z.object({ replacementId: nullableUuid.optional() });

/** Meldewege: Liste für alle in der IT, Pflege nur für Admins. */
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list() {
    return this.channels.list();
  }

  @AdminOnly()
  @Get('usage')
  usage() {
    return this.channels.usage();
  }

  @AdminOnly()
  @Post()
  create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.channels.create(body);
  }

  @AdminOnly()
  @Put('order')
  @HttpCode(204)
  async reorder(@Body(new ZodPipe(reorderSchema)) body: z.infer<typeof reorderSchema>) {
    await this.channels.reorder(body.ids);
  }

  @AdminOnly()
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.channels.update(id, body);
  }

  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(removeSchema)) query: z.infer<typeof removeSchema>) {
    await this.channels.remove(id, query.replacementId ?? null);
  }
}
