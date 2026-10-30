import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { HelpSpotImportService } from './helpspot-import.service';

const settingsSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === '' || /^https?:\/\/[^\s]+$/i.test(u), { message: 'Die Adresse beginnt mit https:// (oder http://)' }),
  /** undefined = unverändert, '' = löschen */
  apiKey: z.string().max(500).optional(),
  types: z.record(z.string().max(200), z.enum(['incident', 'task'])).default({}),
  statuses: z.record(z.string().max(500), z.uuid()).default({}),
  channels: z.record(z.string().max(200), z.uuid().nullable()).default({}),
});

/** Umfang eines Laufs: nur geschlossene Tickets (Standard) oder am Stichtag auch offene (Entscheid vom 30.10.2026) */
const importSchema = z.object({ includeOpen: z.boolean().default(false) }).optional();

/** Verwaltung → HelpSpot-Import (nur Admins, Entscheid vom 29.10.2026) */
@Controller('admin/helpspot')
@AdminOnly()
export class HelpSpotController {
  constructor(private readonly helpspot: HelpSpotImportService) {}

  @Get()
  view() {
    return this.helpspot.view();
  }

  @Put()
  save(@Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.helpspot.save(body);
  }

  /** Verbindung prüfen und die Übersicht über die Werte in HelpSpot neu laden */
  @Post('analysis')
  @HttpCode(200)
  analysis() {
    return this.helpspot.refreshAnalysis();
  }

  @Post('import')
  @HttpCode(202)
  start(@Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>, @CurrentUser() user: User) {
    return this.helpspot.start(user, body?.includeOpen ?? false);
  }

  @Get('copies')
  copies() {
    return this.helpspot.copies();
  }

  @Post('copies/resolve')
  @HttpCode(200)
  resolveCopies(@CurrentUser() user: User) {
    return this.helpspot.resolveCopies(user);
  }
}
