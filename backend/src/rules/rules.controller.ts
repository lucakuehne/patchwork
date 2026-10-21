import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AutomationService } from './automation.service';
import { DueRemindersService } from './due-reminders.service';
import { previewSchema, ruleSchema } from './rule-types';
import { RulesService } from './rules.service';

const orderSchema = z.object({ ids: z.array(z.uuid()).max(500) });
const activeSchema = z.object({ active: z.boolean() });

/** Regeln, auch zeitgesteuerte (nur Admin). */
@AdminOnly()
@Controller('admin')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly automation: AutomationService,
    private readonly dueReminders: DueRemindersService,
  ) {}

  @Get('rules')
  list() {
    return this.rules.list();
  }

  @Post('rules')
  create(@Body(new ZodPipe(ruleSchema)) body: z.infer<typeof ruleSchema>) {
    return this.rules.create(body);
  }

  // Vor «rules/:id», damit «order» nicht als ID gilt
  @Put('rules/order')
  @HttpCode(204)
  async reorder(@Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    await this.rules.reorder(body.ids);
  }

  @Post('rules/preview')
  preview(@Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.rules.preview(body.triggers, body.schedule, body.conditions);
  }

  @Put('rules/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ruleSchema)) body: z.infer<typeof ruleSchema>) {
    return this.rules.update(id, body);
  }

  @Patch('rules/:id/active')
  @HttpCode(204)
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(activeSchema)) body: z.infer<typeof activeSchema>) {
    await this.rules.setActive(id, body.active);
  }

  @Delete('rules/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.rules.remove(id);
  }

  /** Zeitgesteuerte Regeln sofort ausführen (sonst alle 15 Minuten) */
  @Post('rules/run-timed')
  runTimed() {
    return this.automation.run();
  }

  /** Mails bei Fälligkeit jetzt prüfen (läuft sonst alle 15 Minuten mit den zeitgesteuerten Regeln) */
  @Post('rules/run-due')
  runDue() {
    return this.dueReminders.run();
  }
}
