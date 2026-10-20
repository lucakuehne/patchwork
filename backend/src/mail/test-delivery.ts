import type { MailSettings } from '../settings/settings.service';

/** Normaler Betrieb: Alle Mails gehen an alle Empfänger. */
export const isLive = (settings: Pick<MailSettings, 'staff' | 'others'>) => settings.staff === 'all' && settings.others === 'all';

/**
 * Testbetrieb: Darf diese Adresse die Mail erhalten? Massgebend ist der Empfänger, nicht die Art der Mail:
 * IT-Mitarbeitende (Rolle IT oder Admin) und alle übrigen Empfänger haben je einen eigenen Kreis.
 */
export function deliveryFilter(settings: MailSettings, staffAddresses: ReadonlySet<string>): (address: string) => boolean {
  const staffSelected = new Set(settings.staffEmails.map((a) => a.toLowerCase()));
  const othersSelected = new Set(settings.otherEmails.map((a) => a.toLowerCase()));
  return (address) => {
    const a = address.trim().toLowerCase();
    const [scope, selected] = staffAddresses.has(a) ? [settings.staff, staffSelected] : [settings.others, othersSelected];
    return scope === 'all' || (scope === 'selected' && selected.has(a));
  };
}
