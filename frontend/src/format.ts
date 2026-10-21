import type { ItemType, Priority, Role } from './types';

export const NUMBER_PREFIX = 'PW';
export const itemRef = (n: number) => `${NUMBER_PREFIX}-${n}`;

export const TYPE_LABELS: Record<ItemType, string> = { incident: 'Störung', task: 'Aufgabe' };
export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', it: 'IT', standard: 'Standard' };

const dateFmt = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '–');
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '–');

/** Datum ohne Uhrzeit (JJJJ-MM-TT, z.B. Fälligkeit) als TT.MM.JJJJ, ohne Umweg über Zeitzonen */
export const formatDay = (value: string) => value.split('-').reverse().join('.');

/** Heutiges Datum (lokal) als JJJJ-MM-TT */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Fälligkeit gegenüber heute: überfällig (rot), heute (orange) oder später. Abgeschlossene Aufgaben ohne Farbe
 * («done»), ohne Datum null.
 */
export function dueState(dueDate: string | null, closed: boolean, day = today()): 'overdue' | 'today' | 'later' | 'done' | null {
  if (!dueDate) return null;
  if (closed) return 'done';
  if (dueDate < day) return 'overdue';
  return dueDate === day ? 'today' : 'later';
}

/**
 * Markdown als kurzer Text für Vorschauen (z.B. Beschreibung auf der Board-Karte): ohne Formatierung, Links mit ihrem
 * Text, Erwähnungen als «@Name», Bilder als «[Bild: Name]», gekürzt mit «…».
 */
export function plainPreview(markdown: string, max = 240): string {
  const text = markdown
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, (_all, alt: string) => (alt ? `[Bild: ${alt}]` : '[Bild]'))
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/(?<!\\)(?:\*\*|__|~~|`|\*)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;
}

/** Kurzes Alter, z.B. «5 Min.», «3 Std.», «2 Tage». */
export function formatAge(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} Std.`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 Tag' : `${days} Tage`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
