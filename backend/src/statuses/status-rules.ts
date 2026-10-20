import type { ItemType } from '../db/schema';

/**
 * Status ohne Kategorien (seit 20.10.2026): Jeder Status ist offen oder abgeschlossen. Pro Typ legen Ziel-Status fest,
 * wohin automatische Wechsel führen (siehe docs/Entscheidungen.md, Abschnitt Status).
 */
export interface StatusLike {
  id: string;
  type: ItemType;
  closed: boolean;
  position: number;
}

/**
 * Ziel-Status je Typ:
 * - start: «Neuer Vorgang erhält» (Pflicht, offen)
 * - reply: «Antwort des Melders führt in» (Pflicht, offen, nicht der Wartet-Status)
 * - close: «Automatisch schliessen in» (Pflicht, abgeschlossen, nicht der Ablehnen-Status), Duplikat und Zeitregel
 * - reject: «Ablehnen führt in» (freiwillig, abgeschlossen); nur über «Ablehnen» erreichbar
 * - waiting: «Wartet auf den Melder» (freiwillig, offen, weder Start noch «nach Antwort»)
 */
export const STATUS_TARGETS = ['start', 'reply', 'close', 'reject', 'waiting'] as const;
export type StatusTarget = (typeof STATUS_TARGETS)[number];
export const REQUIRED_TARGETS: readonly StatusTarget[] = ['start', 'reply', 'close'];

/** Muss der Ziel-Status abgeschlossen (true) oder offen (false) sein? */
export const TARGET_CLOSED: Record<StatusTarget, boolean> = {
  start: false,
  reply: false,
  close: true,
  reject: true,
  waiting: false,
};

export const TARGET_LABELS: Record<StatusTarget, string> = {
  start: 'Neuer Vorgang erhält',
  reply: 'Antwort des Melders führt in',
  close: 'Automatisch schliessen in',
  reject: '«Ablehnen» führt in',
  waiting: 'Wartet auf den Melder',
};

/** Ziel-Status eines Typs (Status-IDs); fehlende freiwillige Ziele sind nicht gesetzt */
export type Targets = Partial<Record<StatusTarget, string>>;
export type TargetsByType = Record<ItemType, Targets>;

/** Farben zur Auswahl für Status (das Frontend kennt die Farbwerte, hell und dunkel) */
export const STATUS_COLORS = ['gray', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'brown'] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

/** Farbe eines neuen Status */
export const defaultColor = (closed: boolean): StatusColor => (closed ? 'green' : 'blue');

export const DEFAULT_STATUSES: {
  type: ItemType;
  key: string;
  label: string;
  closed: boolean;
  position: number;
  color: StatusColor;
  diagramX: number;
  diagramY: number;
}[] = [
  { type: 'incident', key: 'new', label: 'Neu', closed: false, position: 0, color: 'blue', diagramX: 0, diagramY: 0 },
  { type: 'incident', key: 'in_progress', label: 'In Arbeit', closed: false, position: 1, color: 'orange', diagramX: 220, diagramY: 0 },
  { type: 'incident', key: 'waiting', label: 'Wartet auf Melder', closed: false, position: 2, color: 'gray', diagramX: 220, diagramY: 135 },
  { type: 'incident', key: 'resolved', label: 'Gelöst', closed: true, position: 3, color: 'green', diagramX: 440, diagramY: 0 },
  { type: 'task', key: 'backlog', label: 'Backlog', closed: false, position: 0, color: 'blue', diagramX: 0, diagramY: 0 },
  { type: 'task', key: 'planned', label: 'Geplant', closed: false, position: 1, color: 'blue', diagramX: 0, diagramY: 90 },
  { type: 'task', key: 'in_progress', label: 'In Arbeit', closed: false, position: 2, color: 'orange', diagramX: 220, diagramY: 0 },
  { type: 'task', key: 'done', label: 'Erledigt', closed: true, position: 3, color: 'green', diagramX: 440, diagramY: 0 },
  { type: 'task', key: 'rejected', label: 'Abgelehnt', closed: true, position: 4, color: 'red', diagramX: 440, diagramY: 135 },
];

/** Ziel-Status der Standardstatus (über den Schlüssel) */
export const DEFAULT_TARGETS: Record<ItemType, Partial<Record<StatusTarget, string>>> = {
  incident: { start: 'new', reply: 'in_progress', close: 'resolved', waiting: 'waiting' },
  task: { start: 'backlog', reply: 'in_progress', close: 'done', reject: 'rejected' },
};

/**
 * Darf ein Vorgang von Hand von einem Status in einen anderen wechseln? Ist der Ablauf eines Typs nicht eingeschränkt,
 * ist jeder Wechsel erlaubt, sonst nur die festgelegten. Automatische Wechsel prüfen das nicht.
 */
export function transitionAllowed(
  restricted: boolean,
  transitions: { fromId: string; toId: string }[],
  fromId: string | null,
  toId: string,
): boolean {
  if (!restricted || !fromId || fromId === toId) return true;
  return transitions.some((t) => t.fromId === fromId && t.toId === toId);
}

/**
 * Ist «Ablehnen» aus diesem Status möglich? Nur mit Ablehnen-Ziel, nicht aus dem Ablehnen-Status selbst und, bei
 * eingeschränktem Ablauf, nur mit einem Pfeil in den Ablehnen-Status.
 */
export function rejectAllowed(
  restricted: boolean,
  transitions: { fromId: string; toId: string }[],
  rejectId: string | undefined,
  currentId: string | null,
): boolean {
  if (!rejectId || currentId === rejectId) return false;
  return transitionAllowed(restricted, transitions, currentId, rejectId);
}

/** Welche Ziele zeigen auf diesen Status? */
export function targetsOf(targets: Targets, statusId: string): StatusTarget[] {
  return STATUS_TARGETS.filter((t) => targets[t] === statusId);
}

/**
 * Prüft die Ziele eines Typs: Pflicht-Ziele gesetzt, alle Ziele Status dieses Typs mit passendem «abgeschlossen»,
 * «nach Antwort» ≠ Wartet, Start ≠ Wartet, Schliessen ≠ Ablehnen. Gibt eine Fehlermeldung zurück oder null.
 */
export function targetsProblem(all: readonly StatusLike[], type: ItemType, targets: Targets, labelOf?: (id: string) => string): string | null {
  const name = (id: string) => (labelOf ? `«${labelOf(id)}»` : 'Der Status');
  for (const target of REQUIRED_TARGETS) {
    if (!targets[target]) return `«${TARGET_LABELS[target]}» fehlt`;
  }
  for (const target of STATUS_TARGETS) {
    const id = targets[target];
    if (!id) continue;
    const status = all.find((s) => s.id === id);
    if (!status || status.type !== type) return `«${TARGET_LABELS[target]}»: Der Status gehört nicht zu diesem Typ`;
    if (status.closed !== TARGET_CLOSED[target]) {
      return `«${TARGET_LABELS[target]}»: ${name(id)} muss ${TARGET_CLOSED[target] ? 'abgeschlossen' : 'offen'} sein`;
    }
  }
  if (targets.waiting && targets.waiting === targets.reply) {
    return '«Antwort des Melders führt in» darf nicht der Status «Wartet auf den Melder» sein';
  }
  if (targets.waiting && targets.waiting === targets.start) {
    return '«Wartet auf den Melder» darf nicht der Status für neue Vorgänge sein';
  }
  if (targets.reject && targets.reject === targets.close) {
    return '«Automatisch schliessen in» und «Ablehnen führt in» müssen verschiedene Status sein';
  }
  return null;
}

/** Öffnet eine Antwort des Melders den Vorgang wieder? Aus dem Wartet-Status und aus Abgeschlossenem ausser Ablehnen. */
export function reopensOnReply(targets: Targets, status: { id: string; closed: boolean }): boolean {
  if (status.id === targets.waiting) return true;
  return status.closed && status.id !== targets.reject;
}

/**
 * Wechsel von Hand, der einen Vorgang erledigt (Mail «Erledigt», Rückfrage bei offenen Checklisten-Punkten, «Behebt»):
 * in einen abgeschlossenen Status ausser Ablehnen, aus einem offenen Status oder aus dem Ablehnen-Status.
 */
export function isCompleting(targets: Targets, from: { id: string; closed: boolean } | null | undefined, to: { id: string; closed: boolean }): boolean {
  if (!to.closed || to.id === targets.reject) return false;
  return !from || !from.closed || from.id === targets.reject;
}

/**
 * Vorschlag für den Status nach einem Typwechsel, nach der Rolle des bisherigen Status: Start → Start, Wartet → Wartet
 * (sonst «nach Antwort»), übrige offene → «nach Antwort», Ablehnen → Ablehnen (sonst Schliessen), übrige abgeschlossene
 * → Schliessen. Ohne bisherigen Status (Eingang): Start.
 */
export function suggestTypeChangeStatus(
  targets: TargetsByType,
  current: { id: string; type: ItemType; closed: boolean } | null,
  targetType: ItemType,
): string {
  const to = targets[targetType];
  if (!current) return to.start!;
  const from = targets[current.type];
  if (current.id === from.start) return to.start!;
  if (current.id === from.waiting) return to.waiting ?? to.reply!;
  if (current.id === from.reject) return to.reject ?? to.close!;
  return current.closed ? to.close! : to.reply!;
}
