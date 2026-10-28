import { ref } from 'vue';
import type { Theme } from './types';

/**
 * Farbschema (Entscheid vom 28.10.2026): «auto» folgt Windows bzw. dem Browser. Am <html> steht das wirksame Schema als
 * data-theme «light» oder «dark» (Farben in styles.css). Die Wahl gehört zum Konto (Einstellungen); dieser Browser merkt
 * sie sich zusätzlich, damit Start und Anmeldeseite gleich im richtigen Schema erscheinen (Skript in index.html, gleicher
 * Schlüssel).
 */
export const THEME_KEY = 'patchwork.theme';

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Automatisch' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
];

export const isTheme = (value: unknown): value is Theme => value === 'auto' || value === 'light' || value === 'dark';

/** Wirksames Schema aus der Wahl und der Einstellung des Systems */
export const resolveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' =>
  theme === 'dark' || (theme === 'auto' && systemDark) ? 'dark' : 'light';

/** Ist gerade das dunkle Schema wirksam? (z.B. für Diagramme, die ihre Farben beim Zeichnen lesen) */
export const darkActive = ref(false);

let chosen: Theme = 'auto';
let media: MediaQueryList | null = null;

function update() {
  const effective = resolveTheme(chosen, media?.matches ?? false);
  document.documentElement.dataset.theme = effective;
  darkActive.value = effective === 'dark';
}

/** Beim Start: die in diesem Browser gemerkte Wahl, danach Wechsel des Systems verfolgen */
export function startTheme() {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null');
    if (isTheme(stored)) chosen = stored;
  } catch {
    // Speicher nicht verfügbar oder ungültig
  }
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  update();
}

/** Wahl aus dem Konto übernehmen und in diesem Browser merken */
export function applyTheme(theme: Theme) {
  chosen = theme;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  } catch {
    // ignorieren
  }
  update();
}
