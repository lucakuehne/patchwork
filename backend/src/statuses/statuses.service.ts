import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { items, statuses, statusTransitions, type ItemType, type Status, type StatusCategory } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { CATEGORY_COLORS, CATEGORY_LABELS, isClosedCategory, missingCategories, transitionAllowed, type StatusColor } from './status-rules';

/** Ablauf der Status: pro Typ eingeschränkt oder frei, und die erlaubten Wechsel */
export interface StatusFlow {
  restrict: { incident: boolean; task: boolean };
  transitions: { fromId: string; toId: string }[];
}

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

  /** Ablauf eines Typs speichern: eingeschränkt ja/nein und die erlaubten Wechsel (ersetzt die bisherigen). */
  async setFlow(type: ItemType, restrict: boolean, transitions: { fromId: string; toId: string }[]): Promise<StatusFlow> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const ofType = new Map((await this.list(tx)).filter((s) => s.type === type).map((s) => [s.id, s]));
      for (const t of transitions) {
        const to = ofType.get(t.toId);
        if (!ofType.has(t.fromId) || !to) throw new BadRequestException('Ein Wechsel verweist auf einen Status eines anderen Typs');
        if (t.fromId === t.toId) throw new BadRequestException('Ein Status kann nicht in sich selbst wechseln');
        if (to.category === 'rejected') throw new BadRequestException('In «Abgelehnt» führt nur «Ablehnen»');
      }
      await tx.delete(statusTransitions).where(inArray(statusTransitions.fromId, [...ofType.keys()]));
      const unique = [...new Map(transitions.map((t) => [`${t.fromId}>${t.toId}`, t])).values()];
      if (unique.length) await tx.insert(statusTransitions).values(unique);
    });
    const current = await this.settings.get('statusFlow');
    await this.settings.set('statusFlow', { restrict: { ...current.restrict, [type]: restrict } });
    return this.flow();
  }

  /** Wechsel von Hand prüfen; Automatisches (Regeln, Antworten, Ablehnen …) geht immer. */
  async assertTransition(type: ItemType, from: Status | undefined, to: Status, tx: Tx = this.db): Promise<void> {
    const flow = await this.flow(tx);
    if (!transitionAllowed(flow.restrict[type], flow.transitions, from?.id ?? null, to.id)) {
      throw new BadRequestException(`Der Wechsel von «${from?.label}» zu «${to.label}» ist im Ablauf nicht vorgesehen.`);
    }
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

  async create(input: { type: ItemType; label: string; category: StatusCategory }): Promise<Status> {
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
          category: input.category,
          position,
          color: CATEGORY_COLORS[input.category],
        })
        .returning();
      return created!;
    });
  }

  async update(
    id: string,
    input: { label?: string; category?: StatusCategory; color?: StatusColor; diagramX?: number; diagramY?: number },
  ): Promise<Status> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      const changes: Partial<Status> = {};
      if (input.label !== undefined) changes.label = input.label.trim();
      if (input.color !== undefined) changes.color = input.color;
      if (input.diagramX !== undefined) changes.diagramX = input.diagramX;
      if (input.diagramY !== undefined) changes.diagramY = input.diagramY;
      if (input.category !== undefined && input.category !== current.category) {
        changes.category = input.category;
        const after = (await this.list(tx)).map((s) => (s.id === id ? { ...s, category: input.category! } : s));
        this.assertComplete(after, current.type);
        if (isClosedCategory(current.category) !== isClosedCategory(input.category)) {
          await tx
            .update(items)
            .set({ closedAt: isClosedCategory(input.category) ? new Date() : null })
            .where(eq(items.statusId, id));
        }
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

  /** Löscht einen Status. Vorgänge mit diesem Status erhalten den Ersatzstatus. */
  async remove(id: string, replacementId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      const all = await this.list(tx);
      this.assertComplete(
        all.filter((s) => s.id !== id),
        current.type,
      );

      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(eq(items.statusId, id));
      if ((usage?.count ?? 0) > 0) {
        if (!replacementId) {
          throw new BadRequestException('Der Status wird verwendet. Bitte einen Ersatzstatus wählen.');
        }
        const replacement = all.find((s) => s.id === replacementId);
        if (!replacement || replacement.type !== current.type || replacement.id === id) {
          throw new BadRequestException('Der Ersatzstatus muss zum selben Typ gehören');
        }
        const closedChanges = isClosedCategory(current.category) !== isClosedCategory(replacement.category);
        await tx
          .update(items)
          .set({
            statusId: replacement.id,
            ...(closedChanges ? { closedAt: isClosedCategory(replacement.category) ? new Date() : null } : {}),
          })
          .where(eq(items.statusId, id));
      }
      await tx.delete(statuses).where(eq(statuses.id, id));

      const remaining = all.filter((s) => s.type === current.type && s.id !== id);
      for (const [position, s] of remaining.entries()) {
        await tx.update(statuses).set({ position }).where(eq(statuses.id, s.id));
      }
    });
  }

  /** IDs aller Status eines Typs mit den angegebenen Kategorien. */
  async idsByCategory(type: ItemType, categories: StatusCategory[], tx: Tx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.type, type), inArray(statuses.category, categories)));
    return rows.map((r) => r.id);
  }

  private assertComplete(all: Status[], type: ItemType) {
    const missing = missingCategories(all, type);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Es braucht mindestens einen Status der Kategorie ${missing.map((c) => `«${CATEGORY_LABELS[c]}»`).join(', ')}`,
      );
    }
  }

  /** Serialisiert Änderungen an den Status. */
  private async lock(tx: Tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(4711002)`);
  }
}
