import { SetMetadata } from '@nestjs/common';
import type { AuditArea } from '../db/schema';

export const AUDIT = 'audit';

/** Objekt eines Eintrags über die ID in der Adresse («:id», bei E-Mail-Vorlagen «:key») */
export type AuditTarget =
  | 'entry'
  | 'checklist'
  | 'checklistItem'
  | 'checklistTemplate'
  | 'user'
  | 'status'
  | 'channel'
  | 'rule'
  | 'snippet'
  | 'mailbox'
  | 'recurringTask'
  | 'outgoingMail'
  | 'incomingMail'
  | 'mailTemplate';

/** Objekt, vor der Aktion gelesen (beim Löschen ist es danach weg) */
export interface ResolvedTarget {
  label: string;
  itemId: string | null;
  /** Status des Vorgangs vor der Aktion (Verschieben im Board: Statuswechsel oder nur Reihenfolge) */
  statusId?: string | null;
}

export interface AuditContext {
  body: Record<string, unknown>;
  params: Record<string, string>;
  result: unknown;
  before: ResolvedTarget | null;
}

export interface AuditSpec {
  area: AuditArea;
  /** Text der Aktion; als Funktion z.B. je nach Feldern der Anfrage, null = kein Eintrag */
  action: string | ((ctx: AuditContext) => string | null);
  /** Objekt über die ID in der Adresse; ohne Angabe der Vorgang aus «:ref», sonst keines */
  target?: AuditTarget;
  /** Objekt aus der Antwort (neu erstellt): Vorgang (Präfix und Nummer) oder Name bzw. Bezeichnung */
  fromResult?: boolean;
}

/**
 * Schreibende Route ins Aktionsprotokoll (Verwaltung → Aktionsprotokoll), sobald sie ohne Fehler durchgelaufen ist.
 * Jede schreibende Route trägt @Audit oder @NoAudit (geprüft in audit-coverage.spec.ts).
 */
export const Audit = (area: AuditArea, action: AuditSpec['action'], options: Pick<AuditSpec, 'target' | 'fromResult'> = {}) =>
  SetMetadata(AUDIT, { area, action, ...options } satisfies AuditSpec);

/** Schreibende Route ohne Eintrag: Vorschau, Test, Upload vor dem Speichern oder selbst protokolliert (Anmeldung) */
export const NoAudit = () => SetMetadata(AUDIT, false);
