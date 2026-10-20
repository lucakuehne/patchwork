import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/db.module';
import { items, links, statuses, type Item } from '../db/schema';

/**
 * Original, zu dem ein Duplikat umgeleitet ist, sonst null.
 *
 * Die Umleitung gilt, solange der Vorgang als «Duplikat von» verknüpft ist und in einem abgeschlossenen Status steht
 * (und keiner der beiden verworfen). Dann landen Mail-Antworten beim Original, und das Portal
 * zeigt beim Duplikat den Hinweis aufs Original statt des Antwortfelds. Wird das Duplikat
 * wieder geöffnet oder die Verknüpfung gelöst, gilt wieder das Duplikat selbst.
 */
export async function duplicateRedirect(db: Tx, item: Item): Promise<Item | null> {
  if (item.discarded || !item.statusId) return null;
  const [row] = await db
    .select({ original: items })
    .from(links)
    .innerJoin(items, eq(items.id, links.toId))
    .innerJoin(statuses, eq(statuses.id, item.statusId))
    .where(
      and(
        eq(links.fromId, item.id),
        eq(links.kind, 'duplicate'),
        eq(items.discarded, false),
        eq(statuses.closed, true),
      ),
    )
    .limit(1);
  return row?.original ?? null;
}
