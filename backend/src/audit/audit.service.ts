import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { appConfig } from '../config';
import { InjectDb, type Db } from '../db/db.module';
import {
  auditLog,
  channels,
  checklistItems,
  checklists,
  checklistTemplates,
  entries,
  incomingMails,
  items,
  mailboxes,
  outgoingMails,
  recurringTasks,
  rules,
  snippets,
  statuses,
  users,
  type AuditArea,
} from '../db/schema';
import { byKey, parseItemRef, type ItemKey } from '../items/item-ref';
import { templateByKey } from '../mail/mail-templates';
import type { AuditContext, AuditSpec, ResolvedTarget } from './audit.decorators';
import { itemLabel, likeEscape, likePattern, resultLabel } from './audit-text';

/** Einträge älter als sechs Monate löscht die nächtliche Wartung (Entscheid vom 03.11.2026) */
export const AUDIT_RETENTION_MONTHS = 6;

const TYPE_LABELS = { incident: 'Störungen', task: 'Aufgaben' } as const;

type Person = { id: string; name: string };

export interface AuditRecord {
  /** null: fehlgeschlagene Anmeldung ohne Konto, dann mit «userName» (eingegebener Benutzername) */
  user: Person | null;
  userName?: string;
  impersonator?: Person | null;
  area: AuditArea;
  action: string;
  target?: string;
  itemId?: string | null;
}

export interface AuditFilter {
  userId?: string;
  area?: AuditArea;
  /** Zeitraum als Datum (JJJJ-MM-TT, Schweizer Zeit), beide Tage eingeschlossen */
  from?: string;
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.db.insert(auditLog).values({
      userId: entry.user?.id ?? null,
      userName: entry.user?.name ?? entry.userName ?? '',
      impersonatorId: entry.impersonator?.id ?? null,
      impersonatorName: entry.impersonator?.name ?? null,
      area: entry.area,
      action: entry.action,
      target: entry.target ?? '',
      itemId: entry.itemId ?? null,
    });
  }

  /** Eintrag zu einer Route mit @Audit, nachdem sie durchgelaufen ist */
  async recordRequest(spec: AuditSpec, user: Person, impersonator: Person | null, ctx: AuditContext): Promise<void> {
    const action = typeof spec.action === 'function' ? spec.action(ctx) : spec.action;
    if (!action) return;
    // Neu erstellt: aus der Antwort, sonst (Antwort ohne Inhalt) der Name aus der Anfrage
    const target = spec.fromResult ? ((await this.fromResult(ctx.result)) ?? (await this.fromResult(ctx.body))) : ctx.before;
    await this.record({ user, impersonator, area: spec.area, action, target: target?.label, itemId: target?.itemId });
  }

  /** Objekt vor der Aktion: der Vorgang aus «:ref» oder das Objekt der ID in der Adresse */
  async resolve(spec: AuditSpec, params: Record<string, string>): Promise<ResolvedTarget | null> {
    const id = params.id ?? '';
    switch (spec.target) {
      case undefined: {
        const key = parseItemRef(params.ref);
        return key ? this.item(byKey(key)) : null;
      }
      case 'entry': {
        const [row] = await this.db.select({ itemId: entries.itemId }).from(entries).where(eq(entries.id, id)).limit(1);
        return row ? this.item(eq(items.id, row.itemId)) : null;
      }
      case 'checklist': {
        const [row] = await this.db.select({ itemId: checklists.itemId }).from(checklists).where(eq(checklists.id, id)).limit(1);
        return row ? this.item(eq(items.id, row.itemId)) : null;
      }
      case 'checklistItem': {
        const [row] = await this.db
          .select({ itemId: checklists.itemId })
          .from(checklistItems)
          .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
          .where(eq(checklistItems.id, id))
          .limit(1);
        return row ? this.item(eq(items.id, row.itemId)) : null;
      }
      case 'outgoingMail': {
        const [row] = await this.db
          .select({ subject: outgoingMails.subject, itemId: outgoingMails.itemId })
          .from(outgoingMails)
          .where(eq(outgoingMails.id, id))
          .limit(1);
        return row ? { label: row.subject, itemId: row.itemId } : null;
      }
      case 'incomingMail': {
        const [row] = await this.db
          .select({ subject: incomingMails.subject, itemId: incomingMails.itemId })
          .from(incomingMails)
          .where(eq(incomingMails.id, id))
          .limit(1);
        return row ? { label: row.subject, itemId: row.itemId } : null;
      }
      case 'status': {
        const [row] = await this.db.select({ label: statuses.label, type: statuses.type }).from(statuses).where(eq(statuses.id, id)).limit(1);
        return row ? { label: `${TYPE_LABELS[row.type]}: ${row.label}`, itemId: null } : null;
      }
      case 'mailTemplate':
        return { label: templateByKey(params.key ?? '')?.label ?? params.key ?? '', itemId: null };
      default:
        return this.named(spec.target, id);
    }
  }

  private async named(kind: Exclude<AuditSpec['target'], undefined>, id: string): Promise<ResolvedTarget | null> {
    const lookup = async (query: Promise<{ label: string }[]>) => {
      const [row] = await query;
      return row ? { label: row.label, itemId: null } : null;
    };
    switch (kind) {
      case 'user':
        return lookup(this.db.select({ label: users.name }).from(users).where(eq(users.id, id)).limit(1));
      case 'channel':
        return lookup(this.db.select({ label: channels.label }).from(channels).where(eq(channels.id, id)).limit(1));
      case 'rule':
        return lookup(this.db.select({ label: rules.name }).from(rules).where(eq(rules.id, id)).limit(1));
      case 'snippet':
        return lookup(this.db.select({ label: snippets.name }).from(snippets).where(eq(snippets.id, id)).limit(1));
      case 'mailbox':
        return lookup(this.db.select({ label: mailboxes.name }).from(mailboxes).where(eq(mailboxes.id, id)).limit(1));
      case 'recurringTask':
        return lookup(this.db.select({ label: recurringTasks.title }).from(recurringTasks).where(eq(recurringTasks.id, id)).limit(1));
      case 'checklistTemplate':
        return lookup(
          this.db.select({ label: checklistTemplates.name }).from(checklistTemplates).where(eq(checklistTemplates.id, id)).limit(1),
        );
      default:
        return null;
    }
  }

  private async item(condition: SQL): Promise<ResolvedTarget | null> {
    const [row] = await this.db
      .select({ id: items.id, prefix: items.prefix, number: items.number, title: items.title, statusId: items.statusId })
      .from(items)
      .where(condition)
      .limit(1);
    return row ? { label: itemLabel(row), itemId: row.id, statusId: row.statusId } : null;
  }

  /** Neu erstellt: Vorgang aus Präfix und Nummer der Antwort, sonst Name bzw. Bezeichnung */
  private async fromResult(result: unknown): Promise<ResolvedTarget | null> {
    const r = (result ?? {}) as Partial<ItemKey>;
    if (typeof r.prefix === 'string' && typeof r.number === 'number') return this.item(byKey({ prefix: r.prefix, number: r.number }));
    const label = resultLabel(result);
    return label ? { label, itemId: null } : null;
  }

  /** Einträge, neueste zuerst; «more»: es gibt weitere */
  async list(filter: AuditFilter) {
    const conditions: SQL[] = [];
    if (filter.userId) conditions.push(or(eq(auditLog.userId, filter.userId), eq(auditLog.impersonatorId, filter.userId))!);
    if (filter.area) conditions.push(eq(auditLog.area, filter.area));
    // Tage in Schweizer Zeit, «bis» einschliesslich
    if (filter.from) conditions.push(gte(auditLog.createdAt, sql`(${filter.from}::date)::timestamp at time zone ${appConfig.timeZone}`));
    if (filter.to) conditions.push(lt(auditLog.createdAt, sql`(${filter.to}::date + 1)::timestamp at time zone ${appConfig.timeZone}`));
    const q = filter.q?.trim();
    const key = q ? parseItemRef(q) : null;
    if (key) {
      // Kennung (auch nur die Nummer): genau dieser Vorgang, auch wenn er inzwischen gelöscht ist (dann über den Text)
      conditions.push(
        or(
          sql`${auditLog.itemId} in (select ${items.id} from ${items} where ${byKey(key)})`,
          ilike(auditLog.target, `${likeEscape(`${key.prefix}-${key.number} «`)}%`),
        )!,
      );
    } else if (q) {
      const pattern = likePattern(q);
      conditions.push(
        or(ilike(auditLog.target, pattern), ilike(auditLog.action, pattern), ilike(auditLog.userName, pattern), ilike(auditLog.impersonatorName, pattern))!,
      );
    }
    const rows = await this.db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        userId: auditLog.userId,
        userName: auditLog.userName,
        impersonatorName: auditLog.impersonatorName,
        area: auditLog.area,
        action: auditLog.action,
        target: auditLog.target,
        item: { prefix: items.prefix, number: items.number, type: items.type, title: items.title },
      })
      .from(auditLog)
      .leftJoin(items, eq(items.id, auditLog.itemId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(filter.limit + 1)
      .offset(filter.offset);
    return {
      entries: rows.slice(0, filter.limit).map((r) => ({ ...r, item: r.item?.prefix ? r.item : null })),
      more: rows.length > filter.limit,
    };
  }

  /** Personen mit Einträgen (für den Filter), nach Name */
  async people() {
    const rows = await this.db
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(auditLog)
      .innerJoin(users, or(eq(users.id, auditLog.userId), eq(users.id, auditLog.impersonatorId)))
      .orderBy(users.name);
    return rows;
  }

  async purgeOld(): Promise<number> {
    const deleted = await this.db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, sql`now() - make_interval(months => ${AUDIT_RETENTION_MONTHS})`))
      .returning({ id: auditLog.id });
    return deleted.length;
  }
}
