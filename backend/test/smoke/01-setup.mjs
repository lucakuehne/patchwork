// Smoke-Test, Bereich «Einrichtung, Benutzer, Postfach» (läuft über test/smoke.mjs)
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

await step('Healthcheck ohne Anmeldung, Einrichtung erforderlich', async () => {
  assert.deepEqual(await api('GET', '/health'), { status: 'ok' });
  const info = await api('GET', '/public/info');
  assert.equal(info.setupRequired, true);
});

await step('Schreibende Anfrage ohne Header wird abgelehnt', async () => {
  const res = await fetch(BASE + '/setup', { method: 'POST' });
  assert.equal(res.status, 403);
});

await step('Einrichtungs-Assistent legt Admin an', async () => {
  await api('POST', '/setup', { appName: 'Patchwork Test', name: 'Ada Admin', email: 'ada@test.local', password: 'geheim-geheim' });
  const me = await api('GET', '/auth/me');
  assert.equal(me.user.role, 'admin');
  // Vor- und Nachname für {{Bearbeiter Vorname}} und {{Bearbeiter Nachname}} der Textbausteine
  assert.deepEqual([me.user.firstName, me.user.lastName], ['Ada', 'Admin']);
  assert.equal((await api('GET', '/public/info')).setupRequired, false);
  await api('POST', '/setup', { appName: 'x', name: 'x', email: 'x@test.local', password: 'geheim-geheim' }, { expect: [403] });
});

await step('Login und Logout', async () => {
  await api('POST', '/auth/logout');
  await api('GET', '/items/counts', undefined, { expect: [401] });
  await api('POST', '/auth/login', { username: 'ada@test.local', password: 'falsch' }, { expect: [401] });
  await api('POST', '/auth/login', { username: 'ADA@test.local', password: 'geheim-geheim' });
});

await step('IT-Benutzer anlegen', async () => {
  ivan = await api('POST', '/admin/users', { name: 'Ivan IT', email: IVAN, role: 'it', password: 'geheim-geheim' });
  const staff = await api('GET', '/users/staff');
  assert.deepEqual(staff.map((u) => u.name).sort(), ['Ada Admin', 'Ivan IT']);
  statuses = state.statuses = await api('GET', '/statuses');
  // Störung 4, Aufgabe 5 («Offen» gab es vom 21. bis 23.10.2026)
  assert.equal(statuses.length, 9);
  assert.ok(!statuses.some((s) => s.label === 'Offen'), 'kein Status «Offen»');
  // Keine Kategorien mehr: Jeder Status ist offen oder abgeschlossen
  assert.deepEqual(
    statuses.filter((s) => s.closed).map((s) => `${s.type}/${s.key}`).sort(),
    ['incident/resolved', 'task/done', 'task/rejected'],
  );
  assert.ok(statuses.every((s) => !('category' in s)));
  channels = state.channels = await api('GET', '/channels');
  assert.deepEqual(
    channels.map((c) => [c.label, c.icon, c.key]),
    [
      ['E-Mail', 'mail', 'mail'],
      ['Portal', 'portal', 'portal'],
      ['Telefon', 'phone', null],
      ['Persönlich (Walk-In)', 'person', null],
      ['Teams/Chat', 'chat', null],
      ['Sonstiges', 'other', null],
      ['Intern', 'alert', null],
    ],
  );
  // Nach der Einführung für beide Typen ohne Vorbelegung
  assert.deepEqual(await api('GET', '/channels/defaults'), { incident: null, task: null });
});

await step('Vor- und Nachname: aus dem Namen geschätzt oder angegeben, von Hand änderbar', async () => {
  // Ohne Angabe aus dem Namen geschätzt: letztes Wort = Nachname
  assert.deepEqual([ivan.firstName, ivan.lastName], ['Ivan', 'IT']);
  // Angegeben (geschätzt wäre «Berta von» / «Arx»), getrimmt
  const berta = await api('POST', '/admin/users', {
    name: 'Berta von Arx',
    firstName: ' Berta ',
    lastName: 'von Arx',
    email: BERTA,
    role: 'standard',
  });
  assert.deepEqual([berta.name, berta.firstName, berta.lastName], ['Berta von Arx', 'Berta', 'von Arx']);
  // Von Hand geändert, der Name bleibt. In den Mails unten heisst Ivan deshalb «Ivan Informatik».
  const changed = await api('PATCH', `/admin/users/${ivan.id}`, { firstName: 'Ivan', lastName: ' Informatik ' });
  assert.deepEqual([changed.name, changed.firstName, changed.lastName], ['Ivan IT', 'Ivan', 'Informatik']);
  await api('PATCH', `/admin/users/${ivan.id}`, { firstName: 'Ivan', lastName: 'x'.repeat(101) }, { expect: [400] });
  const listed = (await api('GET', '/admin/users')).find((u) => u.id === ivan.id);
  assert.deepEqual([listed.firstName, listed.lastName], ['Ivan', 'Informatik'], 'höchstens 100 Zeichen, unverändert');
  const staff = (await api('GET', '/users/staff')).find((u) => u.id === ivan.id);
  assert.deepEqual([staff.firstName, staff.lastName], ['Ivan', 'Informatik']);
});

await step('Postfach anlegen und testen', async () => {
  const mb = await api('POST', '/admin/mailboxes', {
    name: 'IT Helpdesk',
    address: MAILBOX,
    active: true,
    isDefault: false,
    imapHost: 'localhost',
    imapPort: 13143,
    imapSecure: false,
    imapFolder: 'INBOX',
    smtpHost: 'localhost',
    smtpPort: 13025,
    smtpSecurity: 'none',
    authType: 'password',
    username: MAILBOX,
    password: 'x',
  });
  mailboxId = state.mailboxId = mb.id;
  assert.equal(mb.isDefault, true, 'erstes Postfach wird Standard');
  assert.equal(mb.passwordEnc, undefined, 'Passwort wird nicht ausgeliefert');
  assert.equal(mb.oauthRefreshTokenEnc, undefined, 'Refresh-Token wird nicht ausgeliefert');
  assert.equal(mb.graphSync, undefined, 'Stand des Graph-Abrufs wird nicht ausgeliefert');
  assert.ok(Math.abs(Date.now() - new Date(mb.fetchFrom).getTime()) < 60_000, 'Mails abholen ab: beim Anlegen jetzt');
  const test = await api('POST', `/admin/mailboxes/${mailboxId}/test`);
  assert.equal(test.ok, true, JSON.stringify(test));
  // Ordner zur Auswahl für den Abruf
  const folders = await api('GET', `/admin/mailboxes/${mailboxId}/folders`);
  assert.deepEqual(folders[0], { id: null, path: 'INBOX', names: ['INBOX'], inbox: true }, JSON.stringify(folders));
  await poll(); // Startpunkt setzen
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
