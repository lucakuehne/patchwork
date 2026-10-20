import type { DeliveryScope } from './types';

const STAFF: Record<Exclude<DeliveryScope, 'none'>, string> = {
  all: 'IT-Mitarbeitende',
  selected: 'ausgewählte IT-Mitarbeitende',
};
const OTHERS: Record<Exclude<DeliveryScope, 'none'>, string> = {
  all: 'Melder und Beteiligte',
  selected: 'ausgewählte Melder und Beteiligte',
};

/** Satz zum Testbetrieb, z.B. für den Hinweis oben; null im normalen Betrieb. */
export function testModeText(delivery: { staff: DeliveryScope; others: DeliveryScope } | undefined): string | null {
  if (!delivery || (delivery.staff === 'all' && delivery.others === 'all')) return null;
  const parts = [
    delivery.staff !== 'none' ? STAFF[delivery.staff] : null,
    delivery.others !== 'none' ? OTHERS[delivery.others] : null,
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return 'Es werden keine Mails versendet.';
  return `Es werden nur Mails an ${parts.join(' und an ')} versendet, die übrigen nicht.`;
}
