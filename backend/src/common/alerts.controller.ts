import { Controller, Get, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { statfs } from 'node:fs/promises';
import { AdminOnly } from '../auth/auth.decorators';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { mailboxes, outgoingMails } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { systemAlerts } from './system-alerts';

/** Hinweise bei Störungen für den Balken oben (nur Admins), siehe system-alerts.ts */
@AdminOnly()
@Controller('admin/alerts')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async alerts() {
    const [boxes, [failed], disk, mailFetch] = await Promise.all([
      this.db
        .select({
          id: mailboxes.id,
          name: mailboxes.name,
          active: mailboxes.active,
          lastError: mailboxes.lastError,
          errorSince: mailboxes.errorSince,
        })
        .from(mailboxes),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(outgoingMails)
        .where(and(eq(outgoingMails.status, 'failed'), isNull(outgoingMails.dismissedAt))),
      this.disk(),
      this.settings.get('mailFetch'),
    ]);
    return systemAlerts({ mailboxes: boxes, mailFetchEnabled: mailFetch.enabled, failedMails: failed?.count ?? 0, disk });
  }

  /** Freier und gesamter Platz auf dem Datenträger der Ablage; null, wenn das System es nicht verrät */
  private async disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
    try {
      const stats = await statfs(appConfig.dataDir);
      return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
    } catch (err) {
      this.logger.warn(`Speicherplatz der Ablage nicht lesbar: ${(err as Error).message}`);
      return null;
    }
  }
}
