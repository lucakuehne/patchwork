import type { ItemType } from '../db/schema';
import {
  BLOCK_TRIGGERS,
  DELIVERY_BLOCKS,
  type DeliveryBlock,
  type DeliveryCircles,
  type DeliveryTrigger,
} from '../settings/settings.service';

type Scopes = Pick<DeliveryCircles, 'staff' | 'others'>;

/** Ein Block im normalen Betrieb: beide Kreise «an alle». */
export const isBlockLive = (circles: Scopes) => circles.staff === 'all' && circles.others === 'all';

/**
 * Kreise für eine Mail eines Auslösers (Vorlage): abweichend je Auslöser für beide Kreise, mit den ausgewählten Personen
 * des Blocks; sonst (auch ohne Vorlage) die Kreise des Blocks.
 */
export function triggerCircles<C extends Scopes & Pick<DeliveryCircles, 'triggers'>>(circles: C, trigger: string | null | undefined): C {
  const scope = trigger ? circles.triggers?.[trigger as DeliveryTrigger] : undefined;
  return scope ? { ...circles, staff: scope, others: scope } : circles;
}

/** Normaler Betrieb: Alle Mails gehen an alle Empfänger, in allen Blöcken und bei jedem Auslöser. */
export const isLive = (settings: Record<DeliveryBlock, Scopes & Pick<DeliveryCircles, 'triggers'>>) =>
  DELIVERY_BLOCKS.every(
    (b) => isBlockLive(settings[b]) && BLOCK_TRIGGERS[b].every((t) => isBlockLive(triggerCircles(settings[b], t))),
  );

/** Block des Testbetriebs für eine Mail: nach dem Typ des Vorgangs, ohne Typ oder ohne Vorgang «general». */
export const deliveryBlock = (type: ItemType | null | undefined): DeliveryBlock => type ?? 'general';

/**
 * Testbetrieb: Darf diese Adresse die Mail erhalten? Massgebend ist der Empfänger, nicht die Art der Mail:
 * IT-Mitarbeitende (Rolle IT oder Admin) und alle übrigen Empfänger haben je einen eigenen Kreis.
 */
export function deliveryFilter(circles: DeliveryCircles, staffAddresses: ReadonlySet<string>): (address: string) => boolean {
  const staffSelected = new Set(circles.staffEmails.map((a) => a.toLowerCase()));
  const othersSelected = new Set(circles.otherEmails.map((a) => a.toLowerCase()));
  return (address) => {
    const a = address.trim().toLowerCase();
    const [scope, selected] = staffAddresses.has(a) ? [circles.staff, staffSelected] : [circles.others, othersSelected];
    return scope === 'all' || (scope === 'selected' && selected.has(a));
  };
}
