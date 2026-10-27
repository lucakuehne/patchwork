import { z } from 'zod';

/**
 * Einstellungen eines Benutzers (Entscheid vom 27.10.2026): offene Störungen und Aufgaben als Board oder Liste, Vorgänge
 * je Bereich als Seite oder im grossen Fenster öffnen. Gespeichert wird nur, was vom Standard abweicht bzw. gewählt
 * wurde; fehlende Werte ergänzt «withDefaults».
 */
export type ListLayout = 'list' | 'board';
export type OpenMode = 'page' | 'modal';

export interface Preferences {
  layout: { incidents: ListLayout; tasks: ListLayout };
  open: { inbox: OpenMode; incident: OpenMode; task: OpenMode };
}

/** Gespeicherte Fassung (Spalte users.preferences): Teile davon */
export interface StoredPreferences {
  layout?: Partial<Preferences['layout']>;
  open?: Partial<Preferences['open']>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  layout: { incidents: 'list', tasks: 'board' },
  open: { inbox: 'modal', incident: 'modal', task: 'modal' },
};

export function withDefaults(stored: StoredPreferences | null | undefined): Preferences {
  return {
    layout: { ...DEFAULT_PREFERENCES.layout, ...stored?.layout },
    open: { ...DEFAULT_PREFERENCES.open, ...stored?.open },
  };
}

const layout = z.enum(['list', 'board']);
const open = z.enum(['page', 'modal']);

/** Änderung: einzelne Werte, die übrigen bleiben */
export const preferencesPatchSchema = z
  .object({
    layout: z.object({ incidents: layout, tasks: layout }).partial().strict().optional(),
    open: z.object({ inbox: open, incident: open, task: open }).partial().strict().optional(),
  })
  .strict();

export function mergePreferences(stored: StoredPreferences | null | undefined, patch: z.infer<typeof preferencesPatchSchema>): StoredPreferences {
  return {
    layout: { ...stored?.layout, ...patch.layout },
    open: { ...stored?.open, ...patch.open },
  };
}
