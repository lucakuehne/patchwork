// Smoke-Test, Bereich «Board, Textbausteine, Auswertungen» (läuft über test/smoke.mjs)
import {
  ANNA,
  api,
  ARCHIV,
  archivMailbox,
  assert,
  BASE,
  cookie,
  BERTA,
  BOB,
  byTitle,
  CARLA,
  channel,
  cond,
  createItem,
  detail,
  entryStartingWith,
  EXTERN,
  finish,
  FREMD,
  GEWINN,
  group,
  https,
  HTTPS_PORT,
  ImapFlow,
  inbox,
  inboxNumber,
  IVAN,
  LIEFERANT,
  loginAs,
  MAILBOX,
  NEWS,
  PNG,
  poll,
  reply,
  RUN,
  sendMail,
  setSessionCookie,
  simpleParser,
  simulation,
  sleep,
  smtp,
  state,
  status,
  step,
  STUMM,
  uploadImage,
  waitForMail,
  webcrypto,
  x509,
} from './lib.mjs';

let { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule } = state;

await step('Board: abgeschlossene Spalten zeigen nur die letzten 14 Tage', async () => {
  const onBoard = async () => (await api('GET', '/items?view=board')).items.some((i) => i.number === t1);
  assert.equal((await detail(t1)).status.label, 'Erledigt');
  assert.ok(await onBoard());
  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(Zeitreise übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`update items set closed_at = now() - interval '15 days' where number = $1`, [t1]);
    assert.ok(!(await onBoard()), 'vor mehr als 14 Tagen abgeschlossen');
    assert.ok((await api('GET', '/items?view=tasks-done')).items.some((i) => i.number === t1), 'bleibt unter «Erledigt»');
  } finally {
    await db.end();
  }
});

await step('Textbausteine: Admin pflegt, IT liest', async () => {
  // Platzhalter füllt die Oberfläche beim Einfügen; gespeichert wird der Text unverändert
  const snippet = await api('POST', '/admin/snippets', {
    name: 'Passwort zurückgesetzt',
    body: 'Guten Tag {{Melder Vorname}} {{Melder Nachname}}\r\n\r\nIhr Passwort wurde zurückgesetzt.\r\n\r\n{{Bearbeiter Vorname}} {{Bearbeiter Nachname}}',
  });
  assert.equal(
    snippet.body,
    'Guten Tag {{Melder Vorname}} {{Melder Nachname}}\n\nIhr Passwort wurde zurückgesetzt.\n\n{{Bearbeiter Vorname}} {{Bearbeiter Nachname}}',
  );
  await api('POST', '/admin/snippets', { name: 'Leer', body: '  ' }, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  assert.ok((await api('GET', '/snippets')).some((s) => s.id === snippet.id));
  await api('POST', '/admin/snippets', { name: 'x', body: 'y' }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  // Formatierung aus dem WYSIWYG-Editor als Markdown
  const body = '**Erledigt**, {{Melder Vorname}}.\n\n- Zuständig: {{Zuständig Vorname}} {{Zuständig Nachname}}\n- Vorgang: {{Nummer}} «{{Titel}}»';
  await api('PUT', `/admin/snippets/${snippet.id}`, { name: 'Passwort neu gesetzt', body });
  const updated = (await api('GET', '/snippets')).find((s) => s.id === snippet.id);
  assert.deepEqual([updated.name, updated.body], ['Passwort neu gesetzt', body]);
});

await step('Auswertungen: Kennzahlen pro Zeitraum, CSV, nur für Admin', async () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 3600 * 1000).toISOString();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FZurich`;
  const r = await api('GET', `/admin/reports?${query}&bucket=day`);
  assert.ok(r.flow.length >= 2);
  const createdInFlow = r.flow.reduce((sum, f) => sum + f.created.incident + f.created.task + f.created.inbox, 0);
  assert.equal(createdInFlow, r.totals.created);
  assert.ok(r.totals.created >= 20);
  assert.ok(r.totals.closed >= 1);
  assert.ok(r.open.byStatus.length > 0);
  // Offen heisst: im Eingang oder in einem nicht abgeschlossenen Status
  assert.ok(r.open.byStatus.every((s) => s.closed === false && !('category' in s)), JSON.stringify(r.open.byStatus));
  assert.equal(r.open.byStatus.reduce((s, x) => s + x.count, 0) + r.open.inbox, r.totals.openNow);
  assert.ok(r.resolution.count >= 1 && r.resolution.medianHours >= 0);
  assert.ok(r.topReporters[0].count >= r.topReporters.at(-1).count);
  assert.deepEqual(r.oldest, { total: 0, items: [] });

  // Rohe Bytes: Beim Lesen als Text entfernt fetch das BOM, das Excel für UTF-8 braucht
  const res = await fetch(`${BASE}/admin/reports/items.csv?${query}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="patchwork-vorgaenge-\d{4}-\d{2}-\d{2}-bis-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM für Excel');
  const csv = new TextDecoder().decode(bytes);
  assert.ok(csv.startsWith('Nummer;Typ;Titel;Status;Priorität;Melder;E-Mail Melder;Zuständig;Meldeweg;Erfasst;Abgeschlossen'));
  // Neue Vorgänge nach Meldeweg, zusammen alle neuen Vorgänge des Zeitraums
  assert.ok(r.byChannel.some((c) => c.label === 'E-Mail' && c.icon === 'mail' && c.count >= 1));
  assert.ok(r.byChannel.some((c) => c.label === 'Telefon' && c.count >= 1));
  assert.equal(r.byChannel.reduce((sum, c) => sum + c.count, 0), r.totals.created);
  assert.match(csv, /\r\nPW-1;Störung;VPN verbindet nicht;/);
  await api('GET', `/admin/reports?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`, undefined, { expect: [400] });
  await api('GET', `/admin/reports?${query.replace('Europe%2FZurich', 'Mond%2FKrater')}`, undefined, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', `/admin/reports?${query}`, undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
