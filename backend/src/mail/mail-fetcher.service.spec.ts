import { describe, expect, it, vi } from 'vitest';
import type { Mailbox } from '../db/schema';
import { MailFetcherService } from './mail-fetcher.service';

const START = new Date('2026-10-20T08:00:00Z');
const hours = (h: number) => new Date(START.getTime() + h * 3600 * 1000);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Nachgebauter IMAP-Ordner: Mails mit UID, Eingang und Gelesen-Status, UIDVALIDITY wie vom Server gemeldet. */
function imapFolder(uidValidity: number) {
  const mails: { uid: number; received: Date; seen: boolean }[] = [];
  const lockOptions: unknown[] = [];
  let flagChanges = 0;
  const client = {
    mailbox: undefined as { uidValidity: bigint; uidNext: number } | undefined,
    connect: async () => {},
    getMailboxLock: async (_path: string, options?: unknown) => {
      lockOptions.push(options);
      client.mailbox = { uidValidity: BigInt(uidValidity), uidNext: (mails.at(-1)?.uid ?? 0) + 1 };
      return { release: () => {} };
    },
    // Wie bei IMAP vergleicht SINCE nur das Datum, nicht die Uhrzeit
    fetch: async function* (range: { since: Date }) {
      for (const m of mails) if (day(m.received) >= day(range.since)) yield { uid: m.uid, internalDate: m.received };
    },
    search: async (query: { uid: string }) => {
      const from = Number(query.uid.split(':')[0]);
      const uids = mails.filter((m) => m.uid >= from).map((m) => m.uid);
      // Wie bei IMAP: «n:*» liefert immer mindestens die neueste Mail
      return uids.length > 0 || mails.length === 0 ? uids : [mails.at(-1)!.uid];
    },
    fetchOne: async (uid: string) => ({ source: Buffer.from(uid) }),
    messageFlagsAdd: async () => {
      flagChanges++;
    },
    logout: async () => {},
    close: () => {},
  };
  return { mails, client, lockOptions, flagChanges: () => flagChanges };
}

function setup(serverUidValidity = 7) {
  const folder = imapFolder(serverUidValidity);
  const state = { uidValidity: null as number | null, lastUid: 0, lastError: null as string | null };
  const mailboxes = {
    recordPoll: async (_id: string, s: { uidValidity?: number | null; lastUid?: number; error: string | null }) => {
      if (s.uidValidity !== undefined) state.uidValidity = s.uidValidity;
      if (s.lastUid !== undefined) state.lastUid = s.lastUid;
      state.lastError = s.error;
    },
  };
  const transport = { imapClient: async () => folder.client };
  const unused = undefined as never;
  const fetcher = new MailFetcherService(
    unused,
    unused,
    mailboxes as never,
    transport as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
  );
  const ingested: number[] = [];
  vi.spyOn(fetcher, 'ingest').mockImplementation(async (_mailbox, raw) => {
    ingested.push(Number(raw.toString()));
    return 'created';
  });
  const poll = () =>
    fetcher.poll({
      id: 'm1',
      address: 'it@firma.ch',
      imapFolder: 'INBOX',
      active: true,
      fetchFrom: START,
      uidValidity: state.uidValidity,
      lastUid: state.lastUid,
    } as unknown as Mailbox);
  return { folder, state, ingested, poll };
}

describe('Mail-Abruf', () => {
  it('öffnet den Ordner nur lesend und markiert nichts als gelesen', async () => {
    const t = setup();
    t.folder.mails.push({ uid: 1, received: hours(1), seen: false }, { uid: 2, received: hours(2), seen: false });
    await t.poll();
    expect(t.folder.lockOptions).toEqual([{ readOnly: true }]);
    expect(t.folder.flagChanges()).toBe(0);
    expect(t.ingested).toEqual([1, 2]);
    expect(t.state).toEqual({ uidValidity: 7, lastUid: 2, lastError: null });
  });

  it('übernimmt beim ersten Abruf alle Mails ab dem Startzeitpunkt, gelesen oder nicht, auch über mehrere Durchgänge', async () => {
    const t = setup();
    // 1–20: Tage vorher, 21–30: am selben Tag kurz vor dem Start, 31–130: danach (jede zweite gelesen)
    for (let uid = 1; uid <= 20; uid++) t.folder.mails.push({ uid, received: hours(-72), seen: false });
    for (let uid = 21; uid <= 30; uid++) t.folder.mails.push({ uid, received: hours(-1), seen: false });
    for (let uid = 31; uid <= 130; uid++) t.folder.mails.push({ uid, received: hours(uid / 100), seen: uid % 2 === 0 });
    await t.poll();
    expect(t.ingested).toEqual(Array.from({ length: 50 }, (_, i) => 31 + i));
    expect(t.state).toEqual({ uidValidity: null, lastUid: 80, lastError: null });
    await t.poll();
    expect(t.ingested).toEqual(Array.from({ length: 100 }, (_, i) => 31 + i));
    expect(t.state).toEqual({ uidValidity: 7, lastUid: 130, lastError: null });
    expect(t.folder.flagChanges()).toBe(0);
  });

  it('holt danach alle neuen Mails, auch bereits gelesene', async () => {
    const t = setup();
    t.folder.mails.push({ uid: 1, received: hours(-1), seen: false }, { uid: 2, received: hours(1), seen: true });
    await t.poll();
    expect(t.ingested).toEqual([2]);
    t.folder.mails.push({ uid: 3, received: hours(2), seen: true }, { uid: 4, received: hours(3), seen: false });
    await t.poll();
    expect(t.ingested).toEqual([2, 3, 4]);
    // Nichts Neues: «5:*» liefert die Mail 4, die nicht nochmals übernommen wird
    await t.poll();
    expect(t.ingested).toEqual([2, 3, 4]);
    expect(t.state).toEqual({ uidValidity: 7, lastUid: 4, lastError: null });
  });

  it('beginnt bei neuer UIDVALIDITY wieder ab dem Startzeitpunkt', async () => {
    const t = setup(8);
    Object.assign(t.state, { uidValidity: 7, lastUid: 500 });
    t.folder.mails.push({ uid: 1, received: hours(-1), seen: false }, { uid: 2, received: hours(1), seen: true });
    await t.poll();
    expect(t.ingested).toEqual([2]);
    expect(t.state).toEqual({ uidValidity: 8, lastUid: 2, lastError: null });
  });
});
