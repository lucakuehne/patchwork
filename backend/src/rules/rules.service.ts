import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, max, sql } from 'drizzle-orm';
import { LdapService } from '../auth/ldap.service';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { checklistTemplates, entries, items, mailboxes, ruleRuns, rules, statuses, users, type Item, type Rule } from '../db/schema';
import { ChecklistsService } from '../items/checklists.service';
import { ItemsService, PRIORITY_LABELS, TYPE_LABELS } from '../items/items.service';
import { NotificationsService } from '../mail/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { StatusesService } from '../statuses/statuses.service';
import { matchesGroup, type RuleEvent } from './rule-eval';
import { isNewItemTrigger, type RuleGroup, type RuleInputDto, type RuleSchedule, type RuleTrigger } from './rule-types';
import { dueDate, scheduledStatusIds, waitedDays } from './timed';

/**
 * Passende Regeln für ein Ereignis. Die Bedingungen sind bereits geprüft (ausserhalb der
 * Transaktion, wegen der Abfragen im Verzeichnis); «apply» setzt die Aktionen innerhalb der
 * Transaktion um, in der der Vorgang bzw. die Antwort gespeichert wird.
 */
export interface RuleRun {
  apply(tx: Tx, item: Item): Promise<void>;
  /** Nach dem Commit: Mails (z.B. an den Zuständigen) */
  afterCommit(): Promise<void>;
  /** Nur bei neuen Vorgängen gesetzt */
  readonly suppressConfirmation: boolean;
  readonly discarded: boolean;
}

const q = (s: string) => `«${s}»`;

export interface PreviewHit {
  number: number;
  title: string;
  /** neu erfasst, Antwort bzw. (zeitgesteuert) jetzt fällig */
  kind: 'new' | 'reply' | 'due';
  sender: string;
  at: Date;
}

/** Angaben eines Vorgangs für zeitgesteuerte Regeln: Melder, Titel, Beschreibung, Antwort-Postfach */
export const timedEvent = (item: Item, reporterEmail: string): RuleEvent => ({
  trigger: 'timed',
  sender: reporterEmail,
  subject: item.title,
  body: item.description,
  mailboxId: item.mailboxId,
});

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly checklists: ChecklistsService,
    private readonly statuses: StatusesService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
  ) {}

  // ---------------------------------------------------------------- Verwaltung

  list(): Promise<Rule[]> {
    return this.db.select().from(rules).orderBy(asc(rules.position), asc(rules.createdAt));
  }

  async create(input: RuleInputDto): Promise<Rule> {
    await this.validate(input);
    const [row] = await this.db.select({ max: max(rules.position) }).from(rules);
    const [created] = await this.db
      .insert(rules)
      .values({ ...input, position: (row?.max ?? -1) + 1 })
      .returning();
    return created!;
  }

  async update(id: string, input: RuleInputDto): Promise<Rule> {
    await this.validate(input);
    const [updated] = await this.db
      .update(rules)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(rules.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Regel nicht gefunden');
    return updated;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const result = await this.db.update(rules).set({ active, updatedAt: new Date() }).where(eq(rules.id, id)).returning();
    if (result.length === 0) throw new NotFoundException('Regel nicht gefunden');
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(rules).where(eq(rules.id, id));
  }

  async reorder(ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.update(rules).set({ position }).where(eq(rules.id, id));
      }
    });
  }

  /**
   * Verweise einer Regel prüfen: Zuständiger, Vorlage und Postfächer müssen existieren, die Status einer
   * zeitgesteuerten Regel existieren und offen sein.
   */
  private async validate(input: RuleInputDto) {
    const { assigneeId, checklistTemplateId } = input.actions;
    const statusIds = [...new Set(input.schedule?.statusIds ?? [])];
    if (statusIds.length > 0) {
      const found = await this.db
        .select({ label: statuses.label, closed: statuses.closed })
        .from(statuses)
        .where(inArray(statuses.id, statusIds));
      if (found.length !== statusIds.length) {
        throw new BadRequestException('Ein gewählter Status existiert nicht mehr. Bitte die Auswahl der Status prüfen.');
      }
      const closed = found.find((s) => s.closed);
      if (closed) {
        throw new BadRequestException(`«${closed.label}» ist abgeschlossen. Zeitgesteuerte Regeln gelten nur für offene Status.`);
      }
    }
    if (assigneeId) {
      const [user] = await this.db.select().from(users).where(eq(users.id, assigneeId)).limit(1);
      if (!user || !user.active || (user.role !== 'admin' && user.role !== 'it')) {
        throw new BadRequestException('Zuständig kann nur ein aktiver Admin- oder IT-Benutzer sein');
      }
    }
    if (checklistTemplateId) {
      const [template] = await this.db.select().from(checklistTemplates).where(eq(checklistTemplates.id, checklistTemplateId)).limit(1);
      if (!template) throw new BadRequestException('Die Checklisten-Vorlage gibt es nicht');
    }
    const mailboxIds = collectValues(input.conditions, 'mailbox');
    if (mailboxIds.length > 0) {
      const found = await this.db.select({ id: mailboxes.id }).from(mailboxes).where(inArray(mailboxes.id, mailboxIds));
      if (found.length !== new Set(mailboxIds).size) throw new BadRequestException('Ein gewähltes Postfach gibt es nicht');
    }
  }

  /**
   * Vorschau: Welche neuen Vorgänge bzw. Antworten der letzten 30 Tage hätten gepasst?
   * Höchstens 50 Treffer, die neuesten zuerst.
   */
  async preview(
    triggers: RuleTrigger[],
    schedule: RuleSchedule | null,
    conditions: RuleGroup,
  ): Promise<{ hits: PreviewHit[]; more: boolean }> {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const candidates: (RuleEvent & { number: number; title: string; kind: PreviewHit['kind']; at: Date })[] = [];

    // Zeitgesteuert: Vorgänge, die jetzt lange genug in einem gewählten Status bzw. im Wartet-Status ihres Typs sind
    const statusIds = schedule ? scheduledStatusIds([schedule], await this.statuses.targets()) : [];
    if (schedule && statusIds.length > 0) {
      const rows = await this.db
        .select({ item: items, sender: users.email })
        .from(items)
        .innerJoin(users, eq(users.id, items.reporterId))
        .where(
          and(
            eq(items.discarded, false),
            inArray(items.statusId, statusIds),
            sql`${items.statusChangedAt} <= now() - make_interval(days => ${schedule.days})`,
          ),
        )
        .orderBy(asc(items.statusChangedAt))
        .limit(500);
      for (const { item, sender } of rows) {
        candidates.push({ ...timedEvent(item, sender), number: item.number, title: item.title, kind: 'due', at: item.statusChangedAt });
      }
    }

    const newSources = (['mail', 'portal'] as const).filter((s) => triggers.includes(s === 'mail' ? 'mail_new' : 'portal_new'));
    if (newSources.length > 0) {
      const rows = await this.db
        .select({ item: items, sender: users.email })
        .from(items)
        .innerJoin(users, eq(users.id, items.reporterId))
        .where(and(gte(items.createdAt, since), inArray(items.source, newSources)))
        .orderBy(desc(items.createdAt))
        .limit(500);
      for (const { item, sender } of rows) {
        candidates.push({
          trigger: item.source === 'mail' ? 'mail_new' : 'portal_new',
          sender,
          subject: item.title,
          body: item.description,
          mailboxId: item.source === 'mail' ? item.mailboxId : null,
          number: item.number,
          title: item.title,
          kind: 'new',
          at: item.createdAt,
        });
      }
    }

    const replySources = (['mail', 'portal'] as const).filter((s) => triggers.includes(s === 'mail' ? 'mail_reply' : 'portal_reply'));
    if (replySources.length > 0) {
      const rows = await this.db
        .select({ entry: entries, item: items, sender: users.email })
        .from(entries)
        .innerJoin(items, eq(items.id, entries.itemId))
        .innerJoin(users, eq(users.id, entries.authorId))
        .where(
          and(
            gte(entries.createdAt, since),
            inArray(entries.kind, ['reply', 'note']),
            isNotNull(entries.meta),
            inArray(sql<string>`${entries.meta}->>'source'`, [...replySources]),
            sql`coalesce((${entries.meta}->>'automated')::boolean, false) = false`,
          ),
        )
        .orderBy(desc(entries.createdAt))
        .limit(500);
      for (const { entry, item, sender } of rows) {
        const source = entry.meta?.source as 'mail' | 'portal';
        candidates.push({
          trigger: source === 'mail' ? 'mail_reply' : 'portal_reply',
          sender,
          subject: source === 'mail' ? String(entry.meta?.subject ?? item.title) : item.title,
          body: entry.body,
          // Für ältere Antworten ist nur das Antwort-Postfach des Vorgangs bekannt
          mailboxId: source === 'mail' ? item.mailboxId : null,
          number: item.number,
          title: item.title,
          kind: 'reply',
          at: entry.createdAt,
        });
      }
    }

    candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
    const checker = this.ldap.groupChecker(await this.settings.get('ldap'));
    const hits: PreviewHit[] = [];
    let more = false;
    try {
      for (const c of candidates) {
        if (!(await matchesGroup(conditions, c, checker.check))) continue;
        if (hits.length === 50) {
          more = true;
          break;
        }
        hits.push({ number: c.number, title: c.title, kind: c.kind, sender: c.sender, at: c.at });
      }
    } finally {
      await checker.close();
    }
    return { hits, more };
  }

  // ---------------------------------------------------------------- Anwenden

  /**
   * Prüft die aktiven Regeln für ein Ereignis, von oben nach unten. Bei neuen Vorgängen beendet
   * «Verwerfen» die Abarbeitung. Fehler beim Prüfen einer Regel halten den Mail-Eingang nicht auf.
   */
  async prepare(trigger: RuleTrigger, event: Omit<RuleEvent, 'trigger'>): Promise<RuleRun> {
    let candidates: Rule[] = [];
    try {
      candidates = (await this.db.select().from(rules).where(eq(rules.active, true)).orderBy(asc(rules.position))).filter(
        (r) => r.triggers.includes(trigger),
      );
    } catch (err) {
      this.logger.error(`Regeln konnten nicht geladen werden: ${(err as Error).message}`);
    }
    if (candidates.length === 0) return this.run(trigger, []);

    const checker = this.ldap.groupChecker(await this.settings.get('ldap'));
    const matched: Rule[] = [];
    try {
      for (const rule of candidates) {
        try {
          if (!(await matchesGroup(rule.conditions, { ...event, trigger }, checker.check))) continue;
        } catch (err) {
          this.logger.warn(`Regel «${rule.name}» konnte nicht geprüft werden: ${(err as Error).message}`);
          continue;
        }
        matched.push(rule);
        if (isNewItemTrigger(trigger) && rule.actions.discard) break;
      }
    } finally {
      await checker.close();
    }
    return this.run(trigger, matched);
  }

  private run(trigger: RuleTrigger, matched: Rule[]): RuleRun {
    const isNew = isNewItemTrigger(trigger);
    const pending: (() => Promise<void>)[] = [];
    const state = { suppressConfirmation: false, discarded: false };
    return {
      get suppressConfirmation() {
        return state.suppressConfirmation;
      },
      get discarded() {
        return state.discarded;
      },
      apply: async (tx, item) => {
        if (matched.length === 0) return;
        const discardRule = isNew ? matched.find((r) => r.actions.discard) : undefined;
        if (discardRule) {
          // Verwerfen ersetzt alle anderen Aktionen (z.B. Spam)
          await tx.update(items).set({ discarded: true, updatedAt: new Date() }).where(eq(items.id, item.id));
          await this.log(tx, item.id, discardRule, ['den Vorgang verworfen']);
          state.discarded = true;
          return;
        }
        await this.applyActions(tx, item, matched, isNew, state, pending);
      },
      afterCommit: async () => {
        for (const job of pending) {
          await job().catch((err: Error) => this.logger.error(`Benachrichtigung nach Regel fehlgeschlagen: ${err.message}`));
        }
      },
    };
  }

  /** Setzt die Aktionen der passenden Regeln nacheinander um; die spätere Regel gewinnt. */
  private async applyActions(
    tx: Tx,
    item: Item,
    matched: Rule[],
    isNew: boolean,
    state: { suppressConfirmation: boolean },
    pending: (() => Promise<void>)[],
  ) {
    const staff = new Map(
      (await tx.select().from(users).where(inArray(users.role, ['admin', 'it'])))
        .filter((u) => u.active)
        .map((u) => [u.id, u]),
    );
    const changes: Partial<typeof items.$inferInsert> = {};
    let type = item.type;
    let assignedBy: Rule | null = null;
    const templates: { rule: Rule; templateId: string }[] = [];
    const log: { rule: Rule; parts: string[] }[] = [];

    for (const rule of matched) {
      const a = rule.actions;
      const parts: string[] = [];
      // Typ nur für neue Vorgänge bzw. solange der Vorgang im Eingang liegt; Status «Neuer Vorgang erhält»
      if (a.type && !item.type) {
        const target = await this.statuses.targetStatus(a.type, 'start', tx);
        type = a.type;
        changes.type = a.type;
        changes.statusId = target.id;
        changes.suggestedType = null;
        parts.push(`den Typ ${q(TYPE_LABELS[a.type])} gesetzt (Status ${q(target.label)})`);
      }
      if (a.priority) {
        changes.priority = a.priority;
        parts.push(`die Priorität ${q(PRIORITY_LABELS[a.priority])} gesetzt`);
      }
      if (a.assigneeId) {
        const user = staff.get(a.assigneeId);
        if (user) {
          changes.assigneeId = user.id;
          assignedBy = rule;
          parts.push(`${q(user.name)} als zuständig gesetzt`);
        } else {
          this.logger.warn(`Regel «${rule.name}»: Zuständiger ist kein aktiver Admin- oder IT-Benutzer`);
        }
      }
      if (isNew && a.checklistTemplateId) templates.push({ rule, templateId: a.checklistTemplateId });
      if (isNew && a.suppressConfirmation) {
        state.suppressConfirmation = true;
        parts.push('keine Eingangsbestätigung verschickt');
      }
      log.push({ rule, parts });
    }

    if (changes.statusId) changes.boardPosition = await this.items.endOfColumn(tx, changes.statusId);
    if (Object.keys(changes).length > 0) {
      await tx
        .update(items)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(items.id, item.id));
    }

    // Checklisten nur, wenn der Vorgang am Ende eine Aufgabe ist
    const inserted = new Set<string>();
    for (const { rule, templateId } of templates) {
      if (type !== 'task' || inserted.has(templateId)) continue;
      const name = await this.checklists.addFromTemplate(tx, item.id, templateId);
      if (!name) {
        this.logger.warn(`Regel «${rule.name}»: Checklisten-Vorlage gibt es nicht mehr`);
        continue;
      }
      inserted.add(templateId);
      log.find((l) => l.rule === rule)!.parts.push(`die Checkliste ${q(name)} eingefügt`);
    }

    for (const { rule, parts } of log) {
      if (parts.length > 0) await this.log(tx, item.id, rule, parts);
    }

    if (changes.assigneeId && changes.assigneeId !== item.assigneeId && assignedBy) {
      const by = `Regel ${q(assignedBy.name)}`;
      const itemId = item.id;
      pending.push(async () => {
        const [updated] = await this.db.select().from(items).where(eq(items.id, itemId)).limit(1);
        if (updated) await this.notifications.assigned(updated, null, by);
      });
    }
  }

  /**
   * Zeitgesteuerte Regeln für einen Vorgang ausführen (Bedingungen bereits geprüft), von oben nach
   * unten. Jede Regel läuft pro Aufenthalt im Status nur einmal. «Schliessen» beendet die Abarbeitung;
   * wird im selben Durchlauf geschlossen, entfällt die Erinnerung.
   */
  async applyTimed(
    item: Item,
    matched: Rule[],
    now: Date,
    closeOn: Date | null,
  ): Promise<{ applied: boolean; reminded: boolean; closed: boolean }> {
    const pending: (() => Promise<void>)[] = [];
    const result = { applied: false, reminded: false, closed: false };
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(items).where(eq(items.id, item.id)).for('update').limit(1);
      // Inzwischen geändert (z.B. Antwort des Melders): nichts tun, beim nächsten Durchlauf neu prüfen
      if (!locked?.type || locked.statusId !== item.statusId || locked.statusChangedAt.getTime() !== item.statusChangedAt.getTime()) {
        return;
      }
      result.applied = true;
      const staff = new Map(
        (await tx.select().from(users).where(inArray(users.role, ['admin', 'it']))).filter((u) => u.active).map((u) => [u.id, u]),
      );
      const days = waitedDays(locked.statusChangedAt, now);
      const closing = matched.some((r) => r.actions.close);
      const changes: Partial<typeof items.$inferInsert> = {};
      let assignedBy: Rule | null = null;
      let closedAs: string | null = null;

      for (const rule of matched) {
        const a = rule.actions;
        const parts: string[] = [];
        if (a.priority) {
          changes.priority = a.priority;
          parts.push(`die Priorität ${q(PRIORITY_LABELS[a.priority])} gesetzt`);
        }
        if (a.assigneeId) {
          const user = staff.get(a.assigneeId);
          if (user) {
            changes.assigneeId = user.id;
            assignedBy = rule;
            parts.push(`${q(user.name)} als zuständig gesetzt`);
          }
        }
        if (a.remindReporter && !closing) {
          result.reminded = true;
          parts.push(`den Melder erinnert (wartet seit ${days} Tagen)`);
        }
        // Schliessen: Status «Automatisch schliessen in» des Typs
        const target = a.close ? await this.statuses.targetStatus(locked.type, 'close', tx) : undefined;
        if (target) {
          changes.statusId = target.id;
          changes.closedAt = now;
          changes.boardPosition = await this.items.endOfColumn(tx, target.id);
          closedAs = target.label;
          parts.push(`den Vorgang geschlossen (Status ${q(target.label)}, keine Rückmeldung seit ${days} Tagen)`);
        }
        await tx.insert(ruleRuns).values({ ruleId: rule.id, itemId: locked.id, statusChangedAt: locked.statusChangedAt }).onConflictDoNothing();
        if (parts.length > 0) await this.log(tx, locked.id, rule, parts);
        if (target) break;
      }

      if (Object.keys(changes).length > 0) {
        await tx.update(items).set({ ...changes, updatedAt: now }).where(eq(items.id, locked.id));
      }
      const [updated] = await tx.select().from(items).where(eq(items.id, locked.id)).limit(1);
      if (!updated) return;
      if (changes.assigneeId && changes.assigneeId !== locked.assigneeId && assignedBy) {
        const by = `Regel ${q(assignedBy.name)}`;
        pending.push(() => this.notifications.assigned(updated, null, by));
      }
      if (result.reminded) pending.push(() => this.notifications.waitingReminder(updated, closeOn));
      if (closedAs) {
        result.closed = true;
        const label = closedAs;
        pending.push(() => this.notifications.waitingClosed(updated, days, label));
      }
    });
    for (const job of pending) {
      await job().catch((err: Error) => this.logger.error(`Benachrichtigung nach Regel fehlgeschlagen: ${err.message}`));
    }
    return result;
  }

  /** Frühestes Datum, an dem eine passende Regel den wartenden Vorgang schliesst (für die Erinnerung) */
  closeDate(item: Item, closeRules: Rule[]): Date | null {
    const days = closeRules.map((r) => r.schedule?.days ?? Infinity).filter(Number.isFinite);
    return days.length > 0 ? dueDate(item.statusChangedAt, Math.min(...days)) : null;
  }

  private log(tx: Tx, itemId: string, rule: Rule, parts: string[]) {
    return this.items.addEntry(tx, itemId, null, 'change', '', { field: 'rule', ruleId: rule.id, ruleName: rule.name, changes: parts });
  }
}

/** Werte aller Bedingungen eines Felds (z.B. Postfach-IDs) */
function collectValues(group: RuleGroup, field: string): string[] {
  return group.children.flatMap((c) => (c.kind === 'group' ? collectValues(c, field) : c.field === field ? [c.value] : []));
}
