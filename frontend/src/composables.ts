import { ref, watch, type Ref } from 'vue';

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
