import type { DeliveryBlock, DeliveryScope, DeliveryScopes, ItemType } from './types';

const STAFF: Record<Exclude<DeliveryScope, 'none'>, string> = {
  all: 'IT-Mitarbeitende',
  selected: 'ausgewählte IT-Mitarbeitende',
};
const OTHERS: Record<Exclude<DeliveryScope, 'none'>, string> = {
  all: 'Melder und Beteiligte',
  selected: 'ausgewählte Melder und Beteiligte',
};

/** Blöcke des Testbetriebs in der Reihenfolge der Einstellungen */
export const DELIVERY_BLOCKS: { value: DeliveryBlock; label: string; hint: string }[] = [
  { value: 'general', label: 'Generell', hint: 'Mails zu Vorgängen im Eingang (ohne Typ) und Mails ohne Vorgang (Willkommen)' },
  { value: 'incident', label: 'Störungen', hint: 'Mails zu Störungen' },
  { value: 'task', label: 'Aufgaben', hint: 'Mails zu Aufgaben' },
];

/** Block für einen Vorgang: nach seinem Typ, ohne Typ (Eingang) «Generell» */
export const deliveryBlock = (type: ItemType | null): DeliveryBlock => type ?? 'general';

export const isBlockLive = (c: DeliveryScopes) => c.staff === 'all' && c.others === 'all';

/** Freigegebene Empfänger eines Blocks im Testbetrieb, z.B. «ausgewählte IT-Mitarbeitende und an Melder …» */
function receivers(c: DeliveryScopes): string {
  return [c.staff !== 'none' ? STAFF[c.staff] : null, c.others !== 'none' ? OTHERS[c.others] : null]
    .filter((p): p is string => !!p)
    .join(' und an ');
}

/** Wer in einem Block Mails erhält, kurz: «alle Mails», «keine Mails» oder «nur an …» */
export function circlesText(c: DeliveryScopes): string {
  if (isBlockLive(c)) return 'alle Mails';
  const to = receivers(c);
  return to ? `nur an ${to}` : 'keine Mails';
}

/**
 * Satz zum Testbetrieb, z.B. für den Hinweis oben; null im normalen Betrieb. Sind alle Blöcke gleich eingestellt, ein
 * Satz für alle, sonst je Block.
 */
export function testModeText(delivery: Record<DeliveryBlock, DeliveryScopes> | undefined): string | null {
  if (!delivery || DELIVERY_BLOCKS.every((b) => isBlockLive(delivery[b.value]))) return null;
  const texts = DELIVERY_BLOCKS.map((b) => circlesText(delivery[b.value]));
  if (texts.every((t) => t === texts[0])) {
    const to = receivers(delivery.general);
    return to ? `Es werden nur Mails an ${to} versendet, die übrigen nicht.` : 'Es werden keine Mails versendet.';
  }
  return DELIVERY_BLOCKS.map((b, i) => `${b.label}: ${texts[i]}.`).join(' ');
}
