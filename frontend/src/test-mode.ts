import type { DeliveryBlock, DeliveryCircles, DeliveryScope, DeliveryScopes, DeliveryTrigger, ItemType } from './types';

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

/** Auslöser mit den Namen der E-Mail-Vorlagen, nach Empfänger gruppiert wie dort */
export const DELIVERY_TRIGGERS: { value: DeliveryTrigger; label: string; group: 'reporter' | 'staff' }[] = [
  { value: 'confirmation', label: 'Eingangsbestätigung', group: 'reporter' },
  { value: 'reply', label: 'Öffentliche Antwort', group: 'reporter' },
  { value: 'done', label: 'Abgeschlossen', group: 'reporter' },
  { value: 'rejected', label: 'Abgelehnt', group: 'reporter' },
  { value: 'duplicateMerged', label: 'Duplikat: ins Original übernommen', group: 'reporter' },
  { value: 'duplicateRedirected', label: 'Duplikat: im Original weiterbearbeitet', group: 'reporter' },
  { value: 'waitingReminder', label: 'Erinnerung', group: 'reporter' },
  { value: 'waitingClosed', label: 'Automatisch geschlossen', group: 'reporter' },
  { value: 'assigned', label: 'Zugewiesen', group: 'staff' },
  { value: 'inboundReply', label: 'Neue Antwort', group: 'staff' },
  { value: 'fixCompleted', label: 'Behebender Vorgang erledigt', group: 'staff' },
  { value: 'mentioned', label: 'Erwähnt', group: 'staff' },
  { value: 'dueReminder', label: 'Fällig', group: 'staff' },
  { value: 'welcome', label: 'Willkommen', group: 'staff' },
];

/**
 * Auslöser, die im Block vorkommen (wie im Backend): Abschliessen, Ablehnen und Erinnerungen brauchen einen Typ,
 * «Fällig» gibt es nur bei Aufgaben, «Willkommen» nur ohne Vorgang.
 */
const NOT_IN: Partial<Record<DeliveryTrigger, DeliveryBlock[]>> = {
  done: ['general'],
  rejected: ['general'],
  waitingReminder: ['general'],
  waitingClosed: ['general'],
  dueReminder: ['general', 'incident'],
  welcome: ['incident', 'task'],
};
export const blockTriggers = (block: DeliveryBlock) => DELIVERY_TRIGGERS.filter((t) => !NOT_IN[t.value]?.includes(block));

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

const TRIGGER_SCOPE: Record<DeliveryScope, string> = { none: 'an niemanden', selected: 'nur an ausgewählte', all: 'an alle' };

type BlockSettings = DeliveryScopes & Partial<Pick<DeliveryCircles, 'triggers'>>;

/** Auslöser, die tatsächlich vom Block abweichen, z.B. «Eingangsbestätigung an niemanden» */
function exceptions(block: DeliveryBlock, c: BlockSettings): string[] {
  return blockTriggers(block).flatMap((t) => {
    const scope = c.triggers?.[t.value];
    return scope && !(c.staff === scope && c.others === scope) ? [`${t.label} ${TRIGGER_SCOPE[scope]}`] : [];
  });
}

/** Wer in einem Block Mails erhält, mit den abweichenden Auslösern */
export function blockText(block: DeliveryBlock, c: BlockSettings): string {
  const differing = exceptions(block, c);
  return differing.length ? `${circlesText(c)}, abweichend ${differing.join(', ')}` : circlesText(c);
}

/**
 * Satz zum Testbetrieb, z.B. für die Übersicht unter Verwaltung → Ausgehende Mails; null im normalen Betrieb. Sind alle
 * Blöcke gleich eingestellt und weicht kein Auslöser ab, ein Satz für alle, sonst je Block.
 */
export function testModeText(delivery: Record<DeliveryBlock, BlockSettings> | undefined): string | null {
  if (!delivery) return null;
  const differing = DELIVERY_BLOCKS.some((b) => exceptions(b.value, delivery[b.value]).length > 0);
  if (!differing && DELIVERY_BLOCKS.every((b) => isBlockLive(delivery[b.value]))) return null;
  const texts = DELIVERY_BLOCKS.map((b) => blockText(b.value, delivery[b.value]));
  if (!differing && texts.every((t) => t === texts[0])) {
    const to = receivers(delivery.general);
    return to ? `Es werden nur Mails an ${to} versendet, die übrigen nicht.` : 'Es werden keine Mails versendet.';
  }
  return DELIVERY_BLOCKS.map((b, i) => `${b.label}: ${texts[i]}.`).join(' ');
}
