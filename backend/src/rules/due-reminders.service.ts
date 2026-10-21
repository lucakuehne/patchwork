import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import { items, statuses } from '../db/schema';
import { NotificationsService } from '../mail/notifications.service';

/**
 * Mail bei Fälligkeit: am Fälligkeitstag ab 07:00 (Zeitzone der Anwendung) einmal pro Fälligkeitsdatum an den
 * Zuständigen einer offenen Aufgabe. Wird das Datum später auf heute oder früher gesetzt oder erst dann jemand
 * zuständig, geht die Mail beim nächsten Durchlauf (alle 15 Minuten, mit den zeitgesteuerten Regeln).
 */
@Injectable()
export class DueRemindersService {
  private readonly logger = new Logger(DueRemindersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<{ reminded: number }> {
    const due = await this.db
      .select({ item: items })
      .from(items)
      .innerJoin(statuses, eq(statuses.id, items.statusId))
      .where(
        and(
          eq(items.type, 'task'),
          eq(items.discarded, false),
          eq(statuses.closed, false),
          isNotNull(items.assigneeId),
          isNotNull(items.dueDate),
          sql`(${items.dueDate} + time '07:00') at time zone ${appConfig.timeZone} <= ${now.toISOString()}::timestamptz`,
          sql`${items.dueNotifiedOn} is distinct from ${items.dueDate}`,
        ),
      );
    let reminded = 0;
    for (const { item } of due) {
      // Erst vermerken, dann senden: bei einem Fehler lieber keine als doppelte Mails (auch bei parallelen Läufen)
      const [claimed] = await this.db
        .update(items)
        .set({ dueNotifiedOn: item.dueDate })
        .where(and(eq(items.id, item.id), eq(items.dueDate, item.dueDate!), sql`${items.dueNotifiedOn} is distinct from ${items.dueDate}`))
        .returning({ id: items.id });
      if (!claimed) continue;
      try {
        if (await this.notifications.dueReminder(item)) reminded++;
      } catch (err) {
        this.logger.error(`Mail bei Fälligkeit für PW-${item.number} fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    return { reminded };
  }
}
