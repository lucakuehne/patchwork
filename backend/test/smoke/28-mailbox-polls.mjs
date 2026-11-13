// Smoke-Test, Bereich «Abrufprotokoll der Postfächer» (läuft über test/smoke.mjs, Entscheid vom 13.11.2026)
import { api, assert, IVAN, loginAs, poll, RUN, sendMail, sleep, state, step } from './lib.mjs';

const { mailboxId } = state;
const ADA = 'ada@test.local';
const NONE = { created: 0, appended: 0, ignored: 0, duplicate: 0, failed: 0 };
const polls = (id, query = '') => api('GET', `/admin/mailboxes/${id}/polls${query}`);
const imapBox = (address, imapPort) => ({
  name: `Abruf ${address}`,
  address,
  active: true,
  isDefault: false,
  imapHost: 'localhost',
  imapPort,
  imapSecure: false,
  imapFolder: 'INBOX',
  smtpHost: 'localhost',
  smtpPort: 13025,
  smtpSecurity: 'none',
  authType: 'password',
  username: address,
  password: 'x',
});

/** Job von pg-boss direkt in die Queue (im Test-Stack läuft der Abruf nicht automatisch) */
async function sendJob(queue) {
  const { default: PgBoss } = await import('pg-boss');
  const boss = new PgBoss({ connectionString: process.env.SMOKE_DATABASE_URL, schema: 'pgboss', supervise: false, schedule: false, migrate: false });
  await boss.start();
  try {
    await boss.send(queue, {});
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
}

async function waitFor(check, what, seconds = 30) {
  for (let i = 0; i < seconds; i++) {
    const result = await check();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error(`${what}: nicht innerhalb von ${seconds} Sekunden`);
}

await step('Abrufprotokoll: «Jetzt abrufen» mit Mails nach Ergebnis, weiterblättern, nur für Admins', async () => {
  await loginAs(ADA, 'geheim-geheim');
  await sendMail({ from: `abruf-${RUN}@test.local`, subject: `Abrufprotokoll ${RUN}`, text: 'Hallo' });
  await sleep(500);
  await poll();
  const [withMail] = (await polls(mailboxId, '?limit=5')).entries;
  assert.equal(withMail.triggeredBy, 'Ada Admin');
  assert.equal(withMail.polls, 1);
  assert.equal(withMail.error, null);
  assert.ok(withMail.mails.created >= 1, `neuer Vorgang gezählt: ${JSON.stringify(withMail.mails)}`);
  assert.ok(withMail.durationMs >= 0);
  assert.ok(new Date(withMail.endedAt) >= new Date(withMail.startedAt));

  // Von Hand ohne neue Mails: eigene Zeile, nicht zusammengefasst
  await poll();
  const [quiet, previous] = (await polls(mailboxId, '?limit=5')).entries;
  assert.deepEqual([quiet.polls, quiet.mails, quiet.triggeredBy], [1, NONE, 'Ada Admin']);
  assert.equal(previous.id, withMail.id);

  // Weiterblättern ab der letzten geladenen Zeile
  const first = await polls(mailboxId, '?limit=1');
  assert.deepEqual([first.entries.length, first.more], [1, true]);
  const next = await polls(mailboxId, `?limit=1&before=${encodeURIComponent(first.entries[0].startedAt)}`);
  assert.equal(next.entries[0].id, withMail.id);

  await api('GET', `/admin/mailboxes/${mailboxId}/polls?limit=0`, undefined, { expect: [400] });
  await api('GET', `/admin/mailboxes/${mailboxId}/polls?before=gestern`, undefined, { expect: [400] });
  await api('GET', `/admin/mailboxes/${crypto.randomUUID()}/polls`, undefined, { expect: [404] });
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', `/admin/mailboxes/${mailboxId}/polls`, undefined, { expect: [403] });
  await loginAs(ADA, 'geheim-geheim');
});

await step('Abrufprotokoll: Fehler der Verbindung, Filter «Nur Fehler»', async () => {
  // Port 1: Verbindung abgelehnt
  const broken = await api('POST', '/admin/mailboxes', imapBox(`abruf-defekt-${RUN}@test.local`, 1));
  try {
    await api('POST', `/admin/mailboxes/${broken.id}/poll`);
    const { entries } = await polls(broken.id);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].error, 'Fehler im Protokoll');
    assert.deepEqual(entries[0].mails, NONE);
    assert.equal(entries[0].error, (await api('GET', '/admin/mailboxes')).find((m) => m.id === broken.id).lastError, 'wie «Letzter Fehler»');
    assert.equal((await polls(broken.id, '?errors=1')).entries.length, 1);
    // Beim Standard-Postfach gab es keinen Fehler
    const errors = (await polls(mailboxId, '?errors=1&limit=100')).entries;
    assert.ok(errors.every((e) => e.error), 'Filter zeigt nur Fehler');
    assert.ok((await polls(mailboxId, '?limit=100')).entries.some((e) => !e.error));
  } finally {
    await api('DELETE', `/admin/mailboxes/${broken.id}`);
  }
  await api('GET', `/admin/mailboxes/${broken.id}/polls`, undefined, { expect: [404] });
});

await step('Abrufprotokoll: automatische Abrufe ohne Mails und gleiche Fehler je in einer Zeile, nach 14 Tagen gelöscht', async () => {
  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(automatischer Abruf übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  // Leeres Postfach: Mails erst ab jetzt, es kommt keine
  const quiet = await api('POST', '/admin/mailboxes', imapBox(`abruf-still-${RUN}@test.local`, 13143));
  // Nicht erreichbar: jedes Mal derselbe Fehler
  const unreachable = await api('POST', '/admin/mailboxes', imapBox(`abruf-weg-${RUN}@test.local`, 1));
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  try {
    await sendJob('mail-poll');
    const [auto] = await waitFor(async () => {
      const { entries } = await polls(quiet.id);
      return entries.length && entries;
    }, 'erster automatischer Abruf');
    assert.deepEqual([auto.polls, auto.triggeredBy, auto.error, auto.mails], [1, null, null, NONE]);
    await sendJob('mail-poll');
    const joined = await waitFor(async () => {
      const { entries } = await polls(quiet.id);
      return entries[0]?.polls === 2 && entries;
    }, 'zweiter automatischer Abruf in derselben Zeile');
    assert.equal(joined.length, 1, 'eine Zeile für beide Abrufe');
    assert.equal(joined[0].id, auto.id);
    assert.equal(joined[0].startedAt, auto.startedAt);
    assert.ok(new Date(joined[0].endedAt) > new Date(auto.endedAt), 'Ende des zweiten Abrufs');
    const failing = await waitFor(async () => {
      const { entries } = await polls(unreachable.id);
      return entries[0]?.polls === 2 && entries;
    }, 'gleicher Fehler zweimal in derselben Zeile');
    assert.equal(failing.length, 1, 'eine Zeile für beide Fehler');
    assert.ok(failing[0].error);
    assert.equal(failing[0].triggeredBy, null);
    assert.equal((await polls(unreachable.id, '?errors=1')).entries[0].polls, 2, 'auch unter «Nur Fehler»');

    // Aufbewahrung: Zeilen, deren letzter Abruf älter als 14 Tage ist, löscht die nächtliche Wartung
    await db.query(`update mailbox_polls set ended_at = now() - interval '15 days' where id = $1`, [auto.id]);
    await sendJob('maintenance');
    await waitFor(async () => (await polls(quiet.id)).entries.length === 0, 'Zeile nach 14 Tagen gelöscht');
    assert.ok((await polls(mailboxId)).entries.length > 0, 'neuere Zeilen bleiben');
  } finally {
    await db.end();
    await api('DELETE', `/admin/mailboxes/${quiet.id}`);
    await api('DELETE', `/admin/mailboxes/${unreachable.id}`);
  }
});
