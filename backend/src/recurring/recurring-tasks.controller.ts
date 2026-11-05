import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Audit, NoAudit } from '../audit/audit.decorators';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { TITLE_MAX } from '../items/title';
import { AreasService } from '../settings/areas';
import { longestTaskTitle } from './recurrence';
import { RecurringTasksService } from './recurring-tasks.service';

const interval = z.number().int().min(1, 'Mindestens 1').max(99, 'Höchstens 99');
const weekday = z.number().int().min(1).max(7);

const recurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), interval }),
  z.object({
    kind: z.literal('weekly'),
    interval,
    weekdays: z
      .array(weekday)
      .min(1, 'Bitte mindestens einen Wochentag wählen')
      .max(7)
      .transform((days) => [...new Set(days)].sort()),
  }),
  z.object({
    kind: z.literal('monthlyDay'),
    interval,
    day: z.number().int().refine((d) => d === -1 || (d >= 1 && d <= 31), 'Ungültiger Tag'),
  }),
  z.object({
    kind: z.literal('monthlyWeekday'),
    interval,
    nth: z.number().int().refine((n) => n === -1 || (n >= 1 && n <= 4), 'Ungültige Woche'),
    weekday,
  }),
  z
    .object({ kind: z.literal('yearly'), interval, month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
    // 29. Februar erlaubt (in anderen Jahren der 28.)
    .refine((r) => r.day <= new Date(Date.UTC(2028, r.month, 0)).getUTCDate(), 'Diesen Tag gibt es im gewählten Monat nicht'),
]);

const scheduleFields = {
  // Höchstlänge auch mit den längsten Werten der Platzhalter, z.B. «September» (Entscheid vom 05.11.2026)
  title: z
    .string()
    .trim()
    .min(1, 'Titel fehlt')
    .max(300)
    .refine(
      (t) => longestTaskTitle(t).length <= TITLE_MAX,
      `Der Titel darf höchstens ${TITLE_MAX} Zeichen lang sein, auch mit den längsten Werten der Platzhalter (z.B. «September», «Donnerstag»).`,
    ),
  schedule: recurrenceSchema,
  startDate: z.iso.date({ error: 'Ungültiges Startdatum' }),
  endDate: z.iso.date({ error: 'Ungültiges Enddatum' }).nullable(),
  weekend: z.enum(['keep', 'monday', 'friday']),
  leadDays: z.number().int().min(0).max(60, 'Höchstens 60 Tage Vorlauf'),
};
const endAfterStart = (v: { startDate: string; endDate: string | null }) => !v.endDate || v.endDate >= v.startDate;
const END_MESSAGE = { message: 'Das Enddatum liegt vor dem Startdatum', path: ['endDate'] };

const previewSchema = z.object({ ...scheduleFields, id: z.uuid().nullable().default(null) }).refine(endAfterStart, END_MESSAGE);

const taskSchema = z
  .object({
    ...scheduleFields,
    description: z
      .string()
      .max(20000)
      .transform((s) => s.replace(/\r\n?/g, '\n')),
    priority: z.enum(['high', 'normal', 'low']),
    statusId: z.uuid().nullable(),
    assigneeId: z.uuid().nullable(),
    channelId: z.uuid().nullable(),
    checklists: z
      .array(
        z.object({
          title: z.string().trim().min(1, 'Titel der Checkliste fehlt').max(200),
          items: z.array(z.string().trim().min(1).max(500)).max(100),
        }),
      )
      .max(10),
    active: z.boolean(),
  })
  .refine(endAfterStart, END_MESSAGE);

const runSchema = z.object({ now: z.iso.datetime({ offset: true }).optional() });

/** Wiederkehrende Aufgaben: für alle mit Zugriff auf die Aufgaben (Bereiche je Rolle) */
@Controller()
export class RecurringTasksController {
  constructor(
    private readonly recurring: RecurringTasksService,
    private readonly areas: AreasService,
  ) {}

  @Get('recurring-tasks')
  async list(@CurrentUser() user: User) {
    await this.areas.assertType(user, 'task');
    return this.recurring.list();
  }

  @NoAudit()
  @Post('recurring-tasks/preview')
  async preview(@CurrentUser() user: User, @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    await this.areas.assertType(user, 'task');
    return this.recurring.preview(body, body.id);
  }

  @Audit('items', 'Wiederkehrende Aufgabe erstellt', { fromResult: true })
  @Post('recurring-tasks')
  async create(@CurrentUser() user: User, @Body(new ZodPipe(taskSchema)) body: z.infer<typeof taskSchema>) {
    await this.areas.assertType(user, 'task');
    return this.recurring.create(user, body);
  }

  @Audit('items', 'Wiederkehrende Aufgabe geändert', { target: 'recurringTask' })
  @Put('recurring-tasks/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(taskSchema)) body: z.infer<typeof taskSchema>,
  ) {
    await this.areas.assertType(user, 'task');
    return this.recurring.update(id, body);
  }

  @Audit('items', 'Wiederkehrende Aufgabe gelöscht', { target: 'recurringTask' })
  @Delete('recurring-tasks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.areas.assertType(user, 'task');
    await this.recurring.remove(id);
  }

  /** «Jetzt anlegen»: die Aufgabe des nächsten Termins sofort */
  @Audit('items', 'Aufgabe aus wiederkehrender Aufgabe angelegt', { fromResult: true })
  @Post('recurring-tasks/:id/create-now')
  async createNow(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.areas.assertType(user, 'task');
    return this.recurring.createNow(user, id);
  }

  /** Durchlauf sofort (sonst alle 15 Minuten), für Tests mit einem anderen Zeitpunkt */
  @AdminOnly()
  @Audit('admin', 'Wiederkehrende Aufgaben von Hand ausgeführt')
  @Post('admin/recurring-tasks/run')
  run(@Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.recurring.run(body.now ? new Date(body.now) : undefined);
  }
}
