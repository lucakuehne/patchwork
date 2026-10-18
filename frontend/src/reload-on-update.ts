import type { Router } from 'vue-router';

const STORAGE_KEY = 'pw-update-reload';

/**
 * Nach einem Update fehlen die Dateien der alten Version. Ein noch offener Tab kann nachgeladene
 * Seitenteile dann nicht mehr laden («Failed to fetch dynamically imported module»). Statt eines
 * Fehlers wird die Seite einmal neu geladen, bei einem Seitenwechsel direkt mit dem Ziel.
 */
export function reloadOnUpdate(router: Router) {
  let target: string | null = null;
  router.beforeEach((to) => {
    target = to.fullPath;
  });
  router.afterEach(() => {
    target = null;
  });

  window.addEventListener('vite:preloadError', () => {
    // Höchstens einmal innert 10 Sekunden, damit ein echter Fehler nicht zu einer Endlosschleife führt
    try {
      if (Date.now() - Number(sessionStorage.getItem(STORAGE_KEY) ?? 0) < 10_000) return;
      sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      return;
    }
    if (target) window.location.assign(target);
    else window.location.reload();
  });
}
