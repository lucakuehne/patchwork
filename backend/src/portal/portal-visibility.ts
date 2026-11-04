import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { items, participants, type Entry } from '../db/schema';
import { HELPSPOT_PREFIX } from '../items/item-ref';

/**
 * Vorgänge, die jemand im Portal sieht: eigene Meldungen und seit 04.11.2026 die, an denen er beteiligt ist. Verworfene
 * und aus HelpSpot übernommene nie.
 */
export function viewableInPortal(userId: string): SQL {
  return and(
    or(
      eq(items.reporterId, userId),
      sql`exists (select 1 from ${participants} where ${participants.itemId} = ${items.id} and ${participants.userId} = ${userId})`,
    ),
    eq(items.discarded, false),
    ne(items.prefix, HELPSPOT_PREFIX),
  )!;
}

/**
 * Sieht der Melder einen Anhang im Portal? Ja bei der Meldung selbst (ohne Eintrag), bei öffentlichen Antworten und bei
 * der Begründung einer Ablehnung, über die er informiert wurde (Bilder im Text).
 */
export function visibleInPortal(entryId: string | null, entryKind: Entry['kind'] | null, entryMeta: Entry['meta'] | null): boolean {
  if (!entryId) return true;
  return entryKind === 'reply' || (entryKind === 'status' && !!entryMeta?.rejected && !!entryMeta?.notified);
}
