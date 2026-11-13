import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { mailboxPolls, type MailboxPollRow } from '../db/schema';
import { joinsPrevious, POLL_LOG_RETENTION_DAYS, type PollEntry } from './mailbox-polls';

/**
 * Abrufprotokoll je Postfach (Entscheid vom 13.11.2026): jeder Abruf mit Dauer, Mails nach Ergebnis, Fehler und
 * Auslöser. Aufeinanderfolgende automatische Abrufe ohne Mails stehen in einer Zeile, wenn sie ohne Fehler waren oder
 * denselben Fehler hatten. 14 Tage aufbewahrt.
 */
@Injectable()
export class MailboxPollsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async record(mailboxId: string, poll: PollEntry): Promise<void> {
    const durationMs = Math.max(0, poll.endedAt.getTime() - poll.startedAt.getTime());
    const [last] = await this.db
      .select()
      .from(mailboxPolls)
      .where(eq(mailboxPolls.mailboxId, mailboxId))
      .orderBy(desc(mailboxPolls.startedAt))
      .limit(1);
    if (joinsPrevious(last, poll)) {
      await this.db
        .update(mailboxPolls)
        .set({
          endedAt: poll.endedAt,
          polls: sql`${mailboxPolls.polls} + 1`,
          durationMs: sql`greatest(${mailboxPolls.durationMs}, ${durationMs})`,
        })
        .where(eq(mailboxPolls.id, last!.id));
      return;
    }
    await this.db.insert(mailboxPolls).values({
      mailboxId,
      startedAt: poll.startedAt,
      endedAt: poll.endedAt,
      polls: 1,
      durationMs,
      mails: poll.mails,
      error: poll.error,
      triggeredBy: poll.triggeredBy,
    });
  }

  /** Neueste zuerst; «before» setzt nach der letzten geladenen Zeile fort. */
  async list(mailboxId: string, options: { errorsOnly: boolean; before?: Date; limit: number }) {
    const rows = await this.db
      .select()
      .from(mailboxPolls)
      .where(
        and(
          eq(mailboxPolls.mailboxId, mailboxId),
          options.errorsOnly ? isNotNull(mailboxPolls.error) : undefined,
          options.before ? lt(mailboxPolls.startedAt, options.before) : undefined,
        ),
      )
      .orderBy(desc(mailboxPolls.startedAt))
      .limit(options.limit + 1);
    return { entries: rows.slice(0, options.limit).map(toPublicPoll), more: rows.length > options.limit };
  }

  /** Nächtliche Wartung: Zeilen, deren letzter Abruf älter als 14 Tage ist */
  async purgeOld(): Promise<number> {
    const deleted = await this.db
      .delete(mailboxPolls)
      .where(lt(mailboxPolls.endedAt, sql`now() - make_interval(days => ${POLL_LOG_RETENTION_DAYS})`))
      .returning({ id: mailboxPolls.id });
    return deleted.length;
  }
}

const toPublicPoll = (row: MailboxPollRow) => ({
  id: row.id,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  polls: row.polls,
  durationMs: row.durationMs,
  mails: row.mails,
  error: row.error,
  triggeredBy: row.triggeredBy,
});
