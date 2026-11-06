import type { ItemType, Priority } from '../db/schema';

/** Namen für Priorität und Typ in Verlauf, Auswertungen, Regeln und Mails */
export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
export const TYPE_LABELS: Record<ItemType, string> = { incident: 'Störung', task: 'Aufgabe' };
