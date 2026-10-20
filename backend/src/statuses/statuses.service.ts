import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { items, rules, statuses, statusTargets, statusTransitions, type ItemType, type Status } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import {
  defaultColor,
  REQUIRED_TARGETS,
  rejectAllowed,
  STATUS_TARGETS,
  TARGET_CLOSED,
  TARGET_LABELS,
  targetsOf,
  targetsProblem,
  transitionAllowed,
  type StatusColor,
  type StatusTarget,
  type Targets,
  type TargetsByType,
} from './status-rules';

/** Ablauf der Status: pro Typ eingeschränkt oder frei, und die erlaubten Wechsel */
export interface StatusFlow {
  restrict: { incident: boolean; task: boolean };
  transitions: { fromId: string; toId: string }[];
}

/** Ersatz beim Löschen: für die Vorgänge und für jedes Ziel, das auf den Status zeigt (null = freiwilliges Ziel leeren) */
export interface RemoveInput {
  replacementId?: string | null;
  targets?: Partial<Record<StatusTarget, string | null>>;
}

const TYPE_LABELS: Record<ItemType, string> = { incident: 'Störung', task: 'Aufgabe' };

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'status';
}

@Injectable()
export class StatusesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async flow(tx: Tx = this.db): Promise<StatusFlow> {
    const [settings, transitions] = await Promise.all([
      this.settings.get('statusFlow'),
      tx.select({ fromId: statusTransitions.fromId, toId: statusTransitions.toId }).from(statusTransitions),
    ]);
    return { restrict: settings.restrict, transitions };
  }

  /**
   * Ablauf eines Typs speichern: eingeschränkt ja/nein und die erlaubten Wechsel (ersetzt die bisherigen). Ein Pfeil in
   * den Ablehnen-Status bestimmt, aus welchen Status «Ablehnen» möglich ist.
   */
  async setFlow(type: ItemType, restrict: boolean, transitions: { fromId: string; toId: string }[]): Promise<StatusFlow> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const ofType = new Map((await this.list(tx)).filter((s) => s.type === type).map((s) => [s.id, s]));
      for (const t of transitions) {
        if (!ofType.has(t.fromId) || !ofType.has(t.toId)) {
          throw new BadRequestException('Ein Wechsel verweist auf einen Status eines anderen Typs');
        }
        if (t.fromId === t.toId) throw new BadRequestException('Ein Status kann nicht in sich selbst wechseln');
      }
      await tx.delete(statusTransitions).where(inArray(statusTransitions.fromId, [...ofType.keys()]));
      const unique = [...new Map(transitions.map((t) => [`${t.fromId}>${t.toId}`, t])).values()];
      if (unique.length) await tx.insert(statusTransitions).values(unique);
    });
    const current = await this.settings.get('statusFlow');
    await this.settings.set('statusFlow', { restrict: { ...current.restrict, [type]: restrict } });
    return this.flow();
  }

  /** Wechsel von Hand prüfen; Automatisches (Regeln, Antworten, Typwechsel …) geht immer. */
  async assertTransition(type: ItemType, from: Status | undefined, to: Status, tx: Tx = this.db): Promise<void> {
    const flow = await this.flow(tx);
    if (!transitionAllowed(flow.restrict[type], flow.transitions, from?.id ?? null, to.id)) {
      throw new BadRequestException(`Der Wechsel von «${from?.label}» zu «${to.label}» ist im Ablauf nicht vorgesehen.`);
    }
  }

  /**
   * Ziel von «Ablehnen» für einen Vorgang in «current»: gibt es nur mit Ablehnen-Ziel, nicht aus dem Ablehnen-Status
   * selbst und bei eingeschränktem Ablauf nur entlang eines Pfeils in den Ablehnen-Status.
   */
  async rejectTarget(type: ItemType, current: Status | undefined, tx: Tx = this.db): Promise<Status> {
    const [targets, flow, all] = await Promise.all([this.targets(tx), this.flow(tx), this.list(tx)]);
    const rejectId = targets[type].reject;
    if (!rejectId) throw new BadRequestException(`Für den Typ ${TYPE_LABELS[type]} ist «Ablehnen» nicht eingerichtet`);
    if (current?.id === rejectId) throw new BadRequestException('Der Vorgang ist bereits abgelehnt');
    if (!rejectAllowed(flow.restrict[type], flow.transitions, rejectId, current?.id ?? null)) {
      throw new BadRequestException(`Aus «${current?.label}» ist «Ablehnen» im Ablauf nicht vorgesehen.`);
    }
    return all.find((s) => s.id === rejectId)!;
  }

  /** Ziel-Status beider Typen */
  async targets(tx: Tx = this.db): Promise<TargetsByType> {
    const rows = await tx.select().from(statusTargets);
    const result: TargetsByType = { incident: {}, task: {} };
    for (const row of rows) result[row.type][row.target] = row.statusId;
    return result;
  }

  /** Status eines Ziels; Pflicht-Ziele (Start, nach Antwort, Schliessen) gibt es immer. */
  async targetStatus(type: ItemType, target: 'start' | 'reply' | 'close', tx?: Tx): Promise<Status>;
  async targetStatus(type: ItemType, target: StatusTarget, tx?: Tx): Promise<Status | undefined>;
  async targetStatus(type: ItemType, target: StatusTarget, tx: Tx = this.db): Promise<Status | undefined> {
    const [row] = await tx
      .select({ status: statuses })
      .from(statusTargets)
      .innerJoin(statuses, eq(statuses.id, statusTargets.statusId))
      .where(sql`${statusTargets.type} = ${type} and ${statusTargets.target} = ${target}`)
      .limit(1);
    if (!row && REQUIRED_TARGETS.includes(target)) {
      throw new Error(`Für Typ ${type} fehlt das Ziel «${TARGET_LABELS[target]}»`);
    }
    return row?.status;
  }

  /** Ziele eines Typs speichern (ersetzt die bisherigen). */
  async setTargets(type: ItemType, targets: Targets): Promise<TargetsByType> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const all = await this.list(tx);
      const problem = targetsProblem(all, type, targets, (id) => all.find((s) => s.id === id)?.label ?? id);
      if (problem) throw new BadRequestException(problem);
      await this.writeTargets(tx, type, targets);
    });
    return this.targets();
  }

  list(tx: Tx = this.db): Promise<Status[]> {
    return tx.select().from(statuses).orderBy(asc(statuses.type), asc(statuses.position));
  }

  async get(id: string, tx: Tx = this.db): Promise<Status> {
    const [status] = await tx.select().from(statuses).where(eq(statuses.id, id)).limit(1);
    if (!status) throw new NotFoundException('Status nicht gefunden');
    return status;
  }

  async usage(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ statusId: items.statusId, count: sql<number>`count(*)::int` })
      .from(items)
      .groupBy(items.statusId);
    return Object.fromEntries(rows.filter((r) => r.statusId).map((r) => [r.statusId!, r.count]));
  }

  /** Zeitgesteuerte Regeln, die einen Status nennen: Status-ID → Namen der Regeln */
  async rulesUsage(tx: Tx = this.db): Promise<Record<string, string[]>> {
    const timed = await tx.select({ name: rules.name, schedule: rules.schedule }).from(rules).where(isNotNull(rules.schedule));
    const result: Record<string, string[]> = {};
    for (const rule of timed) {
      for (const id of rule.schedule?.statusIds ?? []) (result[id] ??= []).push(rule.name);
    }
    return result;
  }

  async create(input: { type: ItemType; label: string; closed: boolean }): Promise<Status> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const all = await this.list(tx);
      const ofType = all.filter((s) => s.type === input.type);
      const base = slugify(input.label);
      let key = base;
      for (let i = 2; ofType.some((s) => s.key === key); i++) key = `${base}_${i}`;
      const position = ofType.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const [created] = await tx
        .insert(statuses)
        .values({
          type: input.type,
          key,
          label: input.label.trim(),
          closed: input.closed,
          position,
          color: defaultColor(input.closed),
        })
        .returning();
      return created!;
    });
  }

  async update(
    id: string,
    input: { label?: string; closed?: boolean; color?: StatusColor; diagramX?: number; diagramY?: number },
  ): Promise<Status> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      const changes: Partial<Status> = {};
      if (input.label !== undefined) changes.label = input.label.trim();
      if (input.color !== undefined) changes.color = input.color;
      if (input.diagramX !== undefined) changes.diagramX = input.diagramX;
      if (input.diagramY !== undefined) changes.diagramY = input.diagramY;
      if (input.closed !== undefined && input.closed !== current.closed) {
        const own = (await this.targets(tx))[current.type];
        for (const target of targetsOf(own, id)) {
          if (TARGET_CLOSED[target] !== input.closed) {
            throw new BadRequestException(
              `«${current.label}» ist «${TARGET_LABELS[target]}» und muss ${TARGET_CLOSED[target] ? 'abgeschlossen' : 'offen'} bleiben. ` +
                (target === 'start'
                  ? 'Zuerst im Diagramm den Startpfeil auf einen anderen Status ziehen.'
                  : 'Zuerst unter «Automatische Wechsel» einen anderen Status wählen.'),
            );
          }
        }
        if (input.closed) {
          const ruleNames = (await this.rulesUsage(tx))[id];
          if (ruleNames?.length) {
            throw new BadRequestException(
              `«${current.label}» wird in der zeitgesteuerten Regel «${ruleNames[0]}» verwendet. Zeitgesteuerte Regeln gelten nur für offene Status.`,
            );
          }
        }
        changes.closed = input.closed;
        await tx
          .update(items)
          .set({ closedAt: input.closed ? new Date() : null })
          .where(eq(items.statusId, id));
      }
      if (Object.keys(changes).length === 0) return current;
      const [updated] = await tx.update(statuses).set(changes).where(eq(statuses.id, id)).returning();
      return updated!;
    });
  }

  /** Setzt die Reihenfolge der Status eines Typs. */
  async reorder(type: ItemType, ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const ofType = (await this.list(tx)).filter((s) => s.type === type);
      const known = new Set(ofType.map((s) => s.id));
      if (ids.length !== ofType.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new BadRequestException('Die Reihenfolge muss alle Status des Typs genau einmal enthalten');
      }
      for (const [position, id] of ids.entries()) {
        await tx.update(statuses).set({ position }).where(eq(statuses.id, id));
      }
    });
  }

  /**
   * Löscht einen Status. Vorgänge erhalten den Ersatzstatus, jedes Ziel, das auf den Status zeigt, den angegebenen
   * Ersatz (freiwillige Ziele auch keinen). Zeitgesteuerte Regeln erhalten den Ersatzstatus, wenn er offen ist, sonst
   * fällt der Status weg; eine Regel ohne Status wird ausgeschaltet.
   */
  async remove(id: string, input: RemoveInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      const all = await this.list(tx);
      const others = all.filter((s) => s.id !== id);
      const labelOf = (statusId: string) => all.find((s) => s.id === statusId)?.label ?? statusId;

      const own: Targets = { ...(await this.targets(tx))[current.type] };
      for (const target of targetsOf(own, id)) {
        const given = input.targets?.[target];
        if (given === undefined || given === id) {
          throw new BadRequestException(`«${current.label}» ist «${TARGET_LABELS[target]}». Bitte dafür einen anderen Status wählen.`);
        }
        if (given === null) {
          if (REQUIRED_TARGETS.includes(target)) throw new BadRequestException(`«${TARGET_LABELS[target]}» braucht einen Status`);
          delete own[target];
        } else {
          own[target] = given;
        }
      }
      const problem = targetsProblem(others, current.type, own, labelOf);
      if (problem) throw new BadRequestException(problem);

      const replacement = input.replacementId ? others.find((s) => s.id === input.replacementId) : undefined;
      if (input.replacementId && (!replacement || replacement.type !== current.type)) {
        throw new BadRequestException('Der Ersatzstatus muss zum selben Typ gehören');
      }
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(eq(items.statusId, id));
      if ((usage?.count ?? 0) > 0) {
        if (!replacement) throw new BadRequestException('Der Status wird verwendet. Bitte einen Ersatzstatus wählen.');
        await tx
          .update(items)
          .set({
            statusId: replacement.id,
            ...(current.closed !== replacement.closed ? { closedAt: replacement.closed ? new Date() : null } : {}),
          })
          .where(eq(items.statusId, id));
      }

      const timed = await tx.select().from(rules).where(isNotNull(rules.schedule));
      for (const rule of timed) {
        const schedule = rule.schedule!;
        if (!schedule.statusIds.includes(id)) continue;
        const statusIds = schedule.statusIds.filter((s) => s !== id);
        if (replacement && !replacement.closed && !statusIds.includes(replacement.id)) statusIds.push(replacement.id);
        const active = rule.active && (schedule.waiting || statusIds.length > 0);
        await tx.update(rules).set({ schedule: { ...schedule, statusIds }, active }).where(eq(rules.id, rule.id));
      }

      await this.writeTargets(tx, current.type, own);
      await tx.delete(statuses).where(eq(statuses.id, id));
      const remaining = others.filter((s) => s.type === current.type);
      for (const [position, s] of remaining.entries()) {
        await tx.update(statuses).set({ position }).where(eq(statuses.id, s.id));
      }
    });
  }

  private async writeTargets(tx: Tx, type: ItemType, targets: Targets) {
    await tx.delete(statusTargets).where(eq(statusTargets.type, type));
    const rows = STATUS_TARGETS.filter((t) => targets[t]).map((target) => ({ type, target, statusId: targets[target]! }));
    if (rows.length) await tx.insert(statusTargets).values(rows);
  }

  /** Serialisiert Änderungen an den Status. */
  private async lock(tx: Tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(4711002)`);
  }
}
