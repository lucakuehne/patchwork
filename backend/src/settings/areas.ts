import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { items, type ItemType, type User, type UserRole } from '../db/schema';
import { byKey, type ItemKey } from '../items/item-ref';
import { SettingsService } from './settings.service';

/**
 * Bereiche der Oberfläche (seit 23.10.2026): Eingang (Vorgänge ohne Typ), Störungen und Aufgaben. Admins sehen alle,
 * die IT die unter Verwaltung → Benutzer gewählten, Standard-Benutzer keinen (nur das Portal). Ohne Zugriff ist ein
 * Vorgang gesperrt, auch per Link, fehlt in Listen, Zählern, Suche und Verknüpfungen, und die Person erhält dazu keine
 * Mails. Zuständig und erwähnbar bleibt sie trotzdem.
 */
export const AREAS = ['inbox', 'incident', 'task'] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABELS: Record<Area, string> = { inbox: 'Eingang', incident: 'Störungen', task: 'Aufgaben' };

/** Bereiche der Rolle IT (mindestens einer) */
export interface AreaSettings {
  it: Area[];
}

export const areaOf = (type: ItemType | null): Area => type ?? 'inbox';

/** Bereiche einer Rolle: Admins alle, IT laut Einstellung, Standard-Benutzer keine */
export function areasOf(role: UserRole, settings: AreaSettings): Area[] {
  if (role === 'admin') return [...AREAS];
  if (role === 'it') return AREAS.filter((a) => settings.it.includes(a));
  return [];
}

/** SQL-Bedingung: Vorgänge in diesen Bereichen (Eingang = ohne Typ, auch verworfene) */
export function areaCondition(areas: readonly Area[]): SQL {
  const parts: SQL[] = [];
  if (areas.includes('inbox')) parts.push(isNull(items.type));
  const types = areas.filter((a): a is ItemType => a !== 'inbox');
  if (types.length > 0) parts.push(inArray(items.type, types));
  return parts.length > 0 ? or(...parts)! : sql`false`;
}

export const noAccess = (type: ItemType | null) =>
  new ForbiddenException(`Kein Zugriff auf den Bereich «${AREA_LABELS[areaOf(type)]}»`);

@Injectable()
export class AreasService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Bereiche eines Benutzers */
  async of(user: Pick<User, 'role'>): Promise<Area[]> {
    if (user.role === 'admin') return [...AREAS];
    return areasOf(user.role, await this.settings.get('areas'));
  }

  /** Eingeschränkte Bereiche eines Benutzers oder null, wenn er alle sieht (dann braucht es keine Bedingung) */
  async limit(user: Pick<User, 'role'>): Promise<Area[] | null> {
    const areas = await this.of(user);
    return areas.length === AREAS.length ? null : areas;
  }

  /** Prüfer für viele Benutzer auf einmal (Mails): Rolle → sieht den Bereich des Typs? */
  async checker(): Promise<(user: Pick<User, 'role'>, type: ItemType | null) => boolean> {
    const settings = await this.settings.get('areas');
    return (user, type) => user.role !== 'it' || areasOf(user.role, settings).includes(areaOf(type));
  }

  async canSee(user: Pick<User, 'role'>, type: ItemType | null): Promise<boolean> {
    const limit = await this.limit(user);
    return !limit || limit.includes(areaOf(type));
  }

  async assertType(user: Pick<User, 'role'>, type: ItemType | null): Promise<void> {
    if (!(await this.canSee(user, type))) throw noAccess(type);
  }

  /** Vorgang über seine Kennung; einen unbekannten meldet später die Route selbst («nicht gefunden») */
  async assertKey(user: Pick<User, 'role'>, key: ItemKey): Promise<void> {
    const limit = await this.limit(user);
    if (!limit) return;
    const [row] = await this.db.select({ type: items.type }).from(items).where(byKey(key)).limit(1);
    if (row && !limit.includes(areaOf(row.type))) throw noAccess(row.type);
  }

  /** Vorgang über seine ID (Anhänge, Notizen) */
  async assertItem(user: Pick<User, 'role'>, itemId: string): Promise<void> {
    const limit = await this.limit(user);
    if (!limit) return;
    const [row] = await this.db.select({ type: items.type }).from(items).where(eq(items.id, itemId)).limit(1);
    if (row && !limit.includes(areaOf(row.type))) throw noAccess(row.type);
  }
}
