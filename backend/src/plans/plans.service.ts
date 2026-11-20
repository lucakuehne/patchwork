import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { likePattern } from '../audit/audit-text';
import { InjectDb, type Db } from '../db/db.module';
import { planBuildings, planFloors, planLabels, planRooms, planSites, type PlanFloorRow } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import type { FloorContent } from './plan-content';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de', { numeric: true });

/** Bild des Plans, wie es mit «Speichern» hochgeladen wird */
export interface PlanImage {
  buffer: Buffer;
  contentType: string;
}

/**
 * Pläne (Entscheid vom 20.11.2026): Standorte, Gebäude und Stockwerke (Baum) sowie der Inhalt eines Stockwerks. Änderungen
 * am Baum gelten sofort; den Inhalt speichert das Bearbeiten auf einmal.
 */
@Injectable()
export class PlansService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /** Baum: Standorte und Gebäude nach Namen, Stockwerke wie im Gebäude (oberstes zuerst) */
  async tree() {
    const [sites, buildings, floors] = await Promise.all([
      this.db.select({ id: planSites.id, name: planSites.name }).from(planSites),
      this.db.select({ id: planBuildings.id, siteId: planBuildings.siteId, name: planBuildings.name }).from(planBuildings),
      this.db
        .select({
          id: planFloors.id,
          buildingId: planFloors.buildingId,
          name: planFloors.name,
          position: planFloors.position,
          // Spalten ausgeschrieben: drizzle lässt in einer Abfrage über eine Tabelle den Tabellennamen weg
          roomCount: sql<number>`(select count(*)::int from plan_rooms r where r.floor_id = plan_floors.id)`,
        })
        .from(planFloors)
        .orderBy(asc(planFloors.position), asc(planFloors.createdAt)),
    ]);
    return sites.sort(byName).map((site) => ({
      ...site,
      buildings: buildings
        .filter((b) => b.siteId === site.id)
        .sort(byName)
        .map(({ siteId: _, ...building }) => ({
          ...building,
          floors: floors.filter((f) => f.buildingId === building.id).map(({ id, name, roomCount }) => ({ id, name, roomCount })),
        })),
    }));
  }

  /** Inhalt eines Stockwerks mit dem Weg (Standort, Gebäude) */
  async floor(id: string) {
    const [row] = await this.db
      .select({ floor: planFloors, building: planBuildings, site: planSites })
      .from(planFloors)
      .innerJoin(planBuildings, eq(planBuildings.id, planFloors.buildingId))
      .innerJoin(planSites, eq(planSites.id, planBuildings.siteId))
      .where(eq(planFloors.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Stockwerk nicht gefunden');
    const [rooms, labels] = await Promise.all([
      this.db
        .select({ id: planRooms.id, name: planRooms.name, description: planRooms.description, points: planRooms.points })
        .from(planRooms)
        .where(eq(planRooms.floorId, id)),
      this.db.select({ id: planLabels.id, text: planLabels.text, x: planLabels.x, y: planLabels.y }).from(planLabels).where(eq(planLabels.floorId, id)),
    ]);
    const f = row.floor;
    return {
      id: f.id,
      name: f.name,
      site: { id: row.site.id, name: row.site.name },
      building: { id: row.building.id, name: row.building.name },
      rooms: rooms.sort(byName),
      labels,
      plan: planOf(f),
      contentUpdatedAt: f.contentUpdatedAt,
    };
  }

  /** Räume nach Name oder Beschreibung, mit Standort, Gebäude und Stockwerk */
  async search(q: string) {
    const pattern = likePattern(q.trim());
    const rows = await this.db
      .select({
        id: planRooms.id,
        name: planRooms.name,
        description: planRooms.description,
        floorId: planFloors.id,
        floor: planFloors.name,
        building: planBuildings.name,
        site: planSites.name,
      })
      .from(planRooms)
      .innerJoin(planFloors, eq(planFloors.id, planRooms.floorId))
      .innerJoin(planBuildings, eq(planBuildings.id, planFloors.buildingId))
      .innerJoin(planSites, eq(planSites.id, planBuildings.siteId))
      .where(or(ilike(planRooms.name, pattern), ilike(planRooms.description, pattern)))
      .limit(50);
    // Treffer im Namen zuerst
    const needle = q.trim().toLowerCase();
    return rows
      .sort((a, b) => Number(!a.name.toLowerCase().includes(needle)) - Number(!b.name.toLowerCase().includes(needle)) || byName(a, b))
      .slice(0, 20);
  }

  /** Bild des Plans eines Stockwerks */
  async planImage(floorId: string): Promise<{ storageKey: string; contentType: string }> {
    const [row] = await this.db
      .select({ key: planFloors.planStorageKey, type: planFloors.planContentType })
      .from(planFloors)
      .where(eq(planFloors.id, floorId))
      .limit(1);
    if (!row?.key) throw new NotFoundException('Kein Plan hinterlegt');
    return { storageKey: row.key, contentType: row.type ?? 'image/png' };
  }

  /* ---------- Baum ---------- */

  async createSite(name: string) {
    await this.assertUnique('site', name);
    const [site] = await this.db.insert(planSites).values({ name }).returning({ id: planSites.id, name: planSites.name });
    return site!;
  }

  async renameSite(id: string, name: string) {
    await this.assertUnique('site', name, null, id);
    const [site] = await this.db.update(planSites).set({ name }).where(eq(planSites.id, id)).returning({ id: planSites.id, name: planSites.name });
    if (!site) throw new NotFoundException('Standort nicht gefunden');
    return site;
  }

  async createBuilding(siteId: string, name: string) {
    await this.exists(planSites, siteId, 'Standort');
    await this.assertUnique('building', name, siteId);
    const [building] = await this.db
      .insert(planBuildings)
      .values({ siteId, name })
      .returning({ id: planBuildings.id, name: planBuildings.name });
    return building!;
  }

  async renameBuilding(id: string, name: string) {
    const [current] = await this.db.select({ siteId: planBuildings.siteId }).from(planBuildings).where(eq(planBuildings.id, id)).limit(1);
    if (!current) throw new NotFoundException('Gebäude nicht gefunden');
    await this.assertUnique('building', name, current.siteId, id);
    const [building] = await this.db
      .update(planBuildings)
      .set({ name })
      .where(eq(planBuildings.id, id))
      .returning({ id: planBuildings.id, name: planBuildings.name });
    return building!;
  }

  /** Neues Stockwerk zuoberst im Gebäude */
  async createFloor(buildingId: string, name: string) {
    await this.exists(planBuildings, buildingId, 'Gebäude');
    await this.assertUnique('floor', name, buildingId);
    return this.db.transaction(async (tx) => {
      await tx
        .update(planFloors)
        .set({ position: sql`${planFloors.position} + 1` })
        .where(eq(planFloors.buildingId, buildingId));
      const [floor] = await tx
        .insert(planFloors)
        .values({ buildingId, name, position: 0, contentUpdatedAt: new Date() })
        .returning({ id: planFloors.id, name: planFloors.name });
      return floor!;
    });
  }

  async renameFloor(id: string, name: string) {
    const [current] = await this.db.select({ buildingId: planFloors.buildingId }).from(planFloors).where(eq(planFloors.id, id)).limit(1);
    if (!current) throw new NotFoundException('Stockwerk nicht gefunden');
    await this.assertUnique('floor', name, current.buildingId, id);
    const [floor] = await this.db.update(planFloors).set({ name }).where(eq(planFloors.id, id)).returning({ id: planFloors.id, name: planFloors.name });
    return floor!;
  }

  /** Reihenfolge der Stockwerke eines Gebäudes, oberstes zuerst; alle Stockwerke des Gebäudes genau einmal */
  async orderFloors(buildingId: string, ids: string[]) {
    const floors = await this.db.select({ id: planFloors.id }).from(planFloors).where(eq(planFloors.buildingId, buildingId));
    if (!floors.length && !(await this.db.select({ id: planBuildings.id }).from(planBuildings).where(eq(planBuildings.id, buildingId))).length) {
      throw new NotFoundException('Gebäude nicht gefunden');
    }
    const known = new Set(floors.map((f) => f.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw new BadRequestException('Die Reihenfolge muss alle Stockwerke des Gebäudes genau einmal enthalten');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.update(planFloors).set({ position }).where(eq(planFloors.id, id));
    });
  }

  /** Löschen mit allem darunter; die Bilder der Pläne fallen ebenfalls weg */
  async remove(kind: 'site' | 'building' | 'floor', id: string) {
    const floorIds =
      kind === 'floor'
        ? [id]
        : (
            await this.db
              .select({ id: planFloors.id })
              .from(planFloors)
              .innerJoin(planBuildings, eq(planBuildings.id, planFloors.buildingId))
              .where(kind === 'building' ? eq(planBuildings.id, id) : eq(planBuildings.siteId, id))
          ).map((f) => f.id);
    const keys = floorIds.length
      ? (
          await this.db
            .select({ key: planFloors.planStorageKey })
            .from(planFloors)
            .where(and(inArray(planFloors.id, floorIds), isNotNull(planFloors.planStorageKey)))
        ).map((r) => r.key!)
      : [];
    const table = kind === 'site' ? planSites : kind === 'building' ? planBuildings : planFloors;
    const deleted = await this.db.delete(table).where(eq(table.id, id)).returning({ id: table.id });
    if (!deleted.length) throw new NotFoundException(`${{ site: 'Standort', building: 'Gebäude', floor: 'Stockwerk' }[kind]} nicht gefunden`);
    for (const key of keys) await this.storage.remove(key).catch(() => undefined);
  }

  /* ---------- Inhalt eines Stockwerks ---------- */

  /**
   * Inhalt eines Stockwerks speichern: Räume und Beschriftungen ersetzen, Plan behalten, ersetzen oder entfernen. Hat
   * inzwischen jemand anderes gespeichert, gibt es einen Konflikt statt eines stillen Überschreibens.
   */
  async saveContent(id: string, content: FloorContent, image: PlanImage | null) {
    if (content.plan?.replace && !image) throw new BadRequestException('Das Bild des Plans fehlt');
    // Bilder in der Ablage: das neue (bei einem Fehler wieder weg) und das ersetzte (nach dem Speichern weg)
    const files: { created: string | null; replaced: string | null } = { created: null, replaced: null };
    try {
      const saved = await this.db.transaction(async (tx) => {
        const [floor] = await tx.select().from(planFloors).where(eq(planFloors.id, id)).for('update').limit(1);
        if (!floor) throw new NotFoundException('Stockwerk nicht gefunden');
        if (floor.contentUpdatedAt.getTime() !== new Date(content.contentUpdatedAt).getTime()) {
          throw new ConflictException('Jemand anderes hat dieses Stockwerk inzwischen gespeichert. Bitte neu laden und die Änderungen nochmals machen.');
        }
        if (content.plan && !content.plan.replace && !floor.planStorageKey) throw new BadRequestException('Kein Plan hinterlegt');
        const plan = await this.planColumns(floor, content, image, (key) => (files.created = key));
        files.replaced = plan.oldKey;
        await tx.delete(planRooms).where(eq(planRooms.floorId, id));
        await tx.delete(planLabels).where(eq(planLabels.floorId, id));
        if (content.rooms.length) {
          await tx.insert(planRooms).values(
            content.rooms.map((r) => ({ id: r.id, floorId: id, name: r.name, description: r.description, points: r.points })),
          );
        }
        if (content.labels.length) {
          await tx.insert(planLabels).values(content.labels.map((l) => ({ id: l.id, floorId: id, text: l.text, x: l.x, y: l.y })));
        }
        const [updated] = await tx
          .update(planFloors)
          .set({ ...plan.columns, contentUpdatedAt: new Date() })
          .where(eq(planFloors.id, id))
          .returning({ contentUpdatedAt: planFloors.contentUpdatedAt });
        return updated!;
      });
      if (files.replaced) await this.storage.remove(files.replaced).catch(() => undefined);
      return saved;
    } catch (err) {
      // Neues Bild nicht liegen lassen, wenn das Speichern scheitert
      if (files.created) await this.storage.remove(files.created).catch(() => undefined);
      if ((err as { code?: string }).code === '23505') throw new BadRequestException('Ein Raumname kommt im Stockwerk doppelt vor');
      if ((err as { code?: string }).code === '23503') throw new NotFoundException('Stockwerk nicht gefunden');
      throw err;
    }
  }

  private async planColumns(floor: PlanFloorRow, content: FloorContent, image: PlanImage | null, onSaved: (key: string) => void) {
    const p = content.plan;
    if (!p) {
      return {
        oldKey: floor.planStorageKey,
        columns: {
          planStorageKey: null,
          planContentType: null,
          planWidthPx: null,
          planHeightPx: null,
          planMetersPerPx: null,
          planX: 0,
          planY: 0,
          planCalibrated: false,
        } satisfies Partial<PlanFloorRow>,
      };
    }
    const placement = { planMetersPerPx: p.metersPerPx, planX: p.x, planY: p.y, planCalibrated: p.calibrated };
    if (!p.replace) return { oldKey: null, columns: placement };
    const key = await this.storage.save(image!.buffer, 'plan');
    onSaved(key);
    return {
      oldKey: floor.planStorageKey,
      columns: { ...placement, planStorageKey: key, planContentType: image!.contentType, planWidthPx: p.widthPx, planHeightPx: p.heightPx },
    };
  }

  /* ---------- Hilfen ---------- */

  /** Namen eindeutig: Standorte überall, Gebäude im Standort, Stockwerke im Gebäude (Gross-/Kleinschreibung egal) */
  private async assertUnique(kind: 'site' | 'building' | 'floor', name: string, parentId: string | null = null, exceptId?: string) {
    const lower = name.trim().toLowerCase();
    const table = kind === 'site' ? planSites : kind === 'building' ? planBuildings : planFloors;
    const parent = kind === 'building' ? eq(planBuildings.siteId, parentId!) : kind === 'floor' ? eq(planFloors.buildingId, parentId!) : undefined;
    const [other] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(sql`lower(${table.name}) = ${lower}`, parent, exceptId ? ne(table.id, exceptId) : undefined))
      .limit(1);
    if (other) {
      throw new ConflictException(
        { site: 'Diesen Standort gibt es schon', building: 'Dieses Gebäude gibt es im Standort schon', floor: 'Dieses Stockwerk gibt es im Gebäude schon' }[kind],
      );
    }
  }

  private async exists(table: typeof planSites | typeof planBuildings, id: string, label: string) {
    const [row] = await this.db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!row) throw new NotFoundException(`${label} nicht gefunden`);
  }
}

/** Plan im Hintergrund für die Oberfläche; die Adresse ändert sich mit jedem neuen Bild */
function planOf(f: PlanFloorRow) {
  if (!f.planStorageKey || !f.planMetersPerPx || !f.planWidthPx || !f.planHeightPx) return null;
  return {
    url: `/api/plans/floors/${f.id}/image?v=${f.planStorageKey.slice(-12)}`,
    widthPx: f.planWidthPx,
    heightPx: f.planHeightPx,
    metersPerPx: f.planMetersPerPx,
    x: f.planX,
    y: f.planY,
    calibrated: f.planCalibrated,
  };
}

