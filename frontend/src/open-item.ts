import { useRoute, useRouter } from 'vue-router';
import { useSession } from './stores/session';
import type { ItemType } from './types';

/**
 * Vorgang öffnen, je nach Einstellung des Benutzers für seinen Typ (Entscheid vom 27.10.2026): als Seite (wie bisher)
 * oder im grossen Fenster über der aktuellen Ansicht. Das Fenster steht in der Adresse (`?vorgang=123`), «Zurück» im
 * Browser schliesst es. Ist der Typ unbekannt (undefined), öffnet der Vorgang als Seite.
 */
export const MODAL_QUERY = 'vorgang';

export const itemHref = (number: number) => `/v/${number}`;

/** Klick mit Ctrl/Cmd/Shift oder mit der mittleren Taste: wie gewohnt in einem neuen Tab bzw. Fenster des Browsers */
export const opensInBrowser = (event?: MouseEvent) =>
  !!event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0);

export function useOpenItem() {
  const router = useRouter();
  const route = useRoute();
  const session = useSession();
  return (number: number, type: ItemType | null | undefined) => {
    if (type !== undefined && session.openMode(type) === 'modal') {
      void router.push({ path: route.path, query: { ...route.query, [MODAL_QUERY]: String(number) }, hash: route.hash });
    } else {
      void router.push({ name: 'item', params: { number } });
    }
  };
}

/** Nummer des Vorgangs im Fenster laut Adresse, sonst null */
export function modalNumber(query: Record<string, unknown>): number | null {
  const value = query[MODAL_QUERY];
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
