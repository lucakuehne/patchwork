import { BadRequestException } from '@nestjs/common';
import type { ItemType } from '../db/schema';
import { suggestTypeChangeStatus, type StatusLike, type Targets, type TargetsByType } from '../statuses/status-rules';

// Status eines Vorgangs beim Erfassen, bei Wechseln von Hand und beim Typwechsel (siehe docs/Entscheidungen.md,
// Abschnitt Status). Der Ablehnen-Status ist nur über «Ablehnen» erreichbar, nicht über Status-Feld, Board oder
// Neu-Dialog.

type NamedStatus = StatusLike & { label: string };

/**
 * Abschlussdatum nach einem Statuswechsel: Ein abgeschlossener Status setzt es. Bei einem Wechsel zwischen zwei
 * abgeschlossenen Status bleibt der bisherige Zeitpunkt, ein offener Status löscht es.
 */
export function closedAtAfter(
  closedAt: Date | null,
  current: { closed: boolean } | undefined,
  target: { closed: boolean },
  now = new Date(),
): Date | null {
  if (!target.closed) return null;
  return current?.closed && closedAt ? closedAt : now;
}

/** Status eines intern erfassten Vorgangs: der gewählte (nicht der Ablehnen-Status) oder «Neuer Vorgang erhält». */
export function newItemStatus<S extends NamedStatus>(
  all: readonly S[],
  targets: Targets,
  type: ItemType,
  statusId?: string | null,
): S {
  const status = all.find((s) => s.id === (statusId ?? targets.start) && s.type === type);
  if (!status) {
    throw new BadRequestException(statusId ? 'Der Status passt nicht zum Typ' : 'Für diesen Typ fehlt der Status für neue Vorgänge');
  }
  if (status.id === targets.reject) throw new BadRequestException('Ein neuer Vorgang kann nicht abgelehnt sein');
  return status;
}

/** Ziel eines Wechsels von Hand (Status-Feld, Board): ein Status des Typs ausser dem Ablehnen-Status. */
export function moveTarget<S extends NamedStatus>(all: readonly S[], targets: Targets, type: ItemType, statusId: string): S {
  const target = all.find((s) => s.id === statusId);
  if (!target || target.type !== type) throw new BadRequestException('Der Status passt nicht zum Typ');
  if (target.id === targets.reject) throw new BadRequestException('Zum Ablehnen bitte «Ablehnen» verwenden');
  return target;
}

/**
 * Status nach einem Typwechsel: der gewählte Status des neuen Typs oder, ohne Wahl, der Vorschlag nach der Rolle des
 * bisherigen Status (aus dem Eingang: «Neuer Vorgang erhält»). Den Ablehnen-Status des neuen Typs gibt es nur, wenn
 * der Vorgang im Ablehnen-Status seines bisherigen Typs steht.
 */
export function typeChangeStatus<S extends NamedStatus>(
  all: readonly S[],
  targets: TargetsByType,
  current: S | undefined,
  type: ItemType,
  statusId?: string | null,
): S {
  const id = statusId ?? suggestTypeChangeStatus(targets, current ?? null, type);
  const status = all.find((s) => s.id === id && s.type === type);
  if (!status) {
    throw new BadRequestException(statusId ? 'Der Status passt nicht zum Typ' : 'Für diesen Typ fehlt ein Ziel-Status');
  }
  const fromReject = !!current && current.id === targets[current.type].reject;
  if (status.id === targets[type].reject && !fromReject) {
    throw new BadRequestException(`«${status.label}» ist nur über «Ablehnen» erreichbar`);
  }
  return status;
}
