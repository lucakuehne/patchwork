import { useRoute, useRouter } from 'vue-router';
import { itemRef, parseItemRef, type ItemKey } from './item-ref';
import { useSession } from './stores/session';
import type { ItemType } from './types';

/**
 * Vorgang öffnen, je nach Einstellung des Benutzers für seinen Typ (Entscheid vom 27.10.2026): als Seite (wie bisher)
 * oder im grossen Fenster über der aktuellen Ansicht. Das Fenster steht in der Adresse (`?item=PW-123`), «Zurück» im
 * Browser schliesst es. Ist der Typ unbekannt (undefined), öffnet der Vorgang als Seite.
 */
export const MODAL_QUERY = 'item';

export const itemHref = (item: ItemKey) => `/items/${itemRef(item)}`;

/** Klick mit Ctrl/Cmd/Shift oder mit der mittleren Taste: wie gewohnt in einem neuen Tab bzw. Fenster des Browsers */
export const opensInBrowser = (event?: MouseEvent) =>
  !!event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0);

export function useOpenItem() {
  const router = useRouter();
  const route = useRoute();
  const session = useSession();
  return (item: ItemKey, type: ItemType | null | undefined) => {
    if (type !== undefined && session.openMode(type) === 'modal') {
      void router.push({ path: route.path, query: { ...route.query, [MODAL_QUERY]: itemRef(item) }, hash: route.hash });
    } else {
      void router.push({ name: 'item', params: { ref: itemRef(item) } });
    }
  };
}

/** Kennung des Vorgangs im Fenster laut Adresse, sonst null */
export const modalKey = (query: Record<string, unknown>): ItemKey | null => parseItemRef(query[MODAL_QUERY]);
