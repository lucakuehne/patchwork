import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { nullableUuid, ZodPipe } from '../common/zod.pipe';
import { STATUS_COLORS } from './status-rules';
import { StatusesService } from './statuses.service';

const typeSchema = z.enum(['incident', 'task']);
const labelSchema = z.string().trim().min(1, 'Bezeichnung fehlt').max(60);
const coordinate = z.number().finite().min(-100000).max(100000);

const createSchema = z.object({ type: typeSchema, label: labelSchema, closed: z.boolean() });
const updateSchema = z.object({
  label: labelSchema.optional(),
  closed: z.boolean().optional(),
  color: z.enum(STATUS_COLORS).optional(),
  diagramX: coordinate.optional(),
  diagramY: coordinate.optional(),
});
const reorderSchema = z.object({ type: typeSchema, ids: z.array(z.uuid()).min(1) });
/** Ersatz je Ziel: Status-ID, bei freiwilligen Zielen auch null (= keiner) */
const targetChoices = z.object({
  start: nullableUuid.optional(),
  reply: nullableUuid.optional(),
  close: nullableUuid.optional(),
  reject: nullableUuid.optional(),
  waiting: nullableUuid.optional(),
});
// Ohne Body (unbenutzter Status ohne Ziele) kommt undefined an
const removeSchema = z.preprocess(
  (body) => body ?? {},
  z.object({ replacementId: nullableUuid.optional(), targets: targetChoices.optional() }),
);
const targetsSchema = z.object({
  type: typeSchema,
  targets: z.object({
    start: z.uuid(),
    reply: z.uuid(),
    close: z.uuid(),
    reject: nullableUuid.optional(),
    waiting: nullableUuid.optional(),
  }),
});
const flowSchema = z.object({
  type: typeSchema,
  restrict: z.boolean(),
  transitions: z.array(z.object({ fromId: z.uuid(), toId: z.uuid() })).max(1000),
});

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

  /** Zeitgesteuerte Regeln je Status (für den Lösch-Dialog) */
  @AdminOnly()
  @Get('rules-usage')
  rulesUsage() {
    return this.statuses.rulesUsage();
  }

  /** Ablauf: pro Typ eingeschränkt oder frei, und die erlaubten Wechsel von Hand */
  @Get('flow')
  flow() {
    return this.statuses.flow();
  }

  @AdminOnly()
  @Put('flow')
  setFlow(@Body(new ZodPipe(flowSchema)) body: z.infer<typeof flowSchema>) {
    return this.statuses.setFlow(body.type, body.restrict, body.transitions);
  }

  /** Ziel-Status je Typ (automatische Wechsel) */
  @Get('targets')
  targets() {
    return this.statuses.targets();
  }

  @AdminOnly()
  @Put('targets')
  setTargets(@Body(new ZodPipe(targetsSchema)) body: z.infer<typeof targetsSchema>) {
    const { reject, waiting, ...required } = body.targets;
    return this.statuses.setTargets(body.type, {
      ...required,
      ...(reject ? { reject } : {}),
      ...(waiting ? { waiting } : {}),
    });
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

  /** Löschen mit Ersatz für die Vorgänge und für Ziele, die auf den Status zeigen */
  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(removeSchema)) body: z.infer<typeof removeSchema>) {
    await this.statuses.remove(id, body);
  }
}
