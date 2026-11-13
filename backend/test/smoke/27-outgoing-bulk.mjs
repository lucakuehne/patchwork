// Smoke-Test, Bereich «Ausgehende Mails: Zustellversuche, Wiederholungen, Massenaktionen» (läuft über test/smoke.mjs,
// Entscheid vom 13.11.2026)
import { inflateRawSync } from 'node:zlib';
import { api, assert, BASE, cookie, createItem, detail, everyBlock, IVAN, loginAs, reply, RUN, sleep, state, step } from './lib.mjs';

const { anna, mailboxId } = state;
const ADA = 'ada@test.local';
const BROKEN = `wiederholung-${RUN}@test.local`;
const DEFAULTS = { retries: 10, firstDelayMinutes: 1, doubling: true, maxDelayMinutes: 60 };
const minutesBetween = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
const mail = (id) => api('GET', `/admin/outgoing-mails/${id}`);

/** Wartet, bis die Mail fertig verarbeitet ist und so viele Versuche im Protokoll stehen */
async function settled(id, attempts) {
  let m;
  for (let i = 0; i < 40; i++) {
    m = await mail(id);
    if (m.status !== 'queued' && m.attemptLog.length >= attempts) return m;
    await sleep(1000);
  }
  throw new Error(`Mail ${id}: ${m?.status}, ${m?.attemptLog.length} Versuche statt ${attempts}`);
}

/** Liest ein ZIP (ohne Datendeskriptor, wie Patchwork es schreibt): Name → Inhalt */
function unzip(buf) {
  const files = new Map();
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLength = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLength).toString('utf8');
    const start = p + 30 + nameLength + extra;
    const data = buf.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p = start + size;
  }
  return files;
}

const box = {
  name: 'Wiederholung',
  address: BROKEN,
  active: true,
  isDefault: false,
  imapHost: 'localhost',
  imapPort: 13143,
  imapSecure: false,
  imapFolder: 'INBOX',
  // Port 1: Verbindung abgelehnt
  smtpHost: 'localhost',
  smtpPort: 1,
  smtpSecurity: 'none',
  authType: 'password',
  username: BROKEN,
  password: 'x',
};

let itemNo = 0;
let brokenId = '';
let failedId = '';
let secondId = '';
let sentId = '';
const firstText = `Wiederholung eins ${RUN}`;
const secondText = `Wiederholung zwei ${RUN}`;

/** Öffentliche Antwort über das defekte Postfach; gibt die fehlgeschlagene Mail zurück */
async function failingReply(text) {
  await reply(`/items/${itemNo}/entries`, text, 'reply');
  for (let i = 0; i < 30; i++) {
    const entry = (await detail(itemNo)).entries.find((e) => e.body === text);
    if (entry?.delivery?.status === 'failed') return settled(entry.mailId, 1);
    await sleep(1000);
  }
  throw new Error(`Antwort «${text}» ist nicht fehlgeschlagen`);
}

await step('Wiederholungen: Vorgabe, Prüfung der Eingaben, nur für Admins', async () => {
  await loginAs(ADA, 'geheim-geheim');
  await api('PUT', '/settings/mail', everyBlock({ staff: 'all', others: 'all' }));
  assert.deepEqual(await api('GET', '/admin/outgoing-mails/retry-settings'), DEFAULTS);
  for (const wrong of [
    { retries: 21 },
    { retries: -1 },
    { retries: 1.5 },
    { firstDelayMinutes: 0 },
    { maxDelayMinutes: 1441 },
    { doubling: 'ja' },
  ]) {
    await api('PUT', '/admin/outgoing-mails/retry-settings', { ...DEFAULTS, ...wrong }, { expect: [400] });
  }
  assert.deepEqual(await api('GET', '/admin/outgoing-mails/retry-settings'), DEFAULTS, 'ungültige Eingaben ändern nichts');

  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/outgoing-mails/retry-settings', undefined, { expect: [403] });
  await api('PUT', '/admin/outgoing-mails/retry-settings', DEFAULTS, { expect: [403] });
  for (const action of ['resend', 'dismiss', 'eml']) {
    await api('POST', `/admin/outgoing-mails/bulk/${action}`, { ids: [crypto.randomUUID()] }, { expect: [403] });
  }
  await loginAs(ADA, 'geheim-geheim');
});

await step('Zustellversuche: Fehler mit nächstem Versuch nach den Einstellungen, eine Änderung gilt sofort', async () => {
  itemNo = await createItem({ type: 'incident', title: `Wiederholungen ${RUN}`, reporterId: anna.id });
  // Eingangsbestätigung noch über das funktionierende Postfach: für die Massenaktionen eine versendete Mail
  for (let i = 0; i < 30 && !sentId; i++) {
    const confirmation = (await detail(itemNo)).mails.find((m) => m.template === 'confirmation' && m.status === 'sent');
    if (confirmation) sentId = confirmation.id;
    else await sleep(1000);
  }
  assert.ok(sentId, 'Eingangsbestätigung versendet');
  const sent = await mail(sentId);
  assert.equal(sent.attemptLog.length, 1);
  assert.deepEqual(
    [sent.attemptLog[0].result, sent.attemptLog[0].by, sent.attemptLog[0].error, sent.nextAttemptAt],
    ['sent', null, null, null],
    'erfolgreicher Versuch im Protokoll',
  );
  assert.ok(sent.attemptLog[0].deliveredTo.length > 0);

  brokenId = (await api('POST', '/admin/mailboxes', box)).id;
  await api('PATCH', `/items/${itemNo}`, { mailboxId: brokenId });
  const failed = await failingReply(firstText);
  failedId = failed.id;
  const [attempt] = failed.attemptLog;
  assert.equal(failed.status, 'failed');
  assert.deepEqual([attempt.result, attempt.by, attempt.mailbox], ['failed', null, BROKEN]);
  assert.ok(attempt.error, 'Fehlermeldung beim Versuch');
  assert.equal(attempt.error, failed.error);
  assert.equal(minutesBetween(attempt.at, failed.nextAttemptAt), 1, 'erste Wiederholung nach 1 Minute');

  // Auch in der Ansicht beim Vorgang (Verlauf → «Mail ansehen»)
  const view = await api('GET', `/items/${itemNo}/mails/${failedId}`);
  assert.deepEqual(view.attemptLog, failed.attemptLog);
  assert.equal(view.nextAttemptAt, failed.nextAttemptAt);

  // Änderung gilt sofort für die wartende Mail
  const fixed = { retries: 3, firstDelayMinutes: 30, doubling: false, maxDelayMinutes: 60 };
  assert.deepEqual(await api('PUT', '/admin/outgoing-mails/retry-settings', fixed), fixed);
  assert.deepEqual(await api('GET', '/admin/outgoing-mails/retry-settings'), fixed);
  assert.equal(minutesBetween(attempt.at, (await mail(failedId)).nextAttemptAt), 30);
  // Keine Wiederholungen: Die Mail wartet nicht mehr
  await api('PUT', '/admin/outgoing-mails/retry-settings', { ...fixed, retries: 0 });
  assert.equal((await mail(failedId)).nextAttemptAt, null);
  assert.equal((await mail(failedId)).status, 'failed', 'bleibt auf «Fehler»');
  const { entries: audit } = await api('GET', '/admin/audit-log?limit=50');
  assert.ok(
    audit.some((e) => e.action === 'Wiederholungen beim Versand geändert'),
    'Änderung im Aktionsprotokoll',
  );
});

await step('Massenaktionen: «Erneut senden» nur bei Fehlern, .eml als ZIP, «Als erledigt markieren»', async () => {
  // Ohne Wiederholungen (Einstellung aus dem vorigen Schritt), damit kein automatischer Versuch dazwischenkommt
  const second = await failingReply(secondText);
  secondId = second.id;
  assert.equal(second.nextAttemptAt, null, 'ohne Wiederholungen kein nächster Versuch');

  for (const ids of [[], ['keine-id'], Array.from({ length: 501 }, () => crypto.randomUUID())]) {
    await api('POST', '/admin/outgoing-mails/bulk/resend', { ids }, { expect: [400] });
  }
  assert.deepEqual(await api('POST', '/admin/outgoing-mails/bulk/resend', { ids: [failedId, secondId, sentId] }), { done: 2, skipped: 1 });
  for (const id of [failedId, secondId]) {
    const m = await settled(id, 2);
    assert.equal(m.status, 'failed');
    assert.equal(m.attempts, 2);
    const last = m.attemptLog.at(-1);
    assert.deepEqual([last.result, last.by], ['failed', 'Ada Admin'], '«erneut gesendet von»');
  }
  assert.equal((await mail(sentId)).attemptLog.length, 1, 'versendete Mail übersprungen');

  // Als .eml herunterladen: ZIP mit «PW-123 Betreff.eml», gleiche Namen nummeriert
  const res = await fetch(`${BASE}/admin/outgoing-mails/bulk/eml`, {
    method: 'POST',
    headers: { cookie, 'x-patchwork': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [sentId, failedId, secondId] }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''Ausgehende%20Mails%20\d{4}-\d{2}-\d{2}\.zip/);
  const files = unzip(Buffer.from(await res.arrayBuffer()));
  const names = [...files.keys()];
  const { item } = await mail(sentId);
  const ref = `${item.prefix}-${item.number}`;
  assert.equal(names.length, 3, names.join(' | '));
  assert.ok(names.every((n) => n.startsWith(`${ref} `) && n.endsWith('.eml')), names.join(' | '));
  assert.ok(names.every((n) => !n.includes(`[${ref}]`)), 'Kennung nicht doppelt');
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 3, 'Namen eindeutig');
  assert.ok([...files.values()].every((eml) => /^Message-ID: <pw\./im.test(eml)), 'vollständige Mails');
  assert.ok([...files.values()].some((eml) => eml.includes(firstText)));
  assert.ok([...files.values()].some((eml) => eml.includes(secondText)));

  // Als erledigt markieren: nur fehlgeschlagene
  assert.deepEqual(await api('POST', '/admin/outgoing-mails/bulk/dismiss', { ids: [failedId, sentId] }), { done: 1, skipped: 1 });
  const dismissed = await mail(failedId);
  assert.ok(dismissed.dismissedAt);
  assert.equal(dismissed.nextAttemptAt, null);
  assert.equal((await mail(sentId)).dismissedAt, null);
  const { entries: audit } = await api('GET', '/admin/audit-log?limit=50');
  assert.ok(
    audit.some((e) => e.action === 'Mails erneut gesendet: 2, 1 übersprungen'),
    'Massenaktion im Aktionsprotokoll',
  );
});

await step('Automatische Wiederholung: nach «Erneut senden» neue Reihe, fällige Mails holt der Versand ab', async () => {
  await api('PUT', '/admin/outgoing-mails/retry-settings', DEFAULTS);
  // Wartete nicht mehr (keine Wiederholungen), also auch nach der Änderung kein nächster Versuch
  assert.equal((await mail(secondId)).nextAttemptAt, null);
  await api('POST', `/admin/outgoing-mails/${secondId}/resend`);
  const resent = await settled(secondId, 3);
  const manual = resent.attemptLog.at(-1);
  assert.equal(manual.by, 'Ada Admin');
  assert.equal(minutesBetween(manual.at, resent.nextAttemptAt), 1, 'neue Reihe: wieder nach 1 Minute');

  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(automatischer Versuch übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`update outgoing_mails set next_attempt_at = now() where id = $1`, [secondId]);
  } finally {
    await db.end();
  }
  // Der Versand prüft jede Minute
  let auto;
  for (let i = 0; i < 100 && !auto; i++) {
    const m = await mail(secondId);
    if (m.status === 'failed' && m.attemptLog.length === 4) auto = m;
    else await sleep(1000);
  }
  assert.ok(auto, 'automatischer Versuch innerhalb von 100 Sekunden');
  const last = auto.attemptLog.at(-1);
  assert.deepEqual([last.result, last.by], ['failed', null], 'automatisch');
  assert.equal(auto.attempts, 4);
  assert.equal(minutesBetween(last.at, auto.nextAttemptAt), 2, 'zweite Wiederholung der Reihe nach 2 Minuten');
});

await step('Aufräumen: fehlgeschlagene Mails als erledigt, Postfach entfernt', async () => {
  const open = (await api('GET', '/admin/outgoing-mails?status=failed')).filter((m) => !m.dismissedAt);
  if (open.length) {
    const result = await api('POST', '/admin/outgoing-mails/bulk/dismiss', { ids: open.map((m) => m.id) });
    assert.equal(result.done + result.skipped, open.length);
  }
  assert.ok((await api('GET', '/admin/outgoing-mails?status=failed')).every((m) => m.dismissedAt && m.nextAttemptAt === null));
  if (itemNo) await api('PATCH', `/items/${itemNo}`, { mailboxId });
  if (brokenId) await api('DELETE', `/admin/mailboxes/${brokenId}`);
});
