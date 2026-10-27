// Smoke-Test, Bereich «Einstellungen, Board der Störungen, Liste der Aufgaben, Vorgang im Fenster, zuletzt aktiv» (läuft über test/smoke.mjs)
import { api, assert, BASE, cookie, createItem, detail, IVAN, loginAs, RUN, setSessionCookie, state, status, step } from './lib.mjs';

let { statuses } = state;

await step('Einstellungen pro Benutzer: Standard, Zusammenführen, ungültige Werte', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const defaults = {
    layout: { incidents: 'list', tasks: 'board' },
    open: { inbox: 'modal', incident: 'modal', task: 'modal' },
  };
  assert.deepEqual(await api('GET', '/me/preferences'), defaults);
  // Teiländerungen ergänzen den Rest
  assert.deepEqual(await api('PUT', '/me/preferences', { layout: { incidents: 'board' } }), {
    ...defaults,
    layout: { incidents: 'board', tasks: 'board' },
  });
  assert.deepEqual(await api('PUT', '/me/preferences', { open: { task: 'page' } }), {
    layout: { incidents: 'board', tasks: 'board' },
    open: { inbox: 'modal', incident: 'modal', task: 'page' },
  });
  assert.equal((await api('GET', '/me/preferences')).open.task, 'page', 'gespeichert');
  await api('PUT', '/me/preferences', { layout: { incidents: 'grid' } }, { expect: [400] });
  await api('PUT', '/me/preferences', { open: { portal: 'modal' } }, { expect: [400] });
  await api('PUT', '/me/preferences', { colors: 'dark' }, { expect: [400] });

  // Jeder Benutzer hat seine eigenen
  await loginAs(IVAN, 'geheim-geheim');
  assert.deepEqual(await api('GET', '/me/preferences'), defaults);
  await loginAs('ada@test.local', 'geheim-geheim');
  // Zurück auf den Standard, damit die Browserprüfung davon ausgehen kann
  assert.deepEqual(await api('PUT', '/me/preferences', defaults), defaults);
});

await step('Board der Störungen: offene und gelöste der letzten 14 Tage, nach Priorität und Alter', async () => {
  const low = await createItem({ type: 'incident', title: `Board-Störung tief ${RUN}`, priority: 'low' });
  const high = await createItem({ type: 'incident', title: `Board-Störung hoch ${RUN}`, priority: 'high' });
  const highLater = await createItem({ type: 'incident', title: `Board-Störung hoch später ${RUN}`, priority: 'high' });
  const solved = await createItem({ type: 'incident', title: `Board-Störung gelöst ${RUN}`, priority: 'normal' });
  await api('POST', `/items/${solved}/move`, { statusId: status('incident', 'resolved').id });

  const board = (await api('GET', '/items?view=incidents-board')).items;
  assert.ok(board.every((i) => i.type === 'incident'), 'nur Störungen');
  const numbers = board.map((i) => i.number);
  assert.ok(numbers.includes(solved), 'gelöste der letzten 14 Tage');
  assert.ok(!(await api('GET', '/items?view=incidents')).items.some((i) => i.number === solved), 'Liste nur offene');
  // In derselben Spalte: hoch vor tief, bei gleicher Priorität die ältere zuerst
  const column = board.filter((i) => i.status.id === status('incident', 'new').id).map((i) => i.number);
  assert.ok(column.indexOf(high) < column.indexOf(highLater), 'ältere zuerst');
  assert.ok(column.indexOf(highLater) < column.indexOf(low), 'hoch vor tief');
  // Das Board blättert nicht und ignoriert eine Sortierung per Spaltenkopf
  const sorted = (await api('GET', '/items?view=incidents-board&sort=title&dir=asc')).items.map((i) => i.number);
  assert.deepEqual(sorted, numbers);

  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(Zeitreise übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`update items set closed_at = now() - interval '15 days' where number = $1`, [solved]);
    const after = (await api('GET', '/items?view=incidents-board')).items;
    assert.ok(!after.some((i) => i.number === solved), 'vor mehr als 14 Tagen gelöst');
  } finally {
    await db.end();
  }
});

await step('Liste der offenen Aufgaben: nach Status, dann wie im Board', async () => {
  const position = new Map(statuses.filter((s) => s.type === 'task').map((s) => [s.id, s.position]));
  const a = await createItem({ type: 'task', title: `Liste A ${RUN}`, statusId: status('task', 'planned').id });
  const b = await createItem({ type: 'task', title: `Liste B ${RUN}`, statusId: status('task', 'planned').id });
  // B im Board vor A ziehen
  await api('POST', `/items/${b}/move`, { statusId: status('task', 'planned').id, afterId: (await detail(a)).id });

  const list = (await api('GET', '/items?view=tasks')).items;
  assert.ok(list.length > 0);
  assert.ok(list.every((i) => i.type === 'task' && !i.status.closed), 'nur offene Aufgaben');
  const positions = list.map((i) => position.get(i.status.id));
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y), 'nach Status');
  const numbers = list.map((i) => i.number);
  assert.ok(numbers.indexOf(b) < numbers.indexOf(a), 'innerhalb des Status wie im Board');
  // Sortierung per Spaltenkopf geht in der Liste (nach Titel steht A wieder vor B)
  const byTitle = (await api('GET', '/items?view=tasks&sort=title&dir=asc')).items.map((i) => i.number);
  assert.ok(byTitle.indexOf(a) < byTitle.indexOf(b), 'nach Titel sortiert');
});

await step('Typ verwiesener Vorgänge (Fenster oder Seite): Verlauf und Mail-Protokolle', async () => {
  const incident = await createItem({ type: 'incident', title: `Verweis Störung ${RUN}` });
  const task = await createItem({ type: 'task', title: `Verweis Aufgabe ${RUN}` });
  await api('POST', `/items/${incident}/links`, { role: 'relates', otherNumber: task });
  const entry = (await detail(incident)).entries.find((e) => e.meta?.otherNumber === task);
  assert.equal(entry.meta.refType, 'task');
  const back = (await detail(task)).entries.find((e) => e.meta?.otherNumber === incident);
  assert.equal(back.meta.refType, 'incident');

  const outgoing = (await api('GET', '/admin/outgoing-mails')).filter((m) => m.item);
  assert.ok(outgoing.length > 0);
  assert.ok(outgoing.every((m) => m.item.type === null || ['incident', 'task'].includes(m.item.type)));
  assert.ok(outgoing.some((m) => m.item.type === 'incident'));
  const incoming = (await api('GET', '/admin/incoming-mails')).filter((m) => m.item);
  assert.ok(incoming.length > 0);
  assert.ok(incoming.every((m) => 'type' in m.item));
});

await step('Zuletzt aktiv: Anmeldung und Aktionen, nicht automatisches Nachladen, bei «Als Benutzer» der Admin', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const lea = await api('POST', '/admin/users', { name: `Lea Aktiv ${RUN}`, email: `lea-${RUN}@test.local`, role: 'it', password: 'lea-passwort-1' });
  assert.deepEqual([lea.lastLoginAt, lea.lastActiveAt], [null, null], 'noch nie angemeldet');
  const adaCookie = cookie;
  setSessionCookie('');
  await api('POST', '/auth/login', { username: `lea-${RUN}@test.local`, password: 'lea-passwort-1' });
  const leaCookie = cookie;
  setSessionCookie(adaCookie);
  const leaRow = async () => (await api('GET', '/admin/users')).find((u) => u.id === lea.id);
  const loggedIn = await leaRow();
  assert.ok(loggedIn.lastActiveAt, 'Anmeldung zählt als Aktivität');
  assert.equal(loggedIn.lastActiveAt, loggedIn.lastLoginAt);

  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(Zeitreise übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  const HOUR_AGO = `now() - interval '1 hour'`;
  const activeAt = async (id) => (await db.query('select last_active_at from users where id = $1', [id])).rows[0].last_active_at;
  const asLea = (headers = {}) => fetch(`${BASE}/items/counts`, { headers: { cookie: leaCookie, ...headers } });
  try {
    await db.query(`update users set last_active_at = ${HOUR_AGO} where id = $1`, [lea.id]);
    const before = await activeAt(lea.id);
    // Automatisches Nachladen eines offenen Tabs zählt nicht
    assert.equal((await asLea({ 'x-patchwork-background': '1' })).status, 200);
    assert.equal((await activeAt(lea.id)).getTime(), before.getTime(), 'Nachladen zählt nicht');
    // Eine Aktion zählt, höchstens einmal pro Minute geschrieben
    assert.equal((await asLea()).status, 200);
    const now = await activeAt(lea.id);
    assert.ok(Date.now() - now.getTime() < 60_000, 'Aktion zählt');
    await asLea();
    assert.equal((await activeAt(lea.id)).getTime(), now.getTime(), 'innerhalb einer Minute nicht erneut geschrieben');
    assert.equal(new Date((await leaRow()).lastActiveAt).getTime(), now.getTime(), 'in der Benutzerliste');

    // «Als Benutzer arbeiten»: der Admin ist aktiv, nicht der Benutzer
    const ada = (await api('GET', '/auth/me')).user;
    await api('POST', `/admin/users/${lea.id}/impersonate`);
    await db.query(`update users set last_active_at = ${HOUR_AGO} where id = any($1)`, [[lea.id, ada.id]]);
    const leaBefore = await activeAt(lea.id);
    await api('GET', '/items/counts');
    assert.equal((await activeAt(lea.id)).getTime(), leaBefore.getTime(), 'Lea war nicht selbst aktiv');
    assert.ok(Date.now() - (await activeAt(ada.id)).getTime() < 60_000, 'Ada war aktiv');
    await api('POST', '/auth/impersonation/end');
  } finally {
    await db.end();
  }
});

Object.assign(state, { statuses });
