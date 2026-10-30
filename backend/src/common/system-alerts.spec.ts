import { describe, expect, it } from 'vitest';
import { systemAlerts } from './system-alerts';

const now = new Date('2026-10-26T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const box = (fields: Partial<Parameters<typeof systemAlerts>[0]['mailboxes'][number]>) => ({
  id: 'm1',
  name: 'IT Helpdesk',
  active: true,
  fetchEnabled: true,
  lastError: 'Verbindung abgelehnt',
  errorSince: minutesAgo(61),
  ...fields,
});

describe('Hinweise bei Störungen', () => {
  it('Mail-Abruf erst nach 60 Minuten ohne Unterbruch, nur aktive Postfächer', () => {
    const alerts = systemAlerts(
      {
        mailboxes: [
          box({}),
          box({ id: 'm2', errorSince: minutesAgo(59) }),
          box({ id: 'm3', active: false }),
          box({ id: 'm4', lastError: null, errorSince: null }),
        ],
        failedMails: 0,
        disk: null,
      },
      now,
    );
    expect(alerts.mailboxes.map((m) => m.id)).toEqual(['m1']);
    expect(alerts.mailboxes[0]).toMatchObject({ error: 'Verbindung abgelehnt', since: minutesAgo(61) });
    expect(alerts.mailFetchOff).toEqual([]);
  });

  it('Speicherplatz unter 10 % frei', () => {
    const disk = (free: number) => systemAlerts({ mailboxes: [], failedMails: 0, disk: { freeBytes: free, totalBytes: 1000 } }, now).disk;
    expect(disk(99)).toEqual({ freePercent: 9.9, freeBytes: 99, totalBytes: 1000 });
    expect(disk(100)).toBeNull();
    expect(systemAlerts({ mailboxes: [], failedMails: 3, disk: null }, now)).toEqual({ mailFetchOff: [], mailboxes: [], failedMails: 3, disk: null });
  });

  it('Mail-Abruf eines Postfachs ausgeschaltet: Hinweis statt Störung, nur aktive Postfächer', () => {
    const alerts = systemAlerts(
      {
        mailboxes: [box({ fetchEnabled: false }), box({ id: 'm2', name: 'Archiv', active: false, fetchEnabled: false }), box({ id: 'm3', name: 'Einkauf' })],
        failedMails: 0,
        disk: null,
      },
      now,
    );
    expect(alerts.mailFetchOff).toEqual([{ id: 'm1', name: 'IT Helpdesk' }]);
    expect(alerts.mailboxes.map((m) => m.id)).toEqual(['m3']);
  });
});
