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

await step('Auswertungen je Ansicht (Störungen, Aufgaben, Alle), Zähler «Aufgaben» ohne Backlog', async () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 3600 * 1000).toISOString();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FZurich&bucket=day`;
  const report = (scope) => api('GET', `/admin/reports?${query}&scope=${scope}`);
  const sum = (rows, pick) => rows.reduce((total, x) => total + pick(x), 0);
  const reporterId = (await detail(itemNo)).reporter.id;

  // Zähler: Eine neue Aufgabe kommt ins Backlog (Start-Status) und zählt erst, wenn sie es verlässt
  const counted = (await api('GET', '/items/counts')).tasks;
  const tasksBefore = await report('task');
  const n = await createItem({ type: 'task', title: `Auswertung Aufgabe ${RUN}`, reporterId });
  assert.equal((await detail(n)).status.id, status('task', 'backlog').id);
  assert.equal((await api('GET', '/items/counts')).tasks, counted, 'Backlog zählt nicht');
  assert.equal((await report('task')).totals.backlog, tasksBefore.totals.backlog + 1);
  // Fälligkeit gestern: überfällig, bis die Aufgabe erledigt ist; Durchlaufzeit ab dem Verlassen des Backlogs
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
  await api('PATCH', `/items/${n}`, { dueDate: yesterday });
  await api('POST', `/items/${n}/move`, { statusId: status('task', 'in_progress').id });
  assert.equal((await api('GET', '/items/counts')).tasks, counted + 1);
  let tasks = await report('task');
  assert.ok(tasks.overdue.items.some((i) => i.number === n && i.dueDate === yesterday), JSON.stringify(tasks.overdue));
  await api('POST', `/items/${n}/move`, { statusId: status('task', 'done').id });
  tasks = await report('task');
  assert.equal(tasks.cycleTime.count, tasksBefore.cycleTime.count + 1);
  assert.ok(!tasks.overdue.items.some((i) => i.number === n), 'erledigt: nicht mehr überfällig');
  // Neue Statuswechsel halten auch die IDs fest (für Auswertungen nach dem Umbenennen)
  const change = (await detail(n)).entries.filter((e) => e.kind === 'status').at(-1);
  assert.deepEqual([change.meta.fromId, change.meta.toId], [status('task', 'in_progress').id, status('task', 'done').id]);
  // Ansicht Aufgaben: nur Aufgaben; offen ohne Backlog, Zuständige ohne Backlog, abgelehnte getrennt
  assert.equal(tasks.backlogLabel, 'Backlog');
  assert.ok(tasks.open.byStatus.every((s) => s.type === 'task'));
  assert.equal(tasks.totals.openNow + tasks.totals.backlog, sum(tasks.open.byStatus, (s) => s.count));
  assert.equal(sum(tasks.open.byAssignee, (a) => a.count), tasks.totals.openNow, 'Zuständige ohne Backlog');
  assert.ok(tasks.totals.rejected >= 1 && tasks.totals.rejected <= tasks.totals.closed);
  assert.equal(tasks.totals.created, sum(tasks.flow, (f) => f.created.task));

  // Störungen: erste Antwort, wiedereröffnet, Dauer bis «Gelöst» je Priorität
  const incidentsBefore = await report('incident');
  const highBefore = incidentsBefore.resolution.byPriority.find((p) => p.priority === 'high')?.count ?? 0;
  const s = await createItem({ type: 'incident', title: `Auswertung Störung ${RUN}`, priority: 'high', reporterId });
  const f = new FormData();
  f.append('kind', 'reply');
  f.append('body', `Wir schauen es an ${RUN}`);
  await api('POST', `/items/${s}/entries`, f);
  let incidents = await report('incident');
  assert.equal(incidents.firstReply.count, incidentsBefore.firstReply.count + 1);
  await api('POST', `/items/${s}/move`, { statusId: status('incident', 'resolved').id });
  await api('POST', `/items/${s}/move`, { statusId: status('incident', 'in_progress').id });
  incidents = await report('incident');
  assert.equal(incidents.totals.reopened, incidentsBefore.totals.reopened + 1);
  await api('POST', `/items/${s}/move`, { statusId: status('incident', 'resolved').id });
  incidents = await report('incident');
  assert.equal(incidents.resolution.byPriority.find((p) => p.priority === 'high').count, highBefore + 1);
  assert.ok(incidents.open.byStatus.every((x) => x.type === 'incident'));
  assert.ok(incidents.byChannel.every((c) => c.type === 'incident'));
  assert.ok(incidents.open.byPriority.every((p) => p.type === 'incident'));
  assert.equal(incidents.open.inbox, 0);
  assert.equal(sum(incidents.flow, (x) => x.created.task + x.created.inbox), 0);

  // Alle: mit Eingang, Zuordnung aus dem Eingang (z.B. Schritt «Mail-Eingang»), verworfene (Schritt «Benutzer»)
  const all = await report('all');
  assert.equal(all.totals.openNow, sum(all.open.byStatus, (x) => x.count) + all.open.inbox);
  assert.ok(all.triage.count >= 1 && all.triage.medianHours >= 0, JSON.stringify(all.triage));
  assert.ok(all.totals.discarded >= 1);
  assert.ok(all.byChannel.some((c) => c.type === 'incident') && all.byChannel.some((c) => c.type === 'task'));

  // CSV nur mit den Vorgängen der Ansicht
  const res = await fetch(`${BASE}/admin/reports/items.csv?${query}&scope=task`, { headers: { cookie } });
  assert.match(res.headers.get('content-disposition'), /filename="patchwork-aufgaben-\d{4}-\d{2}-\d{2}-bis-/);
  const rows = (await res.text()).trim().split('\r\n').slice(1);
  assert.ok(rows.length >= 1 && rows.every((r) => r.split(';')[1] === 'Aufgabe'), rows.slice(0, 3).join('\n'));
  await api('GET', `/admin/reports?${query}&scope=eingang`, undefined, { expect: [400] });
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
