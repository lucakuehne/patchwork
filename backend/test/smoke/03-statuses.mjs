// Smoke-Test, Bereich «Aufgaben, Ablehnen, Suche, Status und Ablauf» (läuft über test/smoke.mjs)
import {
  ANNA,
  api,
  ARCHIVE,
  archiveMailbox,
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
  STRANGER,
  PRIZE,
  group,
  https,
  HTTPS_PORT,
  ImapFlow,
  inbox,
  inboxNumber,
  IVAN,
  SUPPLIER,
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
  MUTED,
  uploadImage,
  waitForMail,
  webcrypto,
  x509,
} from './lib.mjs';

let { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule } = state;

await step('Intern erfasste Aufgaben und Board-Reihenfolge', async () => {
  const create = async (title) => {
    const f = new FormData();
    f.append('type', 'task');
    f.append('title', title);
    f.append('description', 'Beschreibung');
    f.append('channelId', channel('Telefon').id);
    return (await api('POST', '/items', f)).number;
  };
  t1 = await create('Account für neuen Mitarbeiter');
  t2 = await create('Firmware-Update');
  t3 = await create('Migration Owncloud → Nextcloud');
  let board = (await api('GET', '/items?view=board')).items;
  assert.deepEqual(board.map((i) => i.number), [t1, t2, t3]);
  const id = (n) => board.find((i) => i.number === n).id;
  // t3 zwischen t1 und t2
  await api('POST', `/items/${t3}/move`, { statusId: status('task', 'backlog').id, beforeId: id(t1), afterId: id(t2) });
  board = (await api('GET', '/items?view=board')).items;
  assert.deepEqual(board.map((i) => i.number), [t1, t3, t2]);
  // Neue Aufgaben starten wieder im «Backlog» («Offen» gab es vom 21. bis 23.10.2026)
  assert.equal((await detail(t1)).status.label, 'Backlog');
  assert.equal((await detail(t1)).creator.email, 'ada@test.local');
});

await step('Ablehnen ohne Mail, eigene Ansicht', async () => {
  const before = (await inbox(ANNA)).length;
  await api('PATCH', `/items/${t2}`, { reporterId: (await detail(itemNo)).reporter.id });
  await api('POST', `/items/${t2}/reject`, { reason: 'Kein Budget', notify: false });
  const rejected = (await api('GET', '/items?view=tasks-rejected')).items;
  assert.deepEqual(rejected.map((i) => i.number), [t2]);
  assert.ok(!(await api('GET', '/items?view=board')).items.some((i) => i.number === t2));
  await api('POST', `/items/${t3}/move`, { statusId: status('task', 'rejected').id }, { expect: [400] });
  await sleep(3000);
  // Melderwechsel löst eine Eingangsbestätigung aus? Nein – nur Ablehnung wäre relevant
  assert.equal((await inbox(ANNA)).length, before);
});

await step('Ablehnen mit «Melder informieren»', async () => {
  await api('PATCH', `/items/${t3}`, { reporterId: (await detail(itemNo)).reporter.id });
  await api('POST', `/items/${t3}/reject`, { reason: 'Wird extern gelöst', notify: true });
  await waitForMail(ANNA, (m) => m.subject.startsWith(`[PW-${t3}] Abgelehnt:`), 'Ablehnung');
});

await step('Suche', async () => {
  assert.ok((await api('GET', '/items?view=search&q=VPN')).items.some((i) => i.number === itemNo));
  assert.ok((await api('GET', '/items?view=search&q=Zertifikat')).items.some((i) => i.number === itemNo), 'Notizen werden durchsucht');
  assert.ok((await api('GET', `/items?view=search&q=PW-${t1}`)).items.some((i) => i.number === t1));
  assert.ok((await api('GET', '/items?view=tasks-rejected&q=Firmware')).items.length === 1);
});

await step('Filter und Sortierung der Listen: Priorität, Zuständig, Status, Meldeweg, Spaltenkopf', async () => {
  const numbers = async (query) => (await api('GET', `/items?${new URLSearchParams(query)}`)).items.map((i) => i.number);
  const has = async (query) => (await numbers({ view: 'incidents', ...query })).includes(itemNo);
  const current = await detail(itemNo);
  assert.deepEqual([current.priority, current.assignee.email, current.channel.label], ['high', IVAN, 'E-Mail']);
  // Jeder Filter einzeln: passend bzw. nicht passend
  assert.deepEqual([await has({ priority: 'high' }), await has({ priority: 'low' })], [true, false]);
  assert.deepEqual([await has({ assignee: ivan.id }), await has({ assignee: 'none' })], [true, false]);
  assert.deepEqual([await has({ status: current.status.id }), await has({ status: status('incident', 'new').id })], [true, false]);
  assert.deepEqual([await has({ channel: channel('E-Mail').id }), await has({ channel: 'none' })], [true, false]);
  assert.equal(await has({ priority: 'high', assignee: ivan.id, channel: channel('E-Mail').id }), true, 'kombiniert');
  // Seitenweise Liste: Filter gelten auch für die Gesamtzahl
  const rejected = await api('GET', '/items?view=tasks-rejected&priority=high');
  assert.deepEqual([rejected.items.length, rejected.total], [0, 0]);
  // Sortieren per Spaltenkopf (abgelehnt: «Firmware-Update» und «Migration Owncloud → Nextcloud»)
  assert.deepEqual(await numbers({ view: 'tasks-rejected', sort: 'title', dir: 'asc' }), [t2, t3]);
  assert.deepEqual(await numbers({ view: 'tasks-rejected', sort: 'title', dir: 'desc' }), [t3, t2]);
  assert.deepEqual(await numbers({ view: 'tasks-rejected', sort: 'number', dir: 'desc' }), [t3, t2]);
  await api('GET', '/items?view=incidents&sort=gibtsnicht', undefined, { expect: [400] });
  await api('GET', '/items?view=incidents&assignee=jemand', undefined, { expect: [400] });
});

await step('Status: anlegen mit «abgeschlossen», umschalten, löschen mit Ersatz', async () => {
  const created = await api('POST', '/statuses', { type: 'task', label: 'Test läuft', closed: false });
  assert.equal(created.key, 'test_laeuft');
  assert.deepEqual([created.closed, created.color], [false, 'blue'], 'offen: blau');
  await api('POST', '/statuses', { type: 'task', label: 'Ohne Angabe' }, { expect: [400] });
  await api('POST', `/items/${t1}/move`, { statusId: created.id });
  assert.ok(!('toCategory' in (await detail(t1)).entries.at(-1).meta), 'keine Kategorie im Verlauf');

  // «abgeschlossen» umschalten: Abschlussdatum, Zähler, Listen und Board richten sich danach
  const openTasks = (await api('GET', '/items/counts')).tasks;
  await api('PATCH', `/statuses/${created.id}`, { closed: true });
  let item = await detail(t1);
  assert.equal(item.status.closed, true);
  assert.ok(item.closedAt, 'abgeschlossen setzt closedAt');
  assert.equal((await api('GET', '/items/counts')).tasks, openTasks - 1, 'Zähler nur für Offenes');
  assert.ok((await api('GET', '/items?view=tasks-done')).items.some((i) => i.number === t1), 'abgeschlossen ausser Ablehnen: «Erledigt»');
  assert.ok(!(await api('GET', '/items?view=tasks-rejected')).items.some((i) => i.number === t1));
  assert.ok((await api('GET', '/items?view=board')).items.some((i) => i.number === t1), 'abgeschlossene Spalte (letzte 14 Tage)');
  await api('PATCH', `/statuses/${created.id}`, { closed: false });
  item = await detail(t1);
  assert.equal(item.status.closed, false);
  assert.equal(item.closedAt, null, 'wieder offen leert closedAt');
  assert.equal((await api('GET', '/items/counts')).tasks, openTasks);

  // Löschen eines verwendeten Status nur mit Ersatz desselben Typs
  assert.match((await api('DELETE', `/statuses/${created.id}`, {}, { expect: [400] })).message, /Ersatzstatus/);
  await api('DELETE', `/statuses/${created.id}`, { replacementId: status('incident', 'new').id }, { expect: [400] });
  await api('DELETE', `/statuses/${created.id}`, { replacementId: status('task', 'done').id });
  item = await detail(t1);
  assert.equal(item.status.label, 'Erledigt');
  assert.ok(item.closedAt, 'abgeschlossener Ersatz setzt closedAt');
  assert.ok(!(await api('GET', '/statuses')).some((s) => s.id === created.id));
});

await step('Status: Ziele für automatische Wechsel lesen, prüfen, setzen und beim Löschen ersetzen', async () => {
  const i = (key) => status('incident', key).id;
  const t = (key) => status('task', key).id;
  const defaults = {
    incident: { start: i('new'), reply: i('in_progress'), close: i('resolved'), waiting: i('waiting') },
    task: { start: t('backlog'), reply: t('in_progress'), close: t('done'), reject: t('rejected') },
  };
  assert.deepEqual(await api('GET', '/statuses/targets'), defaults);
  const put = (type, targets, opts) => api('PUT', '/statuses/targets', { type, targets }, opts);

  // Ungültig: offen und abgeschlossen vertauscht, fremder Typ, Ziele, die sich ausschliessen, Pflichtziel fehlt
  for (const [targets, message] of [
    [{ ...defaults.task, start: t('done') }, /muss offen sein/],
    [{ ...defaults.task, close: t('in_progress') }, /muss abgeschlossen sein/],
    [{ ...defaults.task, reject: t('planned') }, /muss abgeschlossen sein/],
    [{ ...defaults.task, waiting: t('done') }, /muss offen sein/],
    [{ ...defaults.task, start: i('new') }, /gehört nicht zu diesem Typ/],
    [{ ...defaults.task, reject: t('done') }, /verschiedene Status/],
    [{ ...defaults.task, waiting: t('in_progress') }, /«Wartet auf den Melder»/],
    [{ ...defaults.task, waiting: t('backlog') }, /neue Vorgänge/],
  ]) {
    assert.match((await put('task', targets, { expect: [400] })).message, message);
  }
  await put('task', { start: t('backlog'), reply: t('in_progress') }, { expect: [400] });
  assert.deepEqual(await api('GET', '/statuses/targets'), defaults, 'unverändert');

  // «abgeschlossen» lässt sich nicht umschalten, solange ein Ziel es verbietet
  assert.match((await api('PATCH', `/statuses/${t('done')}`, { closed: false }, { expect: [400] })).message, /Automatisch schliessen in/);
  await api('PATCH', `/statuses/${t('rejected')}`, { closed: false }, { expect: [400] });
  await api('PATCH', `/statuses/${t('backlog')}`, { closed: true }, { expect: [400] });
  await api('PATCH', `/statuses/${i('waiting')}`, { closed: true }, { expect: [400] });

  // Ziele ändern: anderer Start-Status und ein Wartet-Status für Aufgaben
  const followUp = await api('POST', '/statuses', { type: 'task', label: 'Rückfrage', closed: false });
  const changed = { ...defaults.task, start: t('planned'), waiting: followUp.id };
  assert.deepEqual((await put('task', changed)).task, changed);
  const n = await createItem({ type: 'task', title: `Rückfrage ${RUN}`, reporterId: (await detail(itemNo)).reporter.id });
  assert.equal((await detail(n)).status.label, 'Geplant', '«Neuer Vorgang erhält»');

  // Die Antwort des Melders holt den Vorgang aus dem Wartet-Status zurück, aus anderen offenen Status nicht
  const answer = async (text) => {
    await sendMail({ from: ANNA, subject: `Re: [PW-${n}] Rückfrage ${RUN}`, text });
    await sleep(500);
    await poll();
    return detail(n);
  };
  await api('POST', `/items/${n}/move`, { statusId: followUp.id });
  assert.equal((await answer('Hier die Angaben.')).status.label, 'In Arbeit', '«Antwort des Melders führt in»');
  await api('POST', `/items/${n}/move`, { statusId: t('backlog') });
  const unchanged = await answer('Noch ein Nachtrag.');
  assert.equal(unchanged.status.label, 'Backlog');
  assert.ok(unchanged.entries.some((e) => e.kind === 'reply' && e.body === 'Noch ein Nachtrag.'));

  // Typwechsel zur Aufgabe in den Wartet-Status der Aufgaben
  const w = await createItem({ type: 'incident', title: 'Wartet beim Typwechsel' });
  await api('POST', `/items/${w}/move`, { statusId: i('waiting') });
  await api('POST', `/items/${w}/type`, { type: 'task', statusId: followUp.id });
  assert.equal((await detail(w)).status.label, 'Rückfrage');

  // Ziel-Status löschen: nur mit passendem Ersatz für das Ziel, ein freiwilliges Ziel auch ohne
  const removeFollowUp = (body, opts) => api('DELETE', `/statuses/${followUp.id}`, body, opts);
  assert.match((await removeFollowUp({ replacementId: t('in_progress') }, { expect: [400] })).message, /Wartet auf den Melder/);
  await removeFollowUp({ replacementId: t('in_progress'), targets: { waiting: t('in_progress') } }, { expect: [400] });
  await removeFollowUp({ replacementId: t('in_progress'), targets: { waiting: null } });
  assert.equal((await detail(w)).status.label, 'In Arbeit');
  let targets = await api('GET', '/statuses/targets');
  assert.deepEqual(targets.task, { ...defaults.task, start: t('planned') }, 'Wartet-Ziel entfernt');

  const archived = await api('POST', '/statuses', { type: 'task', label: 'Archiviert', closed: true });
  assert.deepEqual([archived.closed, archived.color], [true, 'green'], 'abgeschlossen: grün');
  await put('task', { ...targets.task, close: archived.id });
  const removeArchived = (body, opts) => api('DELETE', `/statuses/${archived.id}`, body, opts);
  assert.match((await removeArchived({}, { expect: [400] })).message, /Automatisch schliessen in/);
  assert.match((await removeArchived({ targets: { close: null } }, { expect: [400] })).message, /braucht einen Status/);
  assert.match((await removeArchived({ targets: { close: t('in_progress') } }, { expect: [400] })).message, /muss abgeschlossen sein/);
  await removeArchived({ targets: { close: t('done') } });
  targets = await api('GET', '/statuses/targets');
  assert.equal(targets.task.close, t('done'), 'Ziel umgehängt');
  // Ebenso bei den Standardstatus: «Gelöst» ist das Schliessen-Ziel der Störungen
  assert.match(
    (await api('DELETE', `/statuses/${i('resolved')}`, { replacementId: i('new') }, { expect: [400] })).message,
    /«Gelöst» ist «Automatisch schliessen in»/,
  );

  await put('task', defaults.task);
  assert.deepEqual(await api('GET', '/statuses/targets'), defaults);
});

await step('Typwechsel: zur Aufgabe nur mit gewähltem Status, zur Störung nach Rolle vorgeschlagen oder gewählt', async () => {
  const i = (key) => status('incident', key).id;
  const t = (key) => status('task', key).id;
  const setType = (n, type, statusId, opts) => api('POST', `/items/${n}/type`, { type, ...(statusId ? { statusId } : {}) }, opts);
  const label = async (n) => (await detail(n)).status.label;

  // Zur Aufgabe nur mit gewähltem Status (seit 23.10.2026); zur Störung ohne Wahl: übrige offene → «nach Antwort»,
  // abgeschlossene → «Automatisch schliessen in»
  const a = await createItem({ type: 'incident', title: 'Typwechsel A' });
  await setType(a, 'task', null, { expect: [400] });
  await setType(a, 'task', t('planned'));
  assert.equal(await label(a), 'Geplant');
  await setType(a, 'incident');
  assert.equal(await label(a), 'In Arbeit');
  await api('POST', `/items/${a}/move`, { statusId: i('resolved') });
  const { closedAt } = await detail(a);
  await setType(a, 'task', t('done'));
  let d = await detail(a);
  assert.equal(d.status.label, 'Erledigt');
  assert.equal(d.closedAt, closedAt, 'zwischen abgeschlossenen Status bleibt das Abschlussdatum');

  // Mit Wahl: jeder Status des Zieltyps, der Ablauf gilt dabei nicht
  await api('PUT', '/statuses/flow', { type: 'incident', restrict: true, transitions: [] });
  await setType(a, 'incident', i('waiting'));
  d = await detail(a);
  assert.equal(d.status.label, 'Wartet auf Melder');
  assert.equal(d.closedAt, null);
  assert.deepEqual([d.entries.at(-1).meta.fromStatus, d.entries.at(-1).meta.toStatus], ['Erledigt', 'Wartet auf Melder']);
  await api('PUT', '/statuses/flow', { type: 'incident', restrict: false, transitions: [] });
  await setType(a, 'task', i('new'), { expect: [400] });
  await setType(a, 'task', t('rejected'), { expect: [400] });
  assert.equal(await label(a), 'Wartet auf Melder', 'unverändert');
  await setType(a, 'task', t('done'));
  assert.ok((await detail(a)).closedAt, 'gewählter abgeschlossener Status setzt das Abschlussdatum');

  // «Ablehnen» gibt es nur mit Ziel, Störungen haben anfangs keins
  const b = await createItem({ type: 'incident', title: 'Typwechsel B' });
  assert.match((await api('POST', `/items/${b}/reject`, { reason: 'x', notify: false }, { expect: [400] })).message, /nicht eingerichtet/);
  const declined = await api('POST', '/statuses', { type: 'incident', label: 'Abgewiesen', closed: true });
  const incidentTargets = (await api('GET', '/statuses/targets')).incident;
  await api('PUT', '/statuses/targets', { type: 'incident', targets: { ...incidentTargets, reject: declined.id } });
  await api('POST', `/items/${b}/reject`, { reason: 'Kein Fehler', notify: false });
  assert.equal(await label(b), 'Abgewiesen');
  assert.match((await api('POST', `/items/${b}/reject`, { reason: 'Nochmals', notify: false }, { expect: [400] })).message, /bereits abgelehnt/);

  // Zur Aufgabe nie in den Ablehnen-Status, auch nicht aus dem Ablehnen-Status der Störung
  await setType(b, 'task', t('rejected'), { expect: [400] });
  await setType(b, 'task', t('done'));
  assert.equal(await label(b), 'Erledigt');
  // Zur Störung: Ablehnen → Ablehnen; den Ablehnen-Status der Störung gibt es nur aus dem Ablehnen-Status der Aufgaben
  await setType(b, 'incident', declined.id, { expect: [400] });
  const c = await createItem({ type: 'task', title: 'Typwechsel C' });
  await api('POST', `/items/${c}/reject`, { reason: 'Nicht nötig', notify: false });
  await setType(c, 'incident');
  assert.equal(await label(c), 'Abgewiesen');
  // Ablehnen-Ziel entfernen: Ein Ablehnen-Status ohne Gegenstück im Zieltyp führt in «Automatisch schliessen in»
  await api('DELETE', `/statuses/${declined.id}`, { replacementId: i('resolved'), targets: { reject: null } });
  assert.equal(await label(c), 'Gelöst');
  assert.deepEqual((await api('GET', '/statuses/targets')).incident, incidentTargets);
  const e = await createItem({ type: 'task', title: 'Typwechsel E' });
  await api('POST', `/items/${e}/reject`, { reason: 'Nicht nötig', notify: false });
  await setType(e, 'incident');
  assert.equal(await label(e), 'Gelöst');

  // Auch beim Erfassen ist der Ablehnen-Status nicht wählbar
  const f = new FormData();
  for (const [k, v] of Object.entries({ type: 'task', title: 'Gleich abgelehnt', channelId: channel('Telefon').id, statusId: t('rejected') })) {
    f.append(k, v);
  }
  await api('POST', '/items', f, { expect: [400] });
});

await step('Status: Farben und Ablauf, eingeschränkt gilt er für Wechsel von Hand und «Ablehnen»', async () => {
  let list = await api('GET', '/statuses');
  assert.equal(list.find((s) => s.type === 'task' && s.key === 'backlog').color, 'blue', 'Standardfarbe');
  // «Backlog» zuvorderst
  assert.deepEqual(list.filter((s) => s.type === 'task').map((s) => [s.key, s.position])[0], ['backlog', 0]);
  assert.equal(list.find((s) => s.type === 'task' && s.key === 'done').color, 'green');
  const backlog = status('task', 'backlog');
  await api('PATCH', `/statuses/${backlog.id}`, { color: 'purple', diagramX: 10, diagramY: 20 });
  list = await api('GET', '/statuses');
  assert.deepEqual(
    ['color', 'diagramX', 'diagramY'].map((k) => list.find((s) => s.id === backlog.id)[k]),
    ['purple', 10, 20],
  );
  await api('PATCH', `/statuses/${backlog.id}`, { color: 'neon' }, { expect: [400] });

  assert.deepEqual(await api('GET', '/statuses/flow'), { restrict: { incident: false, task: false }, transitions: [] });
  const inProgress = status('task', 'in_progress');
  const done = status('task', 'done');
  const rejected = status('task', 'rejected');
  // Ungültige Wechsel: in sich selbst, über die Typen hinweg
  for (const transitions of [
    [{ fromId: backlog.id, toId: backlog.id }],
    [{ fromId: backlog.id, toId: status('incident', 'new').id }],
  ]) {
    await api('PUT', '/statuses/flow', { type: 'task', restrict: true, transitions }, { expect: [400] });
  }
  // Pfeile in den Ablehnen-Status sind erlaubt: Sie bestimmen, woraus «Ablehnen» möglich ist
  const flow = await api('PUT', '/statuses/flow', {
    type: 'task',
    restrict: true,
    transitions: [
      { fromId: backlog.id, toId: inProgress.id },
      { fromId: inProgress.id, toId: done.id },
      { fromId: inProgress.id, toId: rejected.id },
    ],
  });
  assert.equal(flow.restrict.task, true);
  assert.equal(flow.restrict.incident, false);
  assert.equal(flow.transitions.length, 3);

  const n = await createItem({ type: 'task', title: 'Ablauf prüfen' });
  const refused = await api('POST', `/items/${n}/move`, { statusId: done.id }, { expect: [400] });
  assert.match(refused.message, /im Ablauf nicht vorgesehen/);
  const noReject = await api('POST', `/items/${n}/reject`, { reason: 'Test', notify: false }, { expect: [400] });
  assert.match(noReject.message, /im Ablauf nicht vorgesehen/, 'kein Pfeil aus «Backlog» in den Ablehnen-Status');
  await api('POST', `/items/${n}/move`, { statusId: inProgress.id });
  // Auch mit Pfeil führt nur «Ablehnen» (mit Begründung) in den Ablehnen-Status, nicht das Status-Feld oder das Board
  await api('POST', `/items/${n}/move`, { statusId: rejected.id }, { expect: [400] });
  await api('POST', `/items/${n}/move`, { statusId: done.id });
  assert.equal((await detail(n)).status.color, 'green');
  await api('POST', `/items/${n}/reject`, { reason: 'Test', notify: false }, { expect: [400] });
  const m = await createItem({ type: 'task', title: 'Ablauf: ablehnen' });
  await api('POST', `/items/${m}/move`, { statusId: inProgress.id });
  await api('POST', `/items/${m}/reject`, { reason: 'Test', notify: false });
  assert.equal((await detail(m)).status.label, 'Abgelehnt');

  await loginAs(IVAN, 'geheim-geheim');
  assert.equal((await api('GET', '/statuses/flow')).restrict.task, true);
  await api('PUT', '/statuses/flow', { type: 'task', restrict: false, transitions: [] }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/statuses/flow', { type: 'task', restrict: false, transitions: [] });
  await api('PATCH', `/statuses/${backlog.id}`, { color: 'blue' });
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
