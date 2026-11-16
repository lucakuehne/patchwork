import type { ItemType } from '../db/schema';

/**
 * Auswertung «Typ korrigiert» (Entscheid vom 16.11.2026): Jede Zuweisung eines Typs (beim Erfassen, aus dem Eingang,
 * durch eine Regel oder als Wechsel) zählt für die Person bzw. Regel, die sie vorgenommen hat. Wechselt der Typ danach
 * (Störung ↔ Aufgabe), gilt die Zuweisung als korrigiert, egal wie viel später; die Dauer steht beim Fall.
 * Massgebend sind die Zuweisungen im Zeitraum, die Korrektur darf auch danach liegen.
 */
export interface TypeEvent {
  itemId: string;
  at: Date;
  /** Wer den Typ gesetzt hat, z.B. «Ivan IT» oder «Regel «Lieferant»» */
  by: string;
  to: ItemType;
  /** Wechsel von einem anderen Typ: korrigiert die vorige Zuweisung */
  from: ItemType | null;
}

export interface TypeCorrectionItem {
  prefix: string;
  number: number;
  title: string;
}

export interface TypeCorrectionCase extends TypeCorrectionItem {
  from: ItemType;
  to: ItemType;
  assignedBy: string;
  assignedAt: Date;
  correctedBy: string;
  correctedAt: Date;
}

export interface TypeCorrections {
  /** Zuweisungen im Zeitraum */
  assigned: number;
  /** davon später korrigiert */
  corrected: number;
  /** Je Person bzw. Regel, meiste Korrekturen zuerst */
  byPerson: { name: string; assigned: number; corrected: number }[];
  /** Neueste Korrekturen zuerst, höchstens «limit» */
  cases: TypeCorrectionCase[];
  casesTotal: number;
}

export function typeCorrections(
  events: TypeEvent[],
  items: Map<string, TypeCorrectionItem>,
  period: { from: Date; to: Date },
  limit = 50,
): TypeCorrections {
  const byItem = new Map<string, TypeEvent[]>();
  for (const e of events) {
    const list = byItem.get(e.itemId) ?? [];
    list.push(e);
    byItem.set(e.itemId, list);
  }
  const people = new Map<string, { assigned: number; corrected: number }>();
  const cases: TypeCorrectionCase[] = [];
  let assigned = 0;
  let corrected = 0;
  for (const [itemId, list] of byItem) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    list.forEach((event, i) => {
      if (event.at < period.from || event.at >= period.to) return;
      const person = people.get(event.by) ?? { assigned: 0, corrected: 0 };
      people.set(event.by, person);
      person.assigned++;
      assigned++;
      const next = list[i + 1];
      if (!next || next.from === null || next.to === event.to) return;
      person.corrected++;
      corrected++;
      const item = items.get(itemId);
      if (item) {
        cases.push({ ...item, from: event.to, to: next.to, assignedBy: event.by, assignedAt: event.at, correctedBy: next.by, correctedAt: next.at });
      }
    });
  }
  cases.sort((a, b) => b.correctedAt.getTime() - a.correctedAt.getTime());
  return {
    assigned,
    corrected,
    byPerson: [...people]
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.corrected - a.corrected || b.assigned - a.assigned || a.name.localeCompare(b.name, 'de')),
    cases: cases.slice(0, limit),
    casesTotal: cases.length,
  };
}

/** Typ aus der Beschriftung im Verlauf («Störung», «Aufgabe») */
export function typeFromLabel(label: unknown, labels: Record<ItemType, string>): ItemType | null {
  if (typeof label !== 'string') return null;
  return (Object.keys(labels) as ItemType[]).find((t) => labels[t] === label) ?? null;
}

/** Typ aus dem Eintrag einer Regel («den Typ «Störung» gesetzt (Status «Neu»)») */
export function typeFromRuleChanges(changes: unknown, labels: Record<ItemType, string>): ItemType | null {
  if (!Array.isArray(changes)) return null;
  for (const part of changes) {
    const match = typeof part === 'string' ? /^den Typ «([^»]+)» gesetzt/.exec(part) : null;
    if (match) return typeFromLabel(match[1], labels);
  }
  return null;
}
