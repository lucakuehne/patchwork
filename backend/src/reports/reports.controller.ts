import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ReportsService, type ReportPeriod } from './reports.service';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('de-CH', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const periodSchema = z
  .object({
    from: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    to: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    tz: z.string().max(64).refine(isTimeZone, 'Unbekannte Zeitzone').default('Europe/Zurich'),
    bucket: z.enum(['day', 'week', 'month']).default('week'),
  })
  .refine((p) => p.from < p.to, 'Der Zeitraum ist leer')
  .refine((p) => p.to.getTime() - p.from.getTime() <= 6 * 366 * 24 * 3600 * 1000, 'Der Zeitraum ist zu lang');

type PeriodQuery = z.infer<typeof periodSchema>;
const toPeriod = (q: PeriodQuery): ReportPeriod => ({ from: q.from, to: q.to, timeZone: q.tz, bucket: q.bucket });

@AdminOnly()
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  report(@Query(new ZodPipe(periodSchema)) query: PeriodQuery) {
    return this.reports.report(toPeriod(query));
  }

  @Get('items.csv')
  async csv(@Query(new ZodPipe(periodSchema)) query: PeriodQuery, @Res() res: Response) {
    const day = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: query.tz }).format(d);
    // «to» ist exklusiv: im Dateinamen der letzte enthaltene Tag
    const last = new Date(query.to.getTime() - 1);
    if (Number.isNaN(last.getTime())) throw new BadRequestException('Ungültiger Zeitraum');
    const filename = `patchwork-vorgaenge-${day(query.from)}-bis-${day(last)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(await this.reports.csv(toPeriod(query)));
  }
}
