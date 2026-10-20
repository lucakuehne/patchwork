import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

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
