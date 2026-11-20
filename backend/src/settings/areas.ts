import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { items, type ItemType, type User, type UserRole } from '../db/schema';
import { byKey, type ItemKey } from '../items/item-ref';
import { PERMISSIONS, permissionsOf, type Permission, type PermissionSettings } from './permissions';
import { SettingsService } from './settings.service';

// Rechte je Rolle stehen in permissions.ts; hier weitergereicht für die bisherigen Importe
export * from './permissions';

export const ITEM_AREAS = ['inbox', 'incident', 'task'] as const;
/** Bereiche der Vorgänge */
export type ItemArea = (typeof ITEM_AREAS)[number];
export const AREAS = [...ITEM_AREAS, 'plans'] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABELS: Record<Area, string> = { inbox: 'Eingang', incident: 'Störungen', task: 'Aufgaben', plans: 'Pläne' };

export const areaOf = (type: ItemType | null): ItemArea => type ?? 'inbox';
const isItemArea = (a: Area): a is ItemArea => (ITEM_AREAS as readonly string[]).includes(a);

/** Bereiche einer Rolle aus ihren Rechten */
export function areasOf(role: UserRole, settings: PermissionSettings): Area[] {
  const permissions = permissionsOf(role, settings);
  return AREAS.filter((a) => permissions.includes(a === 'plans' ? 'plansView' : a));
}

/** SQL-Bedingung: Vorgänge in diesen Bereichen (Eingang = ohne Typ, auch verworfene) */
export function areaCondition(areas: readonly ItemArea[]): SQL {
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

  /** Rechte eines Benutzers */
  async permissions(user: Pick<User, 'role'>): Promise<Permission[]> {
    if (user.role === 'admin') return [...PERMISSIONS];
    return permissionsOf(user.role, await this.settings.get('permissions'));
  }

  async can(user: Pick<User, 'role'>, permission: Permission): Promise<boolean> {
    return (await this.permissions(user)).includes(permission);
  }

  /** Bereiche eines Benutzers */
  async of(user: Pick<User, 'role'>): Promise<Area[]> {
    if (user.role === 'admin') return [...AREAS];
    return areasOf(user.role, await this.settings.get('permissions'));
  }

  /** Eingeschränkte Bereiche der Vorgänge oder null, wenn er alle sieht (dann braucht es keine Bedingung) */
  async limit(user: Pick<User, 'role'>): Promise<ItemArea[] | null> {
    const areas = (await this.of(user)).filter(isItemArea);
    return areas.length === ITEM_AREAS.length ? null : areas;
  }

  /** Prüfer für viele Benutzer auf einmal (Mails): Rolle → sieht den Bereich des Typs? */
  async checker(): Promise<(user: Pick<User, 'role'>, type: ItemType | null) => boolean> {
    const settings = await this.settings.get('permissions');
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
