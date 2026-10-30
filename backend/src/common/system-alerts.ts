/**
 * Hinweise bei Störungen für Admins (Balken oben, Entscheid vom 26.10.2026): Mail-Abruf seit mindestens 60 Minuten
 * gestört, fehlgeschlagene ausgehende Mails, die weder erneut gesendet noch als erledigt markiert sind, und weniger als
 * 10 % freier Platz auf dem Datenträger der Ablage. Dazu aktive Postfächer, deren Mail-Abruf ausgeschaltet ist
 * (Entscheid vom 30.10.2026); Störungen ihres Abrufs zeigt der Balken nicht, sie wären veraltet.
 */
export const FETCH_ALERT_AFTER_MS = 60 * 60 * 1000;
export const DISK_ALERT_BELOW_PERCENT = 10;

export interface SystemAlerts {
  /** Aktive Postfächer mit ausgeschaltetem Mail-Abruf */
  mailFetchOff: { id: string; name: string }[];
  mailboxes: { id: string; name: string; error: string; since: Date }[];
  failedMails: number;
  disk: { freePercent: number; freeBytes: number; totalBytes: number } | null;
}

export function systemAlerts(
  input: {
    mailboxes: {
      id: string;
      name: string;
      active: boolean;
      fetchEnabled: boolean;
      lastError: string | null;
      errorSince: Date | null;
    }[];
    failedMails: number;
    /** Datenträger der Ablage (statfs), null = unbekannt */
    disk: { freeBytes: number; totalBytes: number } | null;
  },
  now = new Date(),
): SystemAlerts {
  const mailboxes = input.mailboxes
    .filter((m) => m.active && m.fetchEnabled)
    .filter((m) => m.lastError && m.errorSince && now.getTime() - m.errorSince.getTime() >= FETCH_ALERT_AFTER_MS)
    .map((m) => ({ id: m.id, name: m.name, error: m.lastError!, since: m.errorSince! }));
  const freePercent = input.disk && input.disk.totalBytes > 0 ? (input.disk.freeBytes / input.disk.totalBytes) * 100 : null;
  return {
    mailFetchOff: input.mailboxes.filter((m) => m.active && !m.fetchEnabled).map((m) => ({ id: m.id, name: m.name })),
    mailboxes,
    failedMails: input.failedMails,
    disk:
      input.disk && freePercent !== null && freePercent < DISK_ALERT_BELOW_PERCENT
        ? { freePercent: Math.round(freePercent * 10) / 10, ...input.disk }
        : null,
  };
}
