import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  EMPTY_FILTERS,
  filterPart,
  filtersFromQuery,
  queryWithFilters,
  sameFilters,
  type ListFilterValues,
  type ListSort,
} from './list-filters';
import { modalKey } from './open-item';
import type { ReportScope } from './types';

/**
 * Höhe des oben klebenden Blocks (Hinweisbalken und Kopfzeile) als CSS-Variable «--sticky-top», damit klebende
 * Seitenleisten darunter bleiben, auch wenn Balken dazukommen oder wegfallen.
 */
export function useStickyTop(el: Ref<HTMLElement | null>) {
  const root = document.documentElement;
  // Klebt der Block nicht (bei wenig Höhe statisch), braucht es darunter keinen Abstand
  const update = () => {
    const block = el.value;
    const sticky = !!block && getComputedStyle(block).position === 'sticky';
    root.style.setProperty('--sticky-top', `${sticky ? block.offsetHeight : 0}px`);
  };
  const observer = new ResizeObserver(update);
  watch(
    el,
    (current, previous) => {
      if (previous) observer.unobserve(previous);
      if (current) observer.observe(current);
      else root.style.removeProperty('--sticky-top');
    },
    { immediate: true },
  );
  window.addEventListener('resize', update);
  onBeforeUnmount(() => {
    observer.disconnect();
    window.removeEventListener('resize', update);
    root.style.removeProperty('--sticky-top');
  });
}

/** Filter «Nur meine», pro Ansicht im Browser gemerkt. */
export function useMineFilter(key: string): Ref<boolean> {
  const storageKey = `patchwork.mine.${key}`;
  let initial = false;
  try {
    initial = localStorage.getItem(storageKey) === '1';
  } catch {
    // Speicher nicht verfügbar
  }
  const mine = ref(initial);
  watch(mine, (value) => {
    try {
      localStorage.setItem(storageKey, value ? '1' : '0');
    } catch {
      // ignorieren
    }
  });
  return mine;
}

/** Wert pro Ansicht im Browser gemerkt (JSON); fehlt der Speicher oder ist der Wert ungültig, gilt «initial». */
function useStored<T>(storageKey: string, initial: T, valid: (value: unknown) => boolean): Ref<T> {
  let start = initial;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      if (valid(parsed)) start = parsed as T;
    }
  } catch {
    // Speicher nicht verfügbar oder ungültig
  }
  const value = ref(start) as Ref<T>;
  watch(
    value,
    (current) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(current));
      } catch {
        // ignorieren
      }
    },
    { deep: true },
  );
  return value;
}

/**
 * Filter einer Liste (Priorität, Zuständig, Status, Meldeweg), pro Ansicht im Browser gemerkt und in der Adresse der
 * Route «routeName» (Entscheid vom 03.11.2026): Filter in der Adresse gehen vor und gelten danach als gemerkte; ohne
 * Filter in der Adresse gelten die gemerkten und erscheinen darin. Ein Wechsel ersetzt die Adresse, «Zurück» im Browser
 * verlässt die Liste.
 */
export function useListFilters(key: string, routeName = key): Ref<ListFilterValues> {
  const route = useRoute();
  const router = useRouter();
  const stored = useStored<ListFilterValues>(`patchwork.filter.${key}`, { ...EMPTY_FILTERS }, (v) => typeof v === 'object' && v !== null);
  stored.value = { ...EMPTY_FILTERS, ...stored.value };

  const here = () => route.name === routeName;
  const show = (filters: ListFilterValues) => {
    const query = queryWithFilters(route.query, filters);
    if (filterPart(query) !== filterPart(route.query)) void router.replace({ query, hash: route.hash });
  };
  watch(
    () => (here() ? filterPart(route.query) : null),
    (part) => {
      if (part === null) return;
      const fromQuery = filtersFromQuery(route.query);
      if (fromQuery && !sameFilters(fromQuery, stored.value)) stored.value = fromQuery;
      // Ungültige Werte fallen aus der Adresse, gemerkte kommen hinein
      show(stored.value);
    },
    { immediate: true },
  );

  return computed({
    get: () => stored.value,
    set: (value) => {
      stored.value = value;
      if (here()) show(value);
    },
  });
}

/** Ansicht der Auswertungen (Störungen, Aufgaben, Alle), im Browser gemerkt; zuerst «Alle». */
export function useReportScope(): Ref<ReportScope> {
  return useStored<ReportScope>('patchwork.reports.scope', 'all', (v) => v === 'incident' || v === 'task' || v === 'all');
}

/** Sortierung einer Liste per Spaltenkopf, pro Ansicht im Browser gemerkt; null = Reihenfolge der Ansicht. */
export function useListSort(key: string): Ref<ListSort | null> {
  return useStored<ListSort | null>(
    `patchwork.sort.${key}`,
    null,
    (v) => v === null || (typeof v === 'object' && typeof (v as ListSort).field === 'string'),
  );
}

/** Nach dem Schliessen eines Vorgangs im Fenster neu laden (Status, Zuständig usw. können sich geändert haben). */
export function useReloadAfterItemModal(reload: () => unknown) {
  const route = useRoute();
  watch(
    () => modalKey(route.query),
    (now, before) => {
      if (before !== null && now === null) void reload();
    },
  );
}

/** Verzögert Änderungen an einem Suchfeld. */
export function useDebounced(source: Ref<string>, ms = 300): Ref<string> {
  const debounced = ref(source.value);
  let timer: number | undefined;
  watch(source, (value) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (debounced.value = value), ms);
  });
  return debounced;
}
