import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { LdapService } from '../auth/ldap.service';
import { InjectDb, type Db } from '../db/db.module';
import { items, ruleRuns, rules, statuses, users } from '../db/schema';
import { BossService, QUEUE_AUTOMATION } from '../jobs/boss.service';
import { SettingsService } from '../settings/settings.service';
import { matchesGroup } from './rule-eval';
import { RulesService, timedEvent } from './rules.service';
import { dueTimedRules } from './timed';

/**
 * Zeitgesteuerte Regeln (z.B. «wartet seit 7 Tagen → Melder erinnern»), geprüft alle 15 Minuten.
 * Pro Vorgang greift jede Regel einmal je Aufenthalt in einem Status.
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boss: BossService,
    private readonly settings: SettingsService,
    private readonly rules: RulesService,
    private readonly ldap: LdapService,
  ) {}

  async onModuleInit() {
    const boss = await this.boss.boss();
    await boss.work(QUEUE_AUTOMATION, { batchSize: 1 }, () => this.run());
    await boss.schedule(QUEUE_AUTOMATION, '*/15 * * * *');
  }

  async run(now = new Date()): Promise<{ items: number; reminded: number; closed: number }> {
    const result = { items: 0, reminded: 0, closed: 0 };
    const timed = (await this.db.select().from(rules).where(eq(rules.active, true)).orderBy(asc(rules.position))).filter(
      (r) => r.schedule,
    );
    if (timed.length === 0) return result;

    const categories = [...new Set(timed.map((r) => r.schedule!.category))];
    const candidates = await this.db
      .select({ item: items, category: statuses.category, reporterEmail: users.email })
      .from(items)
      .innerJoin(statuses, eq(statuses.id, items.statusId))
      .innerJoin(users, eq(users.id, items.reporterId))
      .where(and(eq(items.discarded, false), inArray(statuses.category, categories)));
    if (candidates.length === 0) return result;
    const runs = await this.db
      .select()
      .from(ruleRuns)
      .where(inArray(ruleRuns.itemId, candidates.map((c) => c.item.id)));

    const checker = this.ldap.groupChecker(await this.settings.get('ldap'));
    try {
      for (const { item, category, reporterEmail } of candidates) {
        const alreadyRun = new Set(
          runs
            .filter((r) => r.itemId === item.id && r.statusChangedAt.getTime() === item.statusChangedAt.getTime())
            .map((r) => r.ruleId),
        );
        const due = dueTimedRules(timed, item, category, now, alreadyRun);
        if (due.length === 0) continue;
        const event = timedEvent(item, reporterEmail);
        try {
          const matched = [];
          for (const rule of due) {
            if (await matchesGroup(rule.conditions, event, checker.check)) matched.push(rule);
          }
          if (matched.length === 0) continue;
          // Für die Erinnerung: wann eine passende Regel den Vorgang schliessen wird
          const closeRules = [];
          if (matched.some((r) => r.actions.remindReporter)) {
            for (const rule of timed) {
              if (rule.actions.close && rule.schedule?.category === category && (await matchesGroup(rule.conditions, event, checker.check))) {
                closeRules.push(rule);
              }
            }
          }
          const applied = await this.rules.applyTimed(item, matched, now, this.rules.closeDate(item, closeRules));
          if (applied.applied) result.items++;
          if (applied.reminded) result.reminded++;
          if (applied.closed) result.closed++;
        } catch (err) {
          this.logger.error(`Zeitgesteuerte Regeln für PW-${item.number} fehlgeschlagen: ${(err as Error).message}`);
        }
      }
    } finally {
      await checker.close();
    }
    return result;
  }
}
