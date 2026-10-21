// Smoke-Test gegen eine laufende Patchwork-Instanz mit leerer Datenbank und einem
// GreenMail-Testserver (SMTP 13025, IMAP 13143, ohne Authentifizierung).
//
//   docker run -d --name patchwork-greenmail -p 13025:3025 -p 13143:3143 \
//     -e "GREENMAIL_OPTS=-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" \
//     greenmail/standalone:2.1.3
//   node test/smoke.mjs [http://localhost:8080]
// HTTPS prüft der Test über HTTPS_PORT der Instanz (Standard 8443, sonst SMOKE_HTTPS_PORT setzen).
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import https from 'node:https';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const BASE = (process.argv[2] ?? 'http://localhost:8080') + '/api';
// HTTPS der Instanz (HTTPS_PORT, Standard 8443)
const HTTPS_PORT = Number(process.env.SMOKE_HTTPS_PORT ?? 8443);
// Eindeutige Adressen pro Lauf: Andere Instanzen, die denselben GreenMail-Server abfragen, stören so nicht
const RUN = Date.now().toString(36);
const MAILBOX = `helpdesk-${RUN}@test.local`;
const ANNA = `anna-${RUN}@test.local`;
const BOB = `bob-${RUN}@test.local`;
const IVAN = `ivan-${RUN}@test.local`;
const CARLA = `carla-${RUN}@test.local`;
const BERTA = `berta-${RUN}@test.local`;
const FREMD = `fremd-${RUN}@test.local`;
const NEWS = `news-${RUN}@shop.test`;

let cookie = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, { expect = [200, 201, 204], raw = false } = {}) {
  const headers = { 'x-patchwork': '1' };
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  const data = text && !raw ? JSON.parse(text) : text;
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return data;
}

const smtp = nodemailer.createTransport({ host: 'localhost', port: 13025, secure: false, ignoreTLS: true });

async function sendMail(opts) {
  const info = await smtp.sendMail({ to: MAILBOX, ...opts });
  return info.messageId;
}

/** Liest alle Mails eines GreenMail-Kontos. */
async function inbox(user) {
  const client = new ImapFlow({ host: 'localhost', port: 13143, secure: false, auth: { user, pass: 'x' }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const mails = [];
  try {
    if (client.mailbox.exists > 0) {
      for await (const msg of client.fetch('1:*', { envelope: true, source: true, headers: ['auto-submitted', 'in-reply-to'] })) {
        mails.push({
          subject: msg.envelope.subject,
          to: msg.envelope.to?.map((a) => a.address) ?? [],
          cc: msg.envelope.cc?.map((a) => a.address) ?? [],
          messageId: msg.envelope.messageId,
          headers: msg.headers?.toString() ?? '',
          source: msg.source?.toString() ?? '',
          // dekodierter Text (Quoted-Printable kann Wörter umbrechen)
          text: msg.source ? ((await simpleParser(msg.source)).text ?? '') : '',
        });
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return mails;
}

async function waitForMail(user, predicate, label) {
  for (let i = 0; i < 30; i++) {
    const found = (await inbox(user)).find(predicate);
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(`Mail nicht erhalten: ${label} (${user})`);
}

async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
}

let mailboxId;
let ivan;
let itemNo;
let statuses;
let channels;
const status = (type, key) => statuses.find((s) => s.type === type && s.key === key);
const channel = (label) => channels.find((c) => c.label === label);
const poll = () => api('POST', `/admin/mailboxes/${mailboxId}/poll`);
const detail = (n) => api('GET', `/items/${n}`);
const loginAs = async (username, password) => {
  await api('POST', '/auth/logout');
  return api('POST', '/auth/login', { username, password });
};
const createItem = async (fields, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ channelId: channel('Telefon').id, ...fields })) f.append(k, v);
  for (const [name, content] of files) f.append('files', new Blob([content]), name);
  return (await api('POST', '/items', f)).number;
};

await step('Einrichtung erforderlich', async () => {
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
  statuses = await api('GET', '/statuses');
  assert.equal(statuses.length, 9);
  // Keine Kategorien mehr: Jeder Status ist offen oder abgeschlossen
  assert.deepEqual(
    statuses.filter((s) => s.closed).map((s) => `${s.type}/${s.key}`).sort(),
    ['incident/resolved', 'task/done', 'task/rejected'],
  );
  assert.ok(statuses.every((s) => !('category' in s)));
  channels = await api('GET', '/channels');
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
  mailboxId = mb.id;
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

let firstMessageId;
await step('Mail mit CC landet im Eingang, Bestätigung an Melder', async () => {
  firstMessageId = await sendMail({
    from: `Anna Muster <${ANNA}>`,
    cc: [BOB, MAILBOX],
    subject: 'VPN verbindet nicht',
    text: 'Seit heute Morgen geht das VPN nicht mehr.',
    html: '<p>Seit heute Morgen geht das <b>VPN</b> nicht mehr.</p><script>alert(1)</script>',
    attachments: [{ filename: 'Fehlermeldung äöü.txt', content: 'Timeout' }],
  });
  await sleep(500);
  await poll();
  const list = await api('GET', '/items?view=inbox');
  assert.equal(list.items.length, 1);
  itemNo = list.items[0].number;
  const item = await detail(itemNo);
  assert.equal(item.type, null);
  assert.equal(item.status, null);
  assert.equal(item.reporter.email, ANNA);
  assert.equal(item.reporter.name, 'Anna Muster');
  assert.deepEqual([item.reporter.firstName, item.reporter.lastName], ['Anna', 'Muster'], 'Kontakt aus Mail: aus dem Namen geschätzt');
  assert.deepEqual(item.participants.map((p) => p.email), [BOB]);
  assert.ok(item.descriptionHtml.includes('<b>VPN</b>'));
  assert.ok(!item.descriptionHtml.includes('script'));
  assert.equal(item.attachments[0].filename, 'Fehlermeldung äöü.txt');
  assert.ok(item.originalMessageId);
  const counts = await api('GET', '/items/counts');
  assert.deepEqual(counts, { inbox: 1, incidents: 0, tasks: 0 });
  const confirmation = await waitForMail(ANNA, (m) => m.subject === `[PW-${itemNo}] VPN verbindet nicht`, 'Bestätigung');
  assert.ok(/auto-submitted: auto-generated/i.test(confirmation.headers));
  // Das Portal ist ohne Einstellung aus: kein Link dorthin
  assert.ok(!confirmation.source.includes('/portal/v/'), 'ohne Portal keine Link-Zeile');
  // Standard-Fusszeile einer neuen Installation: ohne App-Namen
  assert.ok(confirmation.text.includes(`Bitte lassen Sie bei Antworten die Nummer [PW-${itemNo}] im Betreff stehen.`), confirmation.text);
  assert.ok(!confirmation.text.includes('Patchwork Test'), 'kein App-Name in der Mail');
});

await step('Abgeholte Mail bleibt ungelesen im Postfach', async () => {
  const client = new ImapFlow({ host: 'localhost', port: 13143, secure: false, auth: { user: MAILBOX, pass: 'x' }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  const flags = [];
  try {
    for await (const msg of client.fetch('1:*', { flags: true })) flags.push(msg.flags);
  } finally {
    lock.release();
  }
  await client.logout();
  assert.ok(flags.length > 0, 'Mail liegt noch im Postfach');
  assert.ok(flags.every((f) => !f.has('\\Seen')), 'Patchwork markiert Mails nicht als gelesen');
});

await step('Doppelt abgerufene Mail wird nicht doppelt erfasst', async () => {
  await poll();
  assert.equal((await api('GET', '/items?view=inbox')).items.length, 1);
});

await step('Typ zuweisen: Störung mit Status «Neu»', async () => {
  await api('POST', `/items/${itemNo}/type`, { type: 'incident' });
  const item = await detail(itemNo);
  assert.equal(item.type, 'incident');
  assert.equal(item.status.label, 'Neu');
  assert.deepEqual(await api('GET', '/items/counts'), { inbox: 0, incidents: 1, tasks: 0 });
});

await step('Zuweisen: Mail an Zuständigen', async () => {
  await api('PATCH', `/items/${itemNo}`, { assigneeId: ivan.id, priority: 'high' });
  const mail = await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Zugewiesen: VPN verbindet nicht`, 'Zuweisung');
  // Standardtext mit Vor- und Nachname des Melders, Standard-Fusszeile ohne App-Namen
  assert.ok(mail.text.includes(`Melder: Anna Muster (${ANNA})`), mail.text);
  assert.ok(mail.text.includes(`Benachrichtigung zu PW-${itemNo}`), mail.text);
  assert.ok(!mail.text.includes('Patchwork Test'), 'kein App-Name in der Mail');
  const mine = await api('GET', '/items?view=incidents&mine=1');
  assert.equal(mine.items.length, 0, 'Ada ist nicht zuständig');
});

await step('Öffentliche Antwort an Melder (An) und Beteiligte (CC), mit Anhang', async () => {
  const form = new FormData();
  form.append('kind', 'reply');
  form.append('body', 'Bitte starten Sie den **Client** neu.');
  form.append('files', new Blob(['Anleitung']), 'Anleitung.txt');
  await api('POST', `/items/${itemNo}/entries`, form);
  const mail = await waitForMail(ANNA, (m) => m.subject === `[PW-${itemNo}] VPN verbindet nicht` && m.cc.includes(BOB), 'Antwort');
  assert.deepEqual(mail.to, [ANNA]);
  assert.ok(/in-reply-to/i.test(mail.headers), 'Antwort ist im Thread');
  await waitForMail(BOB, (m) => m.subject === `[PW-${itemNo}] VPN verbindet nicht`, 'Antwort CC');
});

await step('Interne Notiz geht nicht raus', async () => {
  const before = (await inbox(ANNA)).length;
  await api('POST', `/items/${itemNo}/entries`, (() => {
    const f = new FormData();
    f.append('kind', 'note');
    f.append('body', 'Intern: Zertifikat abgelaufen?');
    return f;
  })());
  await sleep(4000);
  assert.equal((await inbox(ANNA)).length, before);
});

await step('Antwort des Melders holt den Vorgang aus «Wartet auf Melder»', async () => {
  await api('POST', `/items/${itemNo}/move`, { statusId: status('incident', 'waiting').id });
  const reply = await waitForMail(ANNA, (m) => m.cc.includes(BOB), 'Antwort');
  await sendMail({
    from: ANNA,
    subject: `AW: [PW-${itemNo}] VPN verbindet nicht`,
    text: `Hat leider nicht geholfen.\n\nAm 15.10.2026 um 10:00 schrieb IT Helpdesk <${MAILBOX}>:\n> Bitte starten Sie den Client neu.`,
    inReplyTo: reply.messageId,
    references: [reply.messageId],
  });
  await sleep(500);
  await poll();
  const item = await detail(itemNo);
  assert.equal(item.status.label, 'In Arbeit');
  const last = item.entries.filter((e) => e.kind === 'reply').at(-1);
  assert.equal(last.body, 'Hat leider nicht geholfen.');
  assert.equal(last.author.email, ANNA);
  await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Neue Antwort: VPN verbindet nicht`, 'Neue Antwort');
});

await step('Abwesenheitsnotiz ändert den Status nicht', async () => {
  await api('POST', `/items/${itemNo}/move`, { statusId: status('incident', 'waiting').id });
  await sendMail({
    from: ANNA,
    subject: `Automatische Antwort: [PW-${itemNo}] VPN verbindet nicht`,
    text: 'Ich bin abwesend.',
    headers: { 'Auto-Submitted': 'auto-replied' },
  });
  await sleep(500);
  await poll();
  const item = await detail(itemNo);
  assert.equal(item.status.label, 'Wartet auf Melder');
  assert.equal(item.entries.at(-1).meta.automated, true);
});

await step('Unbeteiligter Dritter mit Nummer im Betreff wird interne Notiz', async () => {
  await sendMail({ from: FREMD, subject: `[PW-${itemNo}] Hallo`, text: 'Ich mische mich ein.' });
  await sleep(500);
  await poll();
  const item = await detail(itemNo);
  const last = item.entries.at(-1);
  assert.equal(last.kind, 'note');
  assert.equal(last.meta.external, true);
  assert.equal(item.status.label, 'Wartet auf Melder');
});

await step('Typwechsel Störung → Aufgabe ohne Wahl: Status nach seiner Rolle', async () => {
  await api('POST', `/items/${itemNo}/type`, { type: 'task' });
  let item = await detail(itemNo);
  assert.equal(item.type, 'task');
  assert.equal(item.status.label, 'In Arbeit', 'Wartet → «nach Antwort», Aufgaben haben keinen Wartet-Status');
  assert.equal(item.entries.at(-1).kind, 'type');
  assert.ok(item.entries.some((e) => e.kind === 'reply'), 'Timeline bleibt erhalten');
  await api('POST', `/items/${itemNo}/type`, { type: 'incident' });
  item = await detail(itemNo);
  assert.equal(item.status.label, 'In Arbeit');
});

await step('Erledigt: Mail an Melder, Antwort öffnet wieder', async () => {
  await api('POST', `/items/${itemNo}/move`, { statusId: status('incident', 'resolved').id });
  const done = await waitForMail(ANNA, (m) => m.subject === `[PW-${itemNo}] Gelöst: VPN verbindet nicht`, 'Gelöst');
  assert.equal((await api('GET', '/items?view=incidents-closed')).items.length, 1);
  await sendMail({ from: ANNA, subject: `Re: ${done.subject}`, text: 'Geht wieder nicht.', inReplyTo: done.messageId });
  await sleep(500);
  await poll();
  const item = await detail(itemNo);
  assert.equal(item.status.label, 'In Arbeit');
  assert.equal(item.closedAt, null);
});

let t1, t2, t3;
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
  const rueckfrage = await api('POST', '/statuses', { type: 'task', label: 'Rückfrage', closed: false });
  const changed = { ...defaults.task, start: t('planned'), waiting: rueckfrage.id };
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
  await api('POST', `/items/${n}/move`, { statusId: rueckfrage.id });
  assert.equal((await answer('Hier die Angaben.')).status.label, 'In Arbeit', '«Antwort des Melders führt in»');
  await api('POST', `/items/${n}/move`, { statusId: t('backlog') });
  const unchanged = await answer('Noch ein Nachtrag.');
  assert.equal(unchanged.status.label, 'Backlog');
  assert.ok(unchanged.entries.some((e) => e.kind === 'reply' && e.body === 'Noch ein Nachtrag.'));

  // Typwechsel ohne Wahl: Wartet → Wartet
  const w = await createItem({ type: 'incident', title: 'Wartet beim Typwechsel' });
  await api('POST', `/items/${w}/move`, { statusId: i('waiting') });
  await api('POST', `/items/${w}/type`, { type: 'task' });
  assert.equal((await detail(w)).status.label, 'Rückfrage', 'Wartet → Wartet');

  // Ziel-Status löschen: nur mit passendem Ersatz für das Ziel, ein freiwilliges Ziel auch ohne
  const removeRueckfrage = (body, opts) => api('DELETE', `/statuses/${rueckfrage.id}`, body, opts);
  assert.match((await removeRueckfrage({ replacementId: t('in_progress') }, { expect: [400] })).message, /Wartet auf den Melder/);
  await removeRueckfrage({ replacementId: t('in_progress'), targets: { waiting: t('in_progress') } }, { expect: [400] });
  await removeRueckfrage({ replacementId: t('in_progress'), targets: { waiting: null } });
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

await step('Typwechsel: Status nach Rolle vorgeschlagen oder gewählt, Ablehnen-Status nur aus dem Ablehnen-Status', async () => {
  const i = (key) => status('incident', key).id;
  const t = (key) => status('task', key).id;
  const setType = (n, type, statusId, opts) => api('POST', `/items/${n}/type`, { type, ...(statusId ? { statusId } : {}) }, opts);
  const label = async (n) => (await detail(n)).status.label;

  // Ohne Wahl: Start → Start, übrige offene → «nach Antwort», abgeschlossene → «Automatisch schliessen in»
  const a = await createItem({ type: 'incident', title: 'Typwechsel A' });
  await setType(a, 'task');
  assert.equal(await label(a), 'Backlog');
  await api('POST', `/items/${a}/move`, { statusId: t('planned') });
  await setType(a, 'incident');
  assert.equal(await label(a), 'In Arbeit');
  await api('POST', `/items/${a}/move`, { statusId: i('resolved') });
  const { closedAt } = await detail(a);
  await setType(a, 'task');
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

  // Ablehnen → Ablehnen; den Ablehnen-Status des Zieltyps gibt es nur aus dem Ablehnen-Status
  await setType(b, 'task');
  assert.equal(await label(b), 'Abgelehnt');
  await setType(b, 'incident', declined.id);
  assert.equal(await label(b), 'Abgewiesen');
  // Ablehnen-Ziel entfernen: Ein Ablehnen-Status ohne Gegenstück im Zieltyp führt in «Automatisch schliessen in»
  await api('DELETE', `/statuses/${declined.id}`, { replacementId: i('resolved'), targets: { reject: null } });
  assert.equal(await label(b), 'Gelöst');
  assert.deepEqual((await api('GET', '/statuses/targets')).incident, incidentTargets);
  await setType(b, 'task', t('rejected'), { expect: [400] });
  const c = await createItem({ type: 'task', title: 'Typwechsel C' });
  await api('POST', `/items/${c}/reject`, { reason: 'Nicht nötig', notify: false });
  await setType(c, 'incident');
  assert.equal(await label(c), 'Gelöst');

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

await step('Newsletter: keine Bestätigung, verwerfen', async () => {
  await sendMail({ from: NEWS, subject: 'Grosser Sale', text: 'Kaufen!', headers: { 'List-Unsubscribe': '<mailto:u@shop.test>' } });
  await sleep(500);
  await poll();
  const list = (await api('GET', '/items?view=inbox')).items;
  assert.equal(list.length, 1);
  await api('POST', `/items/${list[0].number}/discard`, { discarded: true });
  assert.equal((await api('GET', '/items/counts')).inbox, 0);
  await sleep(3000);
  assert.equal((await inbox(NEWS)).length, 0);
});

await step('Stummschalten ist vorläufig ausser Kraft: gespeichert, Mails kommen trotzdem', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: IVAN, password: 'geheim-geheim' });
  await api('PUT', `/items/${itemNo}/mute`, { muted: true });
  assert.equal((await detail(itemNo)).muted, true);
  await sendMail({ from: ANNA, subject: `[PW-${itemNo}] Nachtrag`, text: 'Noch ein Hinweis.' });
  await sleep(500);
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: 'ada@test.local', password: 'geheim-geheim' });
  await poll();
  await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Neue Antwort: VPN verbindet nicht` && m.text.includes('Noch ein Hinweis'), 'trotz Stummschaltung');
});

await step('Beteiligte verwalten', async () => {
  await api('POST', `/items/${itemNo}/participants`, { email: CARLA });
  await api('POST', `/items/${itemNo}/participants`, { email: MAILBOX }, { expect: [400] });
  await api('POST', `/items/${itemNo}/participants`, { email: ANNA }, { expect: [400] });
  let item = await detail(itemNo);
  assert.deepEqual(item.participants.map((p) => p.email).sort(), [BOB, CARLA].sort());
  await api('DELETE', `/items/${itemNo}/participants/${item.participants.find((p) => p.email === BOB).id}`);
  item = await detail(itemNo);
  assert.deepEqual(item.participants.map((p) => p.email), [CARLA]);
});

await step('IT-Benutzer hat keinen Zugriff auf Admin-Funktionen', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: IVAN, password: 'geheim-geheim' });
  await api('GET', '/admin/users', undefined, { expect: [403] });
  await api('POST', '/statuses', { type: 'task', label: 'x', closed: false }, { expect: [403] });
  await api('DELETE', `/statuses/${status('task', 'planned').id}`, {}, { expect: [403] });
  // Die Ziele liest auch die IT (Knopf «Ablehnen», Vorschlag beim Typwechsel), ändern nur der Admin
  const targets = await api('GET', '/statuses/targets');
  assert.equal(targets.task.reject, status('task', 'rejected').id);
  await api('PUT', '/statuses/targets', { type: 'task', targets: targets.task }, { expect: [403] });
  await api('GET', '/items?view=incidents&mine=1');
});

await step('Kontakt ohne Passwort kann sich nicht anmelden', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: ANNA, password: 'egal-egal-egal' }, { expect: [401] });
});

// ---------------------------------------------------------------- Etappe 2

await step('Meldeweg: Pflicht beim Erfassen, automatisch bei Mail, änderbar mit Eintrag, Verwaltung nur für Admin', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const missing = new FormData();
  missing.append('type', 'task');
  missing.append('title', 'Ohne Meldeweg');
  assert.match((await api('POST', '/items', missing, { expect: [400] })).message, /Meldeweg/);
  assert.equal((await detail(itemNo)).channel.label, 'E-Mail');
  assert.deepEqual((await detail(t1)).channel, { id: channel('Telefon').id, label: 'Telefon', icon: 'phone' });
  assert.equal((await api('GET', '/items?view=search&q=Firmware')).items[0].channelId, channel('Telefon').id);

  await api('PATCH', `/items/${t1}`, { channelId: channel('Persönlich (Walk-In)').id });
  const changed = await detail(t1);
  assert.equal(changed.channel.icon, 'person');
  assert.deepEqual(changed.entries.at(-1).meta, { field: 'channel', from: 'Telefon', to: 'Persönlich (Walk-In)' });

  // Verwaltung: hinzufügen, ändern, sortieren, löschen mit Ersatz; E-Mail und Portal bleiben
  const added = await api('POST', '/channels', { label: 'Monitoring', icon: 'alert' });
  await api('POST', '/channels', { label: 'monitoring', icon: 'alert' }, { expect: [400] });
  await api('POST', '/channels', { label: 'Fax', icon: 'unbekannt' }, { expect: [400] });
  assert.equal((await api('PATCH', `/channels/${added.id}`, { label: 'Überwachung', icon: 'video' })).label, 'Überwachung');
  await api('PATCH', `/items/${t1}`, { channelId: added.id });
  assert.equal((await api('GET', '/channels/usage'))[added.id], 1);
  await api('DELETE', `/channels/${added.id}`, undefined, { expect: [400] });
  await api('DELETE', `/channels/${added.id}?replacementId=${channel('Telefon').id}`);
  assert.equal((await detail(t1)).channel.label, 'Telefon');
  await api('DELETE', `/channels/${channel('E-Mail').id}`, undefined, { expect: [400] });
  const ids = (await api('GET', '/channels')).map((c) => c.id);
  await api('PUT', '/channels/order', { ids: [...ids].reverse() });
  assert.equal((await api('GET', '/channels'))[0].id, ids.at(-1));
  await api('PUT', '/channels/order', { ids });
  await api('PUT', '/channels/order', { ids: ids.slice(1) }, { expect: [400] });

  // Vorbelegung je Typ: nur Admin, nicht «Portal»; beim Löschen übernimmt der Ersatz, unbenutzt entfällt sie
  const intern = channel('Intern');
  assert.deepEqual(await api('PUT', '/channels/defaults', { incident: null, task: intern.id }), { incident: null, task: intern.id });
  await api('PUT', '/channels/defaults', { incident: channel('Portal').id, task: null }, { expect: [400] });
  const spare = await api('POST', '/channels', { label: 'Ersatz-Test', icon: 'other' });
  await api('PUT', '/channels/defaults', { incident: spare.id, task: intern.id });
  await api('DELETE', `/channels/${spare.id}`);
  assert.deepEqual(await api('GET', '/channels/defaults'), { incident: null, task: intern.id }, 'unbenutzt: Vorbelegung entfällt');
  const used = await api('POST', '/channels', { label: 'Wird ersetzt', icon: 'other' });
  await api('PUT', '/channels/defaults', { incident: used.id, task: intern.id });
  const usedItem = await createItem({ type: 'incident', title: 'Meldeweg wird ersetzt', channelId: used.id });
  await api('DELETE', `/channels/${used.id}?replacementId=${channel('Telefon').id}`);
  assert.deepEqual(await api('GET', '/channels/defaults'), { incident: channel('Telefon').id, task: intern.id }, 'Ersatz übernimmt');
  assert.equal((await detail(usedItem)).channel.label, 'Telefon');

  await loginAs(IVAN, 'geheim-geheim');
  assert.equal((await api('GET', '/channels')).length, 7);
  assert.deepEqual(await api('GET', '/channels/defaults'), { incident: channel('Telefon').id, task: intern.id });
  await api('PUT', '/channels/defaults', { incident: null, task: null }, { expect: [403] });
  await api('POST', '/channels', { label: 'Brief', icon: 'letter' }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/channels/defaults', { incident: null, task: null });
});

let task;
let taskListId;
await step('Checklisten: anlegen, abhaken, sortieren, Fortschritt in Listen', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  task = await createItem({ type: 'task', title: 'Notebook für Neueintritt' }, [['intern.txt', 'nur IT']]);
  await api('POST', `/items/${task}/checklists`, { title: 'Hardware' });
  let d = await detail(task);
  taskListId = d.checklists[0].id;
  await api('POST', `/checklists/${taskListId}/items`, { text: 'Notebook bestellen' });
  await api('POST', `/checklists/${taskListId}/items`, { text: 'Dockingstation' });
  d = await detail(task);
  const [first] = d.checklists[0].items;
  await api('PATCH', `/checklist-items/${first.id}`, { done: true });
  d = await detail(task);
  assert.equal(d.checklists[0].items[0].done, true);
  assert.equal(d.checklists[0].items[0].doneBy, 'Ada Admin');
  const card = (await api('GET', '/items?view=board')).items.find((i) => i.number === task);
  assert.deepEqual(card.checklist, { done: 1, total: 2 });
  await api('PUT', `/checklists/${taskListId}/items/order`, { ids: d.checklists[0].items.map((i) => i.id).reverse() });
  assert.equal((await detail(task)).checklists[0].items[0].text, 'Dockingstation');
  // Abhaken und Zurücknehmen stehen im Verlauf, Umbenennen nicht
  await api('PATCH', `/checklist-items/${first.id}`, { done: false });
  await api('PATCH', `/checklist-items/${first.id}`, { text: 'Notebook bestellt' });
  const ticks = (await detail(task)).entries.filter((e) => e.kind === 'change').map((e) => e.meta);
  assert.deepEqual(
    ticks.map((m) => [m.field, m.itemId, m.text, m.from, m.to]),
    [
      ['checklistItem', first.id, 'Notebook bestellen', false, true],
      ['checklistItem', first.id, 'Notebook bestellen', true, false],
    ],
  );
  await api('PATCH', `/checklist-items/${first.id}`, { done: true });
  assert.equal((await detail(task)).entries.at(-1).meta.text, 'Notebook bestellt');
  // Nicht im Portal: dort erscheinen nur Antworten und mitgeteilte Ablehnungen
});

await step('Fälligkeit: nur Aufgaben, im Verlauf, auf dem Board, beim Typwechsel ausgeblendet', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ type: 'task', title: 'Mit Fälligkeit', channelId: channel('Intern').id, dueDate: '2026-12-24' })) f.append(k, v);
  const due = (await api('POST', '/items', f)).number;
  assert.equal((await detail(due)).dueDate, '2026-12-24');
  assert.equal((await api('GET', '/items?view=board')).items.find((i) => i.number === due).dueDate, '2026-12-24');
  await api('PATCH', `/items/${due}`, { dueDate: '2026-12-31' });
  assert.deepEqual((await detail(due)).entries.at(-1).meta, { field: 'dueDate', from: '24.12.2026', to: '31.12.2026' });
  await api('PATCH', `/items/${due}`, { dueDate: 'morgen' }, { expect: [400] });
  await api('PATCH', `/items/${due}`, { dueDate: null });
  assert.deepEqual((await detail(due)).entries.at(-1).meta, { field: 'dueDate', from: '31.12.2026', to: null });
  await api('PATCH', `/items/${due}`, { dueDate: '2027-01-15' });
  // Bei Störungen ausgeblendet (bleibt gespeichert), nicht änderbar; zurück zur Aufgabe wieder da
  await api('POST', `/items/${due}/type`, { type: 'incident' });
  let d = await detail(due);
  assert.equal(d.dueDate, null);
  assert.equal(d.entries.at(-1).meta.dueDate, 'hidden');
  await api('PATCH', `/items/${due}`, { dueDate: '2027-02-01' }, { expect: [400] });
  await api('POST', `/items/${due}/type`, { type: 'task' });
  d = await detail(due);
  assert.equal(d.dueDate, '2027-01-15');
  assert.equal(d.entries.at(-1).meta.dueDate, 'shown');
  // Beim Erfassen einer Störung wird kein Datum gespeichert
  const g = new FormData();
  for (const [k, v] of Object.entries({ type: 'incident', title: 'Störung ohne Fälligkeit', channelId: channel('Intern').id, dueDate: '2026-12-24' })) g.append(k, v);
  const incident = (await api('POST', '/items', g)).number;
  await api('POST', `/items/${incident}/type`, { type: 'task' });
  assert.equal((await detail(incident)).dueDate, null);
});

await step('Mail bei Fälligkeit: einmal pro Datum an den Zuständigen, nur offene Aufgaben', async () => {
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(d);
  };
  const make = async (title, fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ type: 'task', title, channelId: channel('Intern').id, ...fields })) f.append(k, v);
    return (await api('POST', '/items', f)).number;
  };
  // Alles, was schon fällig ist, vorher abarbeiten (andere Schritte)
  await api('POST', '/admin/rules/run-due');
  const overdue = await make(`Fällig gestern ${RUN}`, { dueDate: day(-1), assigneeId: ivan.id });
  await make(`Fällig morgen ${RUN}`, { dueDate: day(1), assigneeId: ivan.id });
  await make(`Fällig ohne Zuständigen ${RUN}`, { dueDate: day(-1) });
  const closed = await make(`Fällig erledigt ${RUN}`, { dueDate: day(-1), assigneeId: ivan.id, statusId: status('task', 'done').id });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 1 });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 0 }, 'nur einmal pro Datum');
  const mail = await waitForMail(IVAN, (m) => m.subject === `[PW-${overdue}] Fällig: Fällig gestern ${RUN}`, 'Mail bei Fälligkeit');
  assert.ok(mail.text.includes(`ist am ${day(-1).split('-').reverse().join('.')} fällig`), mail.text);
  // Neues Datum (heute oder früher): wieder eine Mail; wieder geöffnete erledigte Aufgabe ebenso
  await api('PATCH', `/items/${overdue}`, { dueDate: day(-2) });
  await api('POST', `/items/${closed}/move`, { statusId: status('task', 'in_progress').id });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 2 });
  // Nicht im Verlauf (Mails an die IT erscheinen dort nicht)
  assert.ok(!(await detail(overdue)).mails.some((m) => m.template === 'dueReminder'));
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', '/admin/rules/run-due', undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

let mentionTask;
await step('Board-Karte: Beschreibung und Anzahl Kommentare (Antworten und Notizen)', async () => {
  mentionTask = await createItem({ type: 'task', title: `Erwähnen ${RUN}`, description: '## Ablauf\n\n**Zuerst** sichern', reporterId: (await api('GET', '/users/staff')).find((u) => u.email === 'ada@test.local').id });
  const card = async () => (await api('GET', '/items?view=board')).items.find((i) => i.number === mentionTask);
  assert.equal((await card()).descriptionPreview, '## Ablauf\n\n**Zuerst** sichern');
  assert.equal((await card()).commentCount, 0);
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', 'Erste Notiz');
  await api('POST', `/items/${mentionTask}/entries`, note);
  await api('PATCH', `/items/${mentionTask}`, { priority: 'high' });
  assert.equal((await card()).commentCount, 1, 'Änderungen zählen nicht');
  const empty = await createItem({ type: 'task', title: `Ohne Beschreibung ${RUN}` });
  assert.equal((await api('GET', '/items?view=board')).items.find((i) => i.number === empty).descriptionPreview, null);
});

await step('Erwähnen: Mail «Erwähnt» an die IT, nicht an sich selbst, beim Melder als Text', async () => {
  const staff = await api('GET', '/users/staff');
  const ada = staff.find((u) => u.email === 'ada@test.local');
  const anna = (await detail(itemNo)).reporter;
  const mention = (u, label) => `[@${label}](mention:${u.id})`;
  const before = (await inbox('ada@test.local')).length;

  // Interne Notiz: Ivan erhält die Mail, Ada (Verfasserin) und Anna (keine IT) nicht
  const noteText = `Bitte ${mention(ivan, 'Ivan IT')} und ${mention(ada, 'Ada Admin')} und ${mention(anna, 'Anna Muster')} prüfen ${RUN}`;
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', noteText);
  await api('POST', `/items/${mentionTask}/entries`, note);
  const mail = await waitForMail(IVAN, (m) => m.subject === `[PW-${mentionTask}] Erwähnt: Erwähnen ${RUN}`, 'Erwähnt');
  assert.ok(mail.text.includes(`Ada Admin hat Sie in PW-${mentionTask} «Erwähnen ${RUN}» erwähnt (interne Notiz)`), mail.text);
  assert.ok(mail.text.includes(`Bitte @Ivan IT und @Ada Admin und @Anna Muster prüfen ${RUN}`), mail.text);
  assert.ok(!mail.text.includes('mention:'), 'ohne Link-Ziel');
  await sleep(1500);
  assert.equal((await inbox('ada@test.local')).length, before, 'keine Mail an sich selbst');
  assert.ok(!(await inbox(ANNA)).some((m) => m.subject.includes('Erwähnt')), 'keine Mail an Melder');

  // Notiz bearbeiten: nur neu Erwähnte erhalten die Mail, bereits Erwähnte nicht noch einmal
  const entry = (await detail(mentionTask)).entries.find((e) => e.body === noteText);
  const count = async () => (await inbox(IVAN)).filter((m) => m.subject === `[PW-${mentionTask}] Erwähnt: Erwähnen ${RUN}`).length;
  await api('PATCH', `/entries/${entry.id}`, { body: `${noteText} – ergänzt` });
  await sleep(1500);
  assert.equal(await count(), 1, 'beim Bearbeiten keine zweite Mail an bereits Erwähnte');

  // Öffentliche Antwort an Anna mit Erwähnung: Anna sieht «@Ivan IT» als Text, Ivan erhält «Erwähnt»
  const replyText = `Wir klären das mit ${mention(ivan, 'Ivan IT')} ${RUN}`;
  const reply = new FormData();
  reply.append('kind', 'reply');
  reply.append('body', replyText);
  await api('POST', `/items/${itemNo}/entries`, reply);
  const toAnna = await waitForMail(ANNA, (m) => m.text.includes(`Wir klären das mit @Ivan IT ${RUN}`), 'Antwort mit Erwähnung');
  assert.ok(!toAnna.source.includes('mention:'), 'kein Link-Ziel in der Mail an den Melder');
  await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Erwähnt: VPN verbindet nicht` && m.text.includes('(öffentliche Antwort)'), 'Erwähnt in Antwort');
});

await step('Abschliessen mit offenen Punkten nur nach Bestätigung, Ablehnen ohne', async () => {
  const conflict = await api('POST', `/items/${task}/move`, { statusId: status('task', 'done').id }, { expect: [409] });
  assert.equal(conflict.code, 'OPEN_CHECKLIST');
  assert.equal(conflict.open, 1);
  assert.equal((await detail(task)).status.label, 'Backlog');
  await api('POST', `/items/${task}/move`, { statusId: status('task', 'done').id, force: true });
  assert.equal((await detail(task)).status.label, 'Erledigt');
  await api('POST', `/items/${task}/move`, { statusId: status('task', 'in_progress').id });

  const other = await createItem({ type: 'task', title: 'Wird abgelehnt' });
  await api('POST', `/items/${other}/checklists`, { title: 'Offen' });
  const list = (await detail(other)).checklists[0].id;
  await api('POST', `/checklists/${list}/items`, { text: 'offener Punkt' });
  await api('POST', `/items/${other}/reject`, { reason: 'Nicht nötig', notify: false });
  assert.equal((await detail(other)).status.label, 'Abgelehnt');
  // Aus dem Ablehnen-Status in einen abgeschlossenen Status gilt ebenfalls als Abschliessen
  const fromRejected = await api('POST', `/items/${other}/move`, { statusId: status('task', 'done').id }, { expect: [409] });
  assert.equal(fromRejected.code, 'OPEN_CHECKLIST');
  assert.equal((await detail(other)).status.label, 'Abgelehnt');
});

await step('Typwechsel blendet Checklisten aus und wieder ein', async () => {
  await api('POST', `/items/${task}/type`, { type: 'incident' });
  let d = await detail(task);
  assert.deepEqual(d.checklists, []);
  assert.equal(d.entries.at(-1).meta.checklists, 'hidden');
  await api('POST', `/checklists/${taskListId}/items`, { text: 'bei Störung' }, { expect: [400] });
  await api('POST', `/items/${task}/type`, { type: 'task' });
  d = await detail(task);
  assert.equal(d.checklists.length, 1);
  assert.equal(d.checklists[0].items.length, 2);
  assert.equal(d.entries.at(-1).meta.checklists, 'shown');
});

await step('Checklisten-Vorlagen: nur Admin verwaltet, IT fügt ein', async () => {
  await api('POST', '/admin/checklist-templates', { name: 'Neuer Mitarbeiter', items: ['AD-Konto anlegen', '  ', 'Mailbox einrichten'] });
  const template = (await api('GET', '/checklist-templates')).find((t) => t.name === 'Neuer Mitarbeiter');
  assert.deepEqual(template.items, ['AD-Konto anlegen', 'Mailbox einrichten']);
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', '/admin/checklist-templates', { name: 'x', items: ['y'] }, { expect: [403] });
  await api('POST', `/items/${task}/checklists/from-template`, { templateId: template.id });
  const inserted = (await detail(task)).checklists.find((c) => c.title === 'Neuer Mitarbeiter');
  assert.deepEqual(
    inserted.items.map((i) => i.text),
    ['AD-Konto anlegen', 'Mailbox einrichten'],
  );
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Verknüpfungen: beidseitig sichtbar, Timeline, keine Doppelten', async () => {
  const a = await createItem({ type: 'task', title: 'Verknüpfung A' });
  await api('POST', `/items/${a}/links`, { role: 'relates', otherNumber: task });
  const da = await detail(a);
  const dt = await detail(task);
  assert.equal(da.links[0].role, 'relates');
  assert.equal(dt.links[0].role, 'relates');
  assert.equal(dt.links[0].other.number, a);
  assert.equal(dt.entries.at(-1).meta.field, 'linkAdded');
  await api('POST', `/items/${task}/links`, { role: 'fixes', otherNumber: a }, { expect: [409] });
  await api('POST', `/items/${a}/links`, { role: 'relates', otherNumber: a }, { expect: [400] });
  await api('DELETE', `/items/${a}/links/${da.links[0].id}`);
  assert.equal((await detail(task)).links.length, 0);
  assert.equal((await detail(task)).entries.at(-1).meta.field, 'linkRemoved');
});

await step('Behebende Aufgabe erledigt: Eintrag und Mail an Zuständigen der Störung', async () => {
  const incident = await createItem({ type: 'incident', title: 'Drucker 2. OG', assigneeId: ivan.id });
  const fix = await createItem({ type: 'task', title: 'Toner bestellen' });
  await api('POST', `/items/${fix}/links`, { role: 'fixes', otherNumber: incident });
  assert.equal((await detail(incident)).links[0].role, 'fixedBy');
  await api('POST', `/items/${fix}/move`, { statusId: status('task', 'done').id });
  const d = await detail(incident);
  assert.equal(d.entries.at(-1).meta.field, 'fixCompleted');
  assert.equal(d.entries.at(-1).meta.otherNumber, fix);
  assert.equal(d.status.label, 'Neu', 'kein automatisches Schliessen');
  await waitForMail(IVAN, (m) => m.subject === `[PW-${incident}] Behebender Vorgang erledigt: Drucker 2. OG`, 'Behebt-Hinweis');
});

await step('Duplikate: keine Ketten', async () => {
  const [x, y, z] = [
    await createItem({ type: 'incident', title: 'Dup X' }),
    await createItem({ type: 'incident', title: 'Dup Y' }),
    await createItem({ type: 'incident', title: 'Dup Z' }),
  ];
  await api('POST', `/items/${x}/links`, { role: 'duplicateOf', otherNumber: y });
  await api('POST', `/items/${y}/links`, { role: 'duplicateOf', otherNumber: z }, { expect: [400] });
  await api('POST', `/items/${z}/links`, { role: 'duplicateOf', otherNumber: x }, { expect: [400] });
  await api('POST', `/items/${x}/links`, { role: 'duplicateOf', otherNumber: z }, { expect: [400, 409] });
  assert.equal((await detail(y)).links[0].role, 'hasDuplicate');
});

let dupOriginal;
let dupSame;
let dupOther;
const inboxNumber = async (title) => (await api('GET', '/items?view=inbox')).items.find((i) => i.title === title).number;

await step('Duplikat vom gleichen Melder: zusammengeführt, Hinweis-Mail, Antworten beim Original', async () => {
  await sendMail({ from: ANNA, subject: 'Drucker 3. OG', text: 'Der Drucker im 3. OG druckt nicht.' });
  await sleep(500);
  await poll();
  dupOriginal = await inboxNumber('Drucker 3. OG');
  await api('POST', `/items/${dupOriginal}/type`, { type: 'incident' });
  await sendMail({
    from: ANNA,
    subject: 'Nochmals Drucker',
    text: 'Es kommt Papierstau.',
    attachments: [{ filename: 'stau.txt', content: 'Stau' }],
  });
  await sleep(500);
  await poll();
  dupSame = await inboxNumber('Nochmals Drucker');
  const confirmation = await waitForMail(ANNA, (m) => m.subject === `[PW-${dupSame}] Nochmals Drucker`, 'Bestätigung');

  await api('POST', `/items/${dupSame}/links`, { role: 'duplicateOf', otherNumber: dupOriginal });
  const dup = await detail(dupSame);
  assert.equal(dup.type, 'incident', 'Typ vom Original übernommen');
  assert.deepEqual([dup.status.label, dup.status.closed], ['Gelöst', true], '«Automatisch schliessen in»');
  assert.ok(dup.closedAt);
  assert.equal(dup.entries.at(-1).meta.duplicateOf, dupOriginal);
  assert.equal(dup.entries.at(-1).meta.merged, true);
  const original = await detail(dupOriginal);
  const merged = original.entries.find((e) => e.meta?.source === 'merge');
  assert.equal(merged.body, 'Es kommt Papierstau.');
  assert.equal(merged.author.email, ANNA);
  assert.equal(merged.attachments[0].filename, 'stau.txt');
  assert.equal(original.status.label, 'Neu', 'Original bleibt unverändert');
  await waitForMail(
    ANNA,
    (m) => m.subject === `[PW-${dupOriginal}] Drucker 3. OG` && m.text.includes('wurde dort hinzugefügt'),
    'Hinweis zusammengeführt',
  );
  assert.ok(!(await inbox(ANNA)).some((m) => m.subject.startsWith(`[PW-${dupSame}] Gelöst`)), 'keine Gelöst-Mail');

  await sendMail({
    from: ANNA,
    subject: `Re: ${confirmation.subject}`,
    text: 'Noch ein Detail.',
    inReplyTo: confirmation.messageId,
    references: [confirmation.messageId],
  });
  await sleep(500);
  await poll();
  assert.ok((await detail(dupOriginal)).entries.some((e) => e.kind === 'reply' && e.body === 'Noch ein Detail.'));
  assert.ok(!(await detail(dupSame)).entries.some((e) => e.body === 'Noch ein Detail.'));
});

await step('Duplikat von anderem Melder: umgeleitet, Melder und CC werden Beteiligte beim Original', async () => {
  // Mit Portal enthält der Hinweis den Link zum Duplikat
  await api('PUT', '/settings/portal', { access: 'all', emails: [], groupDn: '' });
  await sendMail({ from: BOB, cc: [CARLA], subject: 'Drucker 3. OG streikt', text: 'Bei mir auch.' });
  await sleep(500);
  await poll();
  dupOther = await inboxNumber('Drucker 3. OG streikt');
  // diesmal aus Sicht des Originals verknüpft
  await api('POST', `/items/${dupOriginal}/links`, { role: 'hasDuplicate', otherNumber: dupOther });
  const dup = await detail(dupOther);
  assert.deepEqual([dup.status.label, dup.status.closed], ['Gelöst', true]);
  assert.equal(dup.entries.at(-1).meta.merged, false);
  const original = await detail(dupOriginal);
  assert.deepEqual(original.participants.map((u) => u.email).sort(), [BOB, CARLA].sort());
  assert.equal(original.entries.filter((e) => e.meta?.viaDuplicate === dupOther).length, 2);
  const redirect = await waitForMail(
    BOB,
    (m) => m.subject === `[PW-${dupOriginal}] Drucker 3. OG` && m.text.includes('wird dort weiterbearbeitet'),
    'Umleitung',
  );
  assert.deepEqual(redirect.to, [BOB]);
  assert.deepEqual(redirect.cc, [CARLA]);
  assert.match(redirect.text, new RegExp(`/portal/v/${dupOther}\\b`));
  // Im Verlauf beim Original und beim Duplikat; ansehen geht unter beiden Nummern, unter anderen nicht
  const inOriginal = (await detail(dupOriginal)).mails.find((m) => m.template === 'duplicateRedirected');
  const inDuplicate = (await detail(dupOther)).mails.find((m) => m.template === 'duplicateRedirected');
  assert.ok(inOriginal && inDuplicate && inOriginal.id === inDuplicate.id, 'Hinweis in beiden Verläufen');
  assert.deepEqual(inDuplicate.to.map((r) => r.email), [BOB]);
  assert.deepEqual(inDuplicate.cc.map((r) => r.email), [CARLA]);
  assert.equal((await api('GET', `/items/${dupOther}/mails/${inDuplicate.id}`)).label, 'Duplikat: im Original weiterbearbeitet');
  await api('GET', `/items/${dupOriginal}/mails/${inDuplicate.id}`);
  await api('GET', `/items/${dupSame}/mails/${inDuplicate.id}`, undefined, { expect: [404] });
  // Der zusammengeführte Hinweis steht ebenso beim ersten Duplikat
  assert.ok((await detail(dupSame)).mails.some((m) => m.template === 'duplicateMerged'), 'Hinweis beim zusammengeführten Duplikat');

  const f = new FormData();
  f.append('kind', 'reply');
  f.append('body', 'Techniker ist unterwegs.');
  await api('POST', `/items/${dupOriginal}/entries`, f);
  await waitForMail(BOB, (m) => m.cc.includes(BOB) && m.text.includes('Techniker ist unterwegs'), 'CC an Bob');

  await sendMail({ from: BOB, subject: `Re: ${redirect.subject}`, text: 'Danke!', inReplyTo: redirect.messageId });
  await sleep(500);
  await poll();
  const reply = (await detail(dupOriginal)).entries.find((e) => e.body === 'Danke!');
  assert.equal(reply.kind, 'reply');
  assert.equal(reply.author.email, BOB);
  await api('PUT', '/settings/portal', { access: 'none', emails: [], groupDn: '' });
});

await step('Duplikat: Original muss offen sein und einer der beiden einen Typ haben', async () => {
  await sendMail({ from: ANNA, subject: 'Eingang eins', text: 'eins' });
  await sendMail({ from: ANNA, subject: 'Eingang zwei', text: 'zwei' });
  await sleep(500);
  await poll();
  const one = await inboxNumber('Eingang eins');
  const two = await inboxNumber('Eingang zwei');
  await api('POST', `/items/${two}/links`, { role: 'duplicateOf', otherNumber: one }, { expect: [400] });
  assert.equal((await detail(t1)).status.closed, true);
  const closed = await api('POST', `/items/${one}/links`, { role: 'duplicateOf', otherNumber: t1 }, { expect: [400] });
  assert.match(closed.message, /bereits abgeschlossen/);
  assert.equal((await detail(one)).links.length, 0);
  for (const n of [one, two]) await api('POST', `/items/${n}/discard`, { discarded: true });
});

let anna;
await step('Portal freischalten: aus, nur ausgewählte, für alle', async () => {
  assert.deepEqual(await api('GET', '/settings/portal'), { access: 'none', emails: [], groupDn: '' });
  anna = (await api('GET', '/admin/users')).find((u) => u.email === ANNA);
  await api('PATCH', `/admin/users/${anna.id}`, { password: 'anna-passwort-1' });
  await api('POST', '/auth/logout');
  const refused = await api('POST', '/auth/login', { username: ANNA, password: 'anna-passwort-1' }, { expect: [403] });
  assert.match(refused.message, /nicht freigeschaltet/);

  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/portal', { access: 'selected', emails: [ANNA.toUpperCase()], groupDn: '' });
  assert.deepEqual((await api('GET', '/settings/portal')).emails, [ANNA]);
  await loginAs(ANNA, 'anna-passwort-1');
  assert.equal((await api('GET', '/portal/items?state=open')).some((i) => i.number === itemNo), true);
  // Wird der Zugang entzogen, gilt das sofort, auch für die laufende Sitzung
  const annaCookie = cookie;
  cookie = ''; // Annas Sitzung nicht abmelden
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/portal', { access: 'selected', emails: [], groupDn: '' });
  const adaCookie = cookie;
  cookie = annaCookie;
  assert.match((await api('GET', '/portal/items?state=open', undefined, { expect: [403] })).message, /nicht freigeschaltet/);
  cookie = adaCookie;
  // IT und Admins sind nicht betroffen
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/portal/items?state=open');
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/portal', { access: 'all', emails: [], groupDn: '' });
  await api('PUT', '/settings/portal', { access: 'irgendwer', emails: [] }, { expect: [400] });
});

await step('Portal: Standard-Benutzer mit Passwort meldet sich an, hat keinen IT-Zugriff', async () => {
  const me = await loginAs(ANNA, 'anna-passwort-1');
  assert.equal(me.role, 'standard');
  assert.equal((await api('GET', '/auth/me')).user.role, 'standard');
  await api('GET', '/items?view=inbox', undefined, { expect: [403] });
  await api('GET', '/items/counts', undefined, { expect: [403] });
  await api('GET', `/items/${itemNo}`, undefined, { expect: [403] });
});

await step('Portal: nur eigene Vorgänge und nur Öffentliches', async () => {
  const open = await api('GET', '/portal/items?state=open');
  // Der Melder sieht den internen Statusnamen mit seiner Farbe
  const inProgress = { label: 'In Arbeit', color: 'orange', closed: false, waiting: false };
  assert.deepEqual(open.find((i) => i.number === itemNo).status, inProgress);
  const d = await api('GET', `/portal/items/${itemNo}`);
  assert.deepEqual(d.status, inProgress);
  assert.ok(d.entries.every((e) => e.kind === 'reply'));
  assert.ok(!JSON.stringify(d).includes('Zertifikat abgelaufen'), 'interne Notiz unsichtbar');
  assert.ok(!JSON.stringify(d).includes('Ich mische mich ein'), 'Notiz von Unbeteiligten unsichtbar');
  assert.ok(!JSON.stringify(d).includes('Ich bin abwesend'), 'Abwesenheitsnotiz unsichtbar');
  assert.ok(d.entries.some((e) => e.own), 'eigene Antworten');
  assert.ok(d.entries.some((e) => e.author === 'IT'), 'Antworten der IT ohne Namen');
  const closed = await api('GET', '/portal/items?state=closed');
  assert.ok(closed.some((i) => i.number === t2) && closed.some((i) => i.number === t3));
  assert.ok(closed.every((i) => i.status.closed) && open.every((i) => !i.status.closed));
  const notified = await api('GET', `/portal/items/${t3}`);
  assert.deepEqual(notified.status, { label: 'Abgelehnt', color: 'red', closed: true, waiting: false });
  assert.ok(notified.entries.some((e) => e.kind === 'rejected' && e.body.includes('Wird extern gelöst')));
  const silent = await api('GET', `/portal/items/${t2}`);
  assert.ok(!silent.entries.some((e) => e.kind === 'rejected'), 'Begründung ohne «Melder informieren» unsichtbar');
  await api('GET', `/portal/items/${task}`, undefined, { expect: [404] });

  // Eine Antwort auf eine abgelehnte Aufgabe öffnet sie nicht wieder
  const f = new FormData();
  f.append('body', 'Warum abgelehnt?');
  await api('POST', `/portal/items/${t3}/replies`, f);
  const answered = await api('GET', `/portal/items/${t3}`);
  assert.deepEqual(answered.status, notified.status);
  assert.equal(answered.closedAt, notified.closedAt);
  assert.ok(answered.entries.some((e) => e.own && e.body === 'Warum abgelehnt?'));
});

await step('Portal: Anhänge nur aus eigenen, öffentlichen Inhalten', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const own = await detail(itemNo);
  const foreign = await detail(task);
  await loginAs(ANNA, 'anna-passwort-1');
  await api('GET', `/portal/attachments/${own.attachments[0].id}`, undefined, { raw: true });
  const replyFile = own.entries.find((e) => e.kind === 'reply' && e.attachments.length).attachments[0];
  await api('GET', `/portal/attachments/${replyFile.id}`, undefined, { raw: true });
  await api('GET', `/portal/attachments/${foreign.attachments[0].id}`, undefined, { expect: [404], raw: true });
  await api('GET', `/attachments/${own.attachments[0].id}`, undefined, { expect: [403], raw: true });
});

let portalItem;
await step('Portal: neue Meldung landet mit Vorschlag im Eingang, Bestätigung mit Portal-Link', async () => {
  const f = new FormData();
  f.append('type', 'incident');
  f.append('title', 'Bildschirm flackert');
  f.append('description', 'Seit heute\r\nflackert er.');
  f.append('files', new Blob(['Foto']), 'foto.txt');
  portalItem = (await api('POST', '/portal/items', f)).number;
  const d = await api('GET', `/portal/items/${portalItem}`);
  assert.deepEqual(d.status, { label: 'Eingegangen', color: 'blue', closed: false, waiting: false });
  assert.equal(d.description, 'Seit heute\nflackert er.');
  assert.equal(d.attachments.length, 1);
  const mail = await waitForMail(ANNA, (m) => m.subject === `[PW-${portalItem}] Bildschirm flackert`, 'Bestätigung Portal');
  assert.match(mail.source, new RegExp(`/portal/v/${portalItem}`));

  await loginAs('ada@test.local', 'geheim-geheim');
  const inboxItem = (await api('GET', '/items?view=inbox')).items.find((i) => i.number === portalItem);
  assert.equal(inboxItem.suggestedType, 'incident');
  assert.equal(inboxItem.source, 'portal');
  assert.equal(inboxItem.channelId, channel('Portal').id, 'Meldeweg Portal');
  await api('POST', `/items/${portalItem}/type`, { type: 'incident' });
  assert.equal((await detail(portalItem)).suggestedType, null);
});

await step('Portal: Antwort holt aus «Wartet auf Melder» zurück und informiert den Zuständigen', async () => {
  await api('PATCH', `/items/${portalItem}`, { assigneeId: ivan.id });
  await api('POST', `/items/${portalItem}/move`, { statusId: status('incident', 'waiting').id });
  await loginAs(ANNA, 'anna-passwort-1');
  // Der Wartet-Status ist hervorgehoben
  assert.deepEqual((await api('GET', `/portal/items/${portalItem}`)).status, {
    label: 'Wartet auf Melder',
    color: 'gray',
    closed: false,
    waiting: true,
  });
  const f = new FormData();
  f.append('body', 'Neustart hat nicht geholfen.');
  await api('POST', `/portal/items/${portalItem}/replies`, f);
  await loginAs('ada@test.local', 'geheim-geheim');
  const d = await detail(portalItem);
  assert.equal(d.status.label, 'In Arbeit');
  const reply = d.entries.filter((e) => e.kind === 'reply').at(-1);
  assert.equal(reply.meta.source, 'portal');
  assert.equal(d.entries.at(-1).meta.via, 'portal');
  await waitForMail(IVAN, (m) => m.subject === `[PW-${portalItem}] Neue Antwort: Bildschirm flackert`, 'Neue Antwort Portal');
});

await step('Portal: fremde Vorgänge bleiben unsichtbar', async () => {
  const bob = (await api('GET', '/admin/users')).find((u) => u.email === BOB);
  await api('PATCH', `/admin/users/${bob.id}`, { password: 'bob-passwort-12' });
  await loginAs(BOB, 'bob-passwort-12');
  await api('GET', `/portal/items/${portalItem}`, undefined, { expect: [404] });
  assert.ok(!(await api('GET', '/portal/items?state=open')).some((i) => i.number === portalItem));
  const f = new FormData();
  f.append('body', 'Hallo');
  await api('POST', `/portal/items/${portalItem}/replies`, f, { expect: [404] });
});

await step('Portal: Duplikate zeigen den Hinweis aufs Original, keine Antwort möglich', async () => {
  const bobsDuplicate = await api('GET', `/portal/items/${dupOther}`);
  assert.deepEqual(bobsDuplicate.duplicateOf, { number: dupOriginal, title: 'Drucker 3. OG', accessible: false });
  await api('GET', `/portal/items/${dupOriginal}`, undefined, { expect: [404] });
  await loginAs(ANNA, 'anna-passwort-1');
  const annasDuplicate = await api('GET', `/portal/items/${dupSame}`);
  assert.equal(annasDuplicate.duplicateOf.accessible, true);
  assert.deepEqual(annasDuplicate.status, { label: 'Gelöst', color: 'green', closed: true, waiting: false });
  const f = new FormData();
  f.append('body', 'Hallo');
  await api('POST', `/portal/items/${dupSame}/replies`, f, { expect: [400] });
  const original = await api('GET', `/portal/items/${dupOriginal}`);
  assert.ok(original.entries.some((e) => e.own && e.body === 'Es kommt Papierstau.'), 'zusammengeführte Meldung sichtbar');
});

await step('Wieder geöffnetes Duplikat: Umleitung endet', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('POST', `/items/${dupOther}/move`, { statusId: status('incident', 'in_progress').id });
  const confirmation = await waitForMail(BOB, (m) => m.subject === `[PW-${dupOther}] Drucker 3. OG streikt`, 'Bestätigung');
  await sendMail({ from: BOB, subject: `Re: ${confirmation.subject}`, text: 'Doch etwas anderes.', inReplyTo: confirmation.messageId });
  await sleep(500);
  await poll();
  assert.ok((await detail(dupOther)).entries.some((e) => e.kind === 'reply' && e.body === 'Doch etwas anderes.'));
  assert.ok(!(await detail(dupOriginal)).entries.some((e) => e.body === 'Doch etwas anderes.'));
  await loginAs(BOB, 'bob-passwort-12');
  assert.equal((await api('GET', `/portal/items/${dupOther}`)).duplicateOf, null);
});

// ---------------------------------------------------------------- Rückmeldungen 15.10.2026

await step('Eigene interne Notiz kurz nach dem Erfassen bearbeiten', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const f = new FormData();
  f.append('kind', 'note');
  f.append('body', 'Erster Endwurf');
  await api('POST', `/items/${itemNo}/entries`, f);
  const note = (await detail(itemNo)).entries.filter((e) => e.kind === 'note').at(-1);
  assert.equal(note.editedAt, null);
  await api('PATCH', `/entries/${note.id}`, { body: 'Erster Entwurf' });
  const edited = (await detail(itemNo)).entries.find((e) => e.id === note.id);
  assert.equal(edited.body, 'Erster Entwurf');
  assert.ok(edited.editedAt);
  assert.ok((await api('GET', '/items?view=search&q=Entwurf')).items.some((i) => i.number === itemNo), 'Suche kennt den neuen Text');
  await api('PATCH', `/entries/${note.id}`, { body: '  ' }, { expect: [400] });
  const reply = (await detail(itemNo)).entries.find((e) => e.kind === 'reply' && e.author?.email === 'ada@test.local');
  await api('PATCH', `/entries/${reply.id}`, { body: 'geändert' }, { expect: [403] });
  await loginAs(IVAN, 'geheim-geheim');
  await api('PATCH', `/entries/${note.id}`, { body: 'Ivan war hier' }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Antwort-Postfach: ein Eintrag pro Postfach, Verlauf nennt das tatsächliche Postfach', async () => {
  const support = await api('POST', '/admin/mailboxes', {
    name: 'Support',
    address: `support-${RUN}@test.local`,
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
    username: `support-${RUN}@test.local`,
    password: 'x',
  });
  const options = await api('GET', '/mailboxes');
  assert.deepEqual(options.filter((m) => m.isDefault).map((m) => m.id), [mailboxId]);
  // «Kein eigenes Postfach» und das Standard-Postfach sind dasselbe: kein Eintrag im Verlauf
  const count = (await detail(itemNo)).entries.length;
  await api('PATCH', `/items/${itemNo}`, { mailboxId: null });
  assert.equal((await detail(itemNo)).mailbox, null);
  assert.equal((await detail(itemNo)).entries.length, count);
  await api('PATCH', `/items/${itemNo}`, { mailboxId: support.id });
  const last = (await detail(itemNo)).entries.at(-1);
  assert.deepEqual([last.meta.field, last.meta.from, last.meta.to], ['mailbox', MAILBOX, `support-${RUN}@test.local`]);
  await api('PATCH', `/items/${itemNo}`, { mailboxId });
  await api('DELETE', `/admin/mailboxes/${support.id}`);
});

await step('Personensuche: Name und E-Mail in Patchwork, ohne Verzeichnis', async () => {
  // Jedes Wort muss in Name oder E-Mail vorkommen, die Reihenfolge spielt keine Rolle
  const result = await api('GET', `/people/search?q=${encodeURIComponent('muster ANNA')}`);
  assert.equal(result.directoryError, null);
  assert.deepEqual(
    result.people.map((p) => [p.email, p.source, !!p.id]),
    [[ANNA, 'patchwork', true]],
  );
  assert.ok((await api('GET', `/people/search?q=${encodeURIComponent(BOB)}`)).people.some((p) => p.email === BOB));
  await api('POST', `/items/${itemNo}/participants`, { email: `neu-${RUN}@test.local`, name: 'Nora Neu' });
  const nora = (await detail(itemNo)).participants.find((p) => p.name === 'Nora Neu');
  assert.deepEqual([nora.firstName, nora.lastName], ['Nora', 'Neu'], 'neuer Kontakt: aus dem Namen geschätzt');
});

// ---------------------------------------------------------------- Etappe 3

const LIEFERANT = `verkauf@lieferant-${RUN}.test`;
const STUMM = `stumm-${RUN}@test.local`;
const GEWINN = `gewinn-${RUN}@test.local`;
const cond = (field, operator, value) => ({ kind: 'condition', field, operator, value });
const group = (op, ...children) => ({ kind: 'group', op, children });
const byTitle = async (title) => {
  const lists = await Promise.all(['inbox', 'incidents', 'board'].map((v) => api('GET', `/items?view=${v}`)));
  return lists.flatMap((l) => l.items).find((i) => i.title === title);
};

let lieferantRule;
await step('Regeln: Mail vom Lieferanten wird Aufgabe mit Priorität, Zuständigem und Checkliste (UND/ODER)', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const template = (await api('GET', '/checklist-templates')).find((t) => t.name === 'Neuer Mitarbeiter');
  lieferantRule = await api('POST', '/admin/rules', {
    name: 'Lieferant',
    active: true,
    triggers: ['mail_new'],
    // Domain des Lieferanten ODER (Betreff «Bestellung» UND Text ohne «Newsletter»)
    conditions: group(
      'or',
      cond('sender', 'domain', `@lieferant-${RUN}.test`),
      group('and', cond('subject', 'contains', 'bestellung'), cond('body', 'notContains', 'newsletter')),
    ),
    actions: { type: 'task', priority: 'high', assigneeId: ivan.id, checklistTemplateId: template.id },
  });
  await sendMail({ from: LIEFERANT, subject: 'Lieferschein 4711', text: 'Anbei der Lieferschein.' });
  await sendMail({ from: CARLA, subject: 'Bestellung Monitor', text: 'Bitte einen Monitor bestellen.' });
  await sendMail({ from: CARLA, subject: 'Bestellung Newsletter', text: 'Unser Newsletter zur Bestellung.' });
  await sleep(500);
  await poll();

  const item = await byTitle('Lieferschein 4711');
  const d = await detail(item.number);
  assert.equal(d.type, 'task');
  assert.equal(d.status.label, 'Backlog');
  assert.equal(d.priority, 'high');
  assert.equal(d.assignee.email, IVAN);
  assert.equal(d.checklists[0].title, 'Neuer Mitarbeiter');
  const entry = d.entries.find((e) => e.meta?.field === 'rule');
  assert.equal(entry.meta.ruleName, 'Lieferant');
  assert.equal(entry.author, null);
  await waitForMail(
    IVAN,
    (m) => m.subject === `[PW-${item.number}] Zugewiesen: Lieferschein 4711` && m.text.includes('Regel «Lieferant»'),
    'Zuweisung durch Regel',
  );
  assert.equal((await detail((await byTitle('Bestellung Monitor')).number)).type, 'task', 'ODER-Zweig');
  assert.equal((await detail((await byTitle('Bestellung Newsletter')).number)).type, null, 'UND mit «enthält nicht»');

  const preview = await api('POST', '/admin/rules/preview', { triggers: ['mail_new'], conditions: lieferantRule.conditions });
  assert.deepEqual(
    preview.hits.map((h) => h.title).sort(),
    ['Bestellung Monitor', 'Lieferschein 4711'],
  );
});

await step('Regeln: Verwerfen ohne Bestätigung, Bestätigung unterdrücken, Reihenfolge', async () => {
  await api('POST', '/admin/rules', {
    name: 'Spam',
    triggers: ['mail_new'],
    conditions: group('and', cond('subject', 'contains', 'Gewinnspiel')),
    actions: { discard: true },
  });
  await api('POST', '/admin/rules', {
    name: 'Ohne Bestätigung',
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', STUMM)),
    actions: { suppressConfirmation: true, priority: 'high' },
  });
  // Von oben nach unten: die spätere Regel gewinnt
  await api('POST', '/admin/rules', {
    name: 'Später: Priorität tief',
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', STUMM)),
    actions: { priority: 'low' },
  });
  await sendMail({ from: GEWINN, subject: 'Gewinnspiel', text: 'Sie haben gewonnen!' });
  await sendMail({ from: STUMM, subject: 'Ohne Antwort bitte', text: 'Nur zur Info.' });
  await sleep(500);
  await poll();
  const inboxItems = (await api('GET', '/items?view=inbox')).items;
  assert.ok(!inboxItems.some((i) => i.title === 'Gewinnspiel'), 'verworfen');
  const quiet = inboxItems.find((i) => i.title === 'Ohne Antwort bitte');
  assert.equal(quiet.priority, 'low');
  const rulesApplied = (await detail(quiet.number)).entries.filter((e) => e.meta?.field === 'rule').map((e) => e.meta.ruleName);
  assert.deepEqual(rulesApplied, ['Ohne Bestätigung', 'Später: Priorität tief']);
  await sleep(3000);
  assert.equal((await inbox(GEWINN)).length, 0, 'keine Bestätigung für Verworfenes');
  assert.equal((await inbox(STUMM)).length, 0, 'Bestätigung unterdrückt');
});

await step('Regeln: Antwort mit «dringend» setzt Priorität, Typ nur im Eingang', async () => {
  await api('POST', '/admin/rules', {
    name: 'Dringend',
    triggers: ['mail_reply', 'portal_reply'],
    conditions: group('and', cond('body', 'contains', 'dringend')),
    actions: { type: 'incident', priority: 'high' },
  });
  const quiet = await byTitle('Ohne Antwort bitte');
  await sendMail({ from: STUMM, subject: `Re: [PW-${quiet.number}] Ohne Antwort bitte`, text: 'Jetzt ist es doch dringend!' });
  // bestehende Aufgabe: Typ bleibt, Priorität wird hoch
  const task1 = await byTitle('Bestellung Monitor');
  await api('PATCH', `/items/${task1.number}`, { priority: 'low' });
  await sendMail({ from: CARLA, subject: `Re: [PW-${task1.number}] Bestellung Monitor`, text: 'Bitte dringend!' });
  await sleep(500);
  await poll();
  const d = await detail(quiet.number);
  assert.equal(d.type, 'incident');
  assert.equal(d.priority, 'high');
  const t = await detail(task1.number);
  assert.equal(t.type, 'task');
  assert.equal(t.priority, 'high');
});

await step('Regeln: neue Portal-Meldung, Verwaltung nur für Admin', async () => {
  await api('POST', '/admin/rules', {
    name: 'Portal Anna',
    triggers: ['portal_new'],
    conditions: group('and', cond('sender', 'is', ANNA)),
    actions: { assigneeId: ivan.id },
  });
  await api('POST', '/admin/rules', { name: 'Leer', triggers: [], conditions: group('and'), actions: { priority: 'low' } }, { expect: [400] });
  await api('POST', '/admin/rules', { name: 'Ohne Aktion', triggers: ['mail_new'], conditions: group('and'), actions: {} }, { expect: [400] });
  await loginAs(ANNA, 'anna-passwort-1');
  const f = new FormData();
  f.append('type', 'incident');
  f.append('title', 'Maus defekt');
  const number = (await api('POST', '/portal/items', f)).number;
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/rules', undefined, { expect: [403] });
  assert.equal((await detail(number)).assignee.email, IVAN);
  await loginAs('ada@test.local', 'geheim-geheim');
  // Reihenfolge ändern und ausschalten
  const all = await api('GET', '/admin/rules');
  await api('PUT', '/admin/rules/order', { ids: all.map((r) => r.id).reverse() });
  assert.equal((await api('GET', '/admin/rules'))[0].id, all.at(-1).id);
  await api('PATCH', `/admin/rules/${lieferantRule.id}/active`, { active: false });
  assert.equal((await api('GET', '/admin/rules')).find((r) => r.id === lieferantRule.id).active, false);
});

await step('Zeitgesteuerte Regeln: erinnern, schliessen und eskalieren', async () => {
  const rule = (name, schedule, conditions, actions) => api('POST', '/admin/rules', { name, schedule, conditions, actions });
  const invalid = (schedule, actions) => api('POST', '/admin/rules', { name: 'x', schedule, conditions: group('and'), actions }, { expect: [400] });
  const neu = status('incident', 'new').id;
  // Erinnern/Schliessen nur mit «Wartet auf den Melder» allein
  await invalid({ days: 1, statusIds: [neu], waiting: false }, { close: true });
  await invalid({ days: 1, statusIds: [neu], waiting: true }, { remindReporter: true });
  // Mindestens ein Status, nur bestehende und offene
  await invalid({ days: 1, statusIds: [], waiting: false }, { priority: 'high' });
  assert.match((await invalid({ days: 1, statusIds: [status('incident', 'resolved').id] }, { priority: 'high' })).message, /offene Status/);
  assert.match((await invalid({ days: 1, statusIds: [webcrypto.randomUUID()] }, { priority: 'high' })).message, /existiert nicht/);
  // Nicht Ereignis und Zeit gleichzeitig
  await api(
    'POST',
    '/admin/rules',
    {
      name: 'x',
      triggers: ['mail_new'],
      schedule: { days: 1, statusIds: [], waiting: true },
      conditions: group('and'),
      actions: { priority: 'high' },
    },
    { expect: [400] },
  );
  const created = [
    await rule('Erinnern', { days: 1, statusIds: [], waiting: true }, group('and'), { remindReporter: true }),
    await rule('Schliessen', { days: 3, statusIds: [], waiting: true }, group('and'), { close: true }),
    // Status beider Typen
    await rule(
      'Eskalation',
      { days: 2, statusIds: [neu, status('task', 'backlog').id], waiting: false },
      group('and', cond('subject', 'contains', 'eskalation')),
      { priority: 'high', assigneeId: ivan.id },
    ),
  ];
  assert.deepEqual(created[0].schedule, { days: 1, statusIds: [], waiting: true });
  const waiting = await createItem({ type: 'incident', title: 'Wartet lange', reporterId: anna.id });
  await api('POST', `/items/${waiting}/move`, { statusId: status('incident', 'waiting').id });
  const fresh = await createItem({ type: 'incident', title: 'Eskalation Drucker', reporterId: anna.id });
  const freshTask = await createItem({ type: 'task', title: 'Eskalation Lieferung', reporterId: anna.id });
  assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 0, reminded: 0, closed: 0 }, 'noch zu früh');

  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(Zeitreise übersprungen, SMOKE_DATABASE_URL fehlt) ');
  } else {
    const { default: pg } = await import('pg');
    const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
    await db.connect();
    const back = (number, days) =>
      db.query(`update items set status_changed_at = now() - $1::interval where number = $2`, [`${days} days`, number]);
    try {
      await back(waiting, 2);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 1, closed: 0 });
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 0, reminded: 0, closed: 0 }, 'nur einmal erinnern');
      await waitForMail(
        ANNA,
        (m) => m.subject === `[PW-${waiting}] Erinnerung: Wartet lange` && m.text.includes('Ohne Rückmeldung schliessen wir'),
        'Erinnerung',
      );
      const reminded = (await detail(waiting)).entries.at(-1);
      assert.equal(reminded.meta.ruleName, 'Erinnern');

      await back(fresh, 3);
      await back(freshTask, 3);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 2, reminded: 0, closed: 0 });
      for (const n of [fresh, freshTask]) {
        const escalated = await detail(n);
        assert.equal(escalated.priority, 'high');
        assert.equal(escalated.assignee.email, IVAN);
      }

      await back(waiting, 4);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 0, closed: 1 }, 'schliessen statt erneut erinnern');
      const d = await detail(waiting);
      assert.equal(d.status.label, 'Gelöst', '«Automatisch schliessen in»');
      assert.ok(d.closedAt);
      assert.equal(d.entries.at(-1).meta.ruleName, 'Schliessen');
      await waitForMail(
        ANNA,
        (m) => m.subject === `[PW-${waiting}] Gelöst: Wartet lange` && m.text.includes('keine Rückmeldung erhalten'),
        'Automatisch geschlossen',
      );
      const preview = await api('POST', '/admin/rules/preview', { schedule: created[2].schedule, conditions: created[2].conditions });
      assert.deepEqual(
        preview.hits.map((h) => [h.number, h.kind]).sort(),
        [
          [fresh, 'due'],
          [freshTask, 'due'],
        ].sort(),
      );
    } finally {
      await db.end();
    }
  }
  for (const r of created) await api('DELETE', `/admin/rules/${r.id}`);
});

await step('Zeitgesteuerte Regeln: Status löschen ersetzt ihn in den Regeln oder entfernt ihn', async () => {
  const neu = status('incident', 'new').id;
  const inProgress = status('incident', 'in_progress').id;
  const add = (label) => api('POST', '/statuses', { type: 'incident', label, closed: false });
  const [supplier, vendor, customer] = [await add('Beim Lieferanten'), await add('Beim Hersteller'), await add('Beim Kunden')];
  // Passt auf keinen Vorgang, damit die Regeln nichts verändern
  const never = group('and', cond('subject', 'contains', `nie-${RUN}`));
  const rule = (name, statusIds, waiting = false) =>
    api('POST', '/admin/rules', { name, schedule: { days: 30, statusIds, waiting }, conditions: never, actions: { priority: 'high' } });
  const created = [
    await rule('Mit Ersatz', [supplier.id, neu]),
    await rule('Nur gelöschter', [vendor.id]),
    await rule('Mit Wartet', [vendor.id], true),
    await rule('Ersatz abgeschlossen', [customer.id]),
  ];
  const usage = await api('GET', '/statuses/rules-usage');
  assert.deepEqual(usage[supplier.id], ['Mit Ersatz']);
  assert.deepEqual([...usage[vendor.id]].sort(), ['Mit Wartet', 'Nur gelöschter']);
  // Zeitgesteuerte Regeln gelten nur für offene Status
  assert.match((await api('PATCH', `/statuses/${supplier.id}`, { closed: true }, { expect: [400] })).message, /Mit Ersatz/);

  await api('DELETE', `/statuses/${supplier.id}`, { replacementId: inProgress });
  await api('DELETE', `/statuses/${vendor.id}`, {});
  const item = await createItem({ type: 'incident', title: 'Beim Kunden', statusId: customer.id });
  await api('DELETE', `/statuses/${customer.id}`, { replacementId: status('incident', 'resolved').id });
  const d = await detail(item);
  assert.equal(d.status.label, 'Gelöst');
  assert.ok(d.closedAt);

  const rules = await api('GET', '/admin/rules');
  const state = (r) => {
    const { schedule, active } = rules.find((x) => x.id === r.id);
    return [schedule.statusIds, schedule.waiting, active];
  };
  assert.deepEqual(state(created[0]), [[neu, inProgress], false, true], 'offener Ersatz tritt an die Stelle');
  assert.deepEqual(state(created[1]), [[], false, false], 'ohne Status ausgeschaltet');
  assert.deepEqual(state(created[2]), [[], true, true], 'mit «Wartet auf den Melder» bleibt sie aktiv');
  assert.deepEqual(state(created[3]), [[], false, false], 'abgeschlossener Ersatz fällt weg');
  assert.deepEqual(await api('GET', '/statuses/rules-usage'), { [neu]: ['Mit Ersatz'], [inProgress]: ['Mit Ersatz'] });
  for (const r of created) await api('DELETE', `/admin/rules/${r.id}`);
});

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

const EXTERN = `extern-${RUN}@test.local`;
const ARCHIV = `archiv-${RUN}@test.local`;
const archivMailbox = (fetchFrom) => ({
  name: 'Archiv',
  address: ARCHIV,
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
  username: ARCHIV,
  password: 'x',
  ...(fetchFrom ? { fetchFrom } : {}),
});

await step('Mails abholen ab: nur Mails ab dem Startzeitpunkt, nach Vorverlegen ohne doppelte Vorgänge', async () => {
  const before = `Vor dem Start ${RUN}`;
  const after = `Nach dem Start ${RUN}`;
  const inInbox = async (title) => (await api('GET', '/items?view=inbox')).items.filter((i) => i.title === title).length;
  await smtp.sendMail({ from: EXTERN, to: ARCHIV, subject: before, text: 'Schon älter.' });
  await sleep(1500);
  const mb = await api('POST', '/admin/mailboxes', archivMailbox());
  const pollArchiv = () => api('POST', `/admin/mailboxes/${mb.id}/poll`);
  await pollArchiv();
  await smtp.sendMail({ from: EXTERN, to: ARCHIV, subject: after, text: 'Neu.' });
  await sleep(500);
  await pollArchiv();
  assert.equal(await inInbox(before), 0, 'Mail vor dem Startzeitpunkt wird nicht übernommen');
  assert.equal(await inInbox(after), 1);

  // Startzeitpunkt vorverlegen: Die ältere Mail wird nachgeholt, die neuere nicht doppelt erfasst
  await api('PUT', `/admin/mailboxes/${mb.id}`, archivMailbox(new Date(Date.now() - 10 * 60_000).toISOString()));
  await pollArchiv();
  assert.equal(await inInbox(before), 1);
  assert.equal(await inInbox(after), 1);
  await api('DELETE', `/admin/mailboxes/${mb.id}`);
});

await step('Protokoll: versendete Mails stehen vollständig unter «Ausgehende Mails»', async () => {
  const sent = await api('GET', '/admin/outgoing-mails?status=sent');
  const confirmation = sent.find((m) => !m.reply && m.item.number === itemNo && m.to.includes(ANNA));
  assert.ok(confirmation, 'Eingangsbestätigung an den Melder im Protokoll');
  assert.equal(confirmation.status, 'sent');
  assert.deepEqual(confirmation.deliveredTo, [ANNA]);
  assert.ok(confirmation.sentAt);
  const eml = await fetch(`${BASE}/admin/outgoing-mails/${confirmation.id}/eml`, { headers: { cookie } });
  assert.match(await eml.text(), /^Message-ID: <pw\./im);
  assert.ok((await api('GET', '/admin/outgoing-mails')).length >= sent.length, 'ohne Filter alle Mails');

  // Im Verlauf: automatische Mails an Melder und Beteiligte, nicht die Benachrichtigungen an die IT
  const { mails } = await detail(itemNo);
  const inTimeline = mails.find((m) => m.template === 'confirmation');
  assert.ok(inTimeline, 'Eingangsbestätigung im Verlauf');
  assert.equal(inTimeline.label, 'Eingangsbestätigung');
  const logged = sent.find((m) => m.id === inTimeline.id);
  assert.ok(logged && !logged.reply, 'dieselbe Mail im Protokoll');
  assert.equal(inTimeline.status, 'sent');
  assert.deepEqual(inTimeline.to.map((r) => r.email), [ANNA]);
  assert.ok(inTimeline.to[0].name, 'Empfänger mit Namen');
  assert.ok(mails.some((m) => m.template === 'done' && m.label === 'Erledigt'), 'Erledigt-Mail im Verlauf');
  const staffMails = (await api('GET', '/admin/outgoing-mails')).filter((m) => m.item.number === itemNo && m.to.includes(IVAN));
  assert.ok(staffMails.length > 0, 'Benachrichtigung an die IT im Protokoll');
  assert.ok(staffMails.every((s) => !mails.some((m) => m.id === s.id)), 'Benachrichtigungen an die IT nicht im Verlauf');
  assert.ok(mails.every((m) => ['confirmation', 'done', 'rejected', 'duplicateMerged', 'duplicateRedirected', 'waitingReminder', 'waitingClosed'].includes(m.template)));

  // Ansehen: auch für IT-Mitarbeitende, nur unter dem eigenen Vorgang
  await loginAs(IVAN, 'geheim-geheim');
  const view = await api('GET', `/items/${itemNo}/mails/${inTimeline.id}`);
  assert.equal(view.label, 'Eingangsbestätigung');
  assert.deepEqual(view.to, [ANNA]);
  assert.equal(view.subject, logged.subject);
  assert.match(view.html, /border-top/, 'HTML mit den Formatierungen der Vorlage (Fusszeile)');
  const viewEml = await fetch(`${BASE}/items/${itemNo}/mails/${inTimeline.id}/eml`, { headers: { cookie } });
  assert.match(await viewEml.text(), /^Message-ID: <pw\./im);
  await api('GET', `/items/${itemNo + 1}/mails/${inTimeline.id}`, undefined, { expect: [404] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Versandfehler: Vermerk im Verlauf, «Erneut senden» mit den korrigierten Postfach-Daten', async () => {
  const BROKEN = `defekt-${RUN}@test.local`;
  const FIXED = `repariert-${RUN}@test.local`;
  const box = (address, smtpPort) => ({
    name: 'Defekt',
    address,
    active: true,
    isDefault: false,
    imapHost: 'localhost',
    imapPort: 13143,
    imapSecure: false,
    imapFolder: 'INBOX',
    smtpHost: 'localhost',
    smtpPort,
    smtpSecurity: 'none',
    authType: 'password',
    username: address,
    password: 'x',
  });
  // Port 1: Verbindung abgelehnt
  const mb = await api('POST', '/admin/mailboxes', box(BROKEN, 1));
  await api('PATCH', `/items/${itemNo}`, { mailboxId: mb.id });
  const text = `Versandfehler ${RUN}`;
  const form = new FormData();
  form.append('kind', 'reply');
  form.append('body', text);
  await api('POST', `/items/${itemNo}/entries`, form);
  let failed;
  for (let i = 0; i < 30 && !failed; i++) {
    const entry = (await detail(itemNo)).entries.find((e) => e.body === text);
    if (entry.delivery?.status === 'failed') failed = entry;
    else await sleep(1000);
  }
  assert.ok(failed, 'Vermerk «Versand fehlgeschlagen» bei der Antwort');
  assert.ok(failed.delivery.error, 'mit Fehlermeldung');
  const before = await api('GET', `/items/${itemNo}/mails/${failed.mailId}`);
  assert.deepEqual([before.status, before.fromAddress], ['failed', BROKEN]);

  // Postfach korrigiert (Adresse und SMTP), dann «Erneut senden»: neu zusammengestellt mit der neuen Absenderadresse
  await api('PUT', `/admin/mailboxes/${mb.id}`, box(FIXED, 13025));
  await api('POST', `/admin/outgoing-mails/${failed.mailId}/resend`);
  const received = await waitForMail(ANNA, (m) => m.text.includes(text), 'erneut gesendete Antwort');
  assert.match(received.source, new RegExp(`^From: .*${FIXED}`, 'im'), 'Absender aus dem korrigierten Postfach');
  let after;
  for (let i = 0; i < 10 && after?.status !== 'sent'; i++) {
    after = await api('GET', `/admin/outgoing-mails/${failed.mailId}`);
    if (after.status !== 'sent') await sleep(500);
  }
  assert.equal(after.status, 'sent');
  assert.equal(after.fromAddress, FIXED);
  assert.equal(after.attempts, 2);
  const eml = await fetch(`${BASE}/items/${itemNo}/mails/${failed.mailId}/eml`, { headers: { cookie } });
  assert.match(await eml.text(), new RegExp(`^From: .*${FIXED}`, 'im'), 'Protokoll zeigt die versendete Fassung');
  assert.equal((await detail(itemNo)).entries.find((e) => e.body === text).delivery, null, 'kein Vermerk mehr');

  await api('PATCH', `/items/${itemNo}`, { mailboxId });
  await api('DELETE', `/admin/mailboxes/${mb.id}`);
});

await step('Testbetrieb: keine Mails, Liste und Vermerk zeigen, was versendet worden wäre', async () => {
  await api('PUT', '/settings/mail', { staff: 'none', others: 'none' });
  const info = await api('GET', '/public/info');
  assert.equal(info.testMode, true);
  assert.deepEqual(info.delivery, { staff: 'none', others: 'none' });
  const text = `Antwort im Testbetrieb ${RUN}`;
  const form = new FormData();
  form.append('kind', 'reply');
  form.append('body', text);
  form.append('files', new Blob(['Inhalt']), 'Beilage.txt');
  await api('POST', `/items/${itemNo}/entries`, form);
  // Gleich nach dem Senden im Protokoll und im Verlauf («Mail ansehen»), noch bevor der Versand sie abholt
  const justSent = (await detail(itemNo)).entries.find((e) => e.body === text);
  assert.ok(justSent.mailId, 'Mail sofort mit der Antwort verknüpft');
  assert.ok(['queued', 'held'].includes(justSent.delivery?.status), `Vermerk sofort: ${justSent.delivery?.status}`);

  let held;
  for (let i = 0; i < 30 && !held; i++) {
    held = (await api('GET', '/admin/outgoing-mails?status=held,partial')).find((m) => m.reply && m.item.number === itemNo);
    if (!held) await sleep(1000);
  }
  assert.ok(held, 'Antwort steht in der Liste der nicht versendeten Mails');
  assert.equal(held.status, 'held');
  assert.deepEqual(held.to, [ANNA]);
  assert.ok(held.cc.includes(CARLA), 'Beteiligte in CC');
  assert.equal(held.subject, `[PW-${itemNo}] VPN verbindet nicht`);
  const full = await api('GET', `/admin/outgoing-mails/${held.id}`);
  assert.ok(full.text.includes(text));
  assert.deepEqual(full.attachments.map((a) => a.filename), ['Beilage.txt']);
  const attachment = await fetch(`${BASE}/admin/outgoing-mails/${held.id}/attachments/0`, { headers: { cookie } });
  assert.equal(await attachment.text(), 'Inhalt');
  const eml = await fetch(`${BASE}/admin/outgoing-mails/${held.id}/eml`, { headers: { cookie } });
  assert.equal(eml.status, 200);
  assert.match(await eml.text(), /^Message-ID: <pw\./im);
  assert.deepEqual(held.deliveredTo, []);
  const replyEntry = (await detail(itemNo)).entries.find((e) => e.body === text);
  const vermerk = replyEntry.delivery;
  assert.equal(vermerk.status, 'held', 'Vermerk in der Timeline');
  assert.ok(vermerk.withheld.includes(ANNA));
  // «Mail ansehen» bei der Antwort: die Mail, wie sie ohne Testbetrieb versendet würde, mit Anhang
  assert.equal(replyEntry.mailId, held.id);
  const sentView = await api('GET', `/items/${itemNo}/mails/${held.id}`);
  assert.equal(sentView.label, 'Öffentliche Antwort');
  assert.equal(sentView.status, 'held');
  assert.ok(sentView.cc.includes(CARLA));
  assert.ok(sentView.text.includes(text));
  assert.deepEqual(sentView.attachments.map((a) => a.filename), ['Beilage.txt']);
  const sentAttachment = await fetch(`${BASE}/items/${itemNo}/mails/${held.id}/attachments/0`, { headers: { cookie } });
  assert.equal(await sentAttachment.text(), 'Inhalt');
  assert.ok(!(await detail(itemNo)).mails.some((m) => m.id === held.id), 'Antworten erscheinen nicht als eigene Mail-Zeile');
  await api('POST', `/admin/outgoing-mails/${held.id}/resend`, undefined, { expect: [400] });
  await sleep(1500);
  assert.ok(!(await inbox(ANNA)).some((m) => m.text.includes(text)), 'Mail ist nicht beim Melder angekommen');

  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/outgoing-mails', undefined, { expect: [403] });
  await api('PUT', '/settings/mail', { staff: 'all', others: 'all' }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Testbetrieb teilweise: nur freigegebene Empfänger erhalten die Mail, ohne die übrigen im Kopf', async () => {
  await api('PUT', '/settings/mail', { staff: 'all', others: 'selected', otherEmails: [CARLA.toUpperCase()] });
  const settings = await api('GET', '/settings/mail');
  assert.deepEqual(settings.otherEmails, [CARLA], 'Adressen klein geschrieben');
  assert.deepEqual((await api('GET', '/public/info')).delivery, { staff: 'all', others: 'selected' });

  const text = `Teilweise versendet ${RUN}`;
  const form = new FormData();
  form.append('kind', 'reply');
  form.append('body', text);
  await api('POST', `/items/${itemNo}/entries`, form);

  const received = await waitForMail(CARLA, (m) => m.text.includes(text), 'Antwort an die freigegebene Beteiligte');
  assert.deepEqual(received.to, [], 'Der Melder steht nicht im Kopf');
  assert.deepEqual(received.cc, [CARLA]);
  const partial = (await api('GET', '/admin/outgoing-mails?status=partial')).find((m) => m.reply && m.deliveredTo.includes(CARLA));
  assert.ok(partial, 'Vollständige Mail in der Liste');
  assert.deepEqual(partial.to, [ANNA]);
  const vermerk = (await detail(itemNo)).entries.find((e) => e.body === text).delivery;
  assert.equal(vermerk.status, 'partial');
  assert.deepEqual(vermerk.deliveredTo, [CARLA]);
  assert.ok(vermerk.withheld.includes(ANNA));
  await sleep(1500);
  assert.ok(!(await inbox(ANNA)).some((m) => m.text.includes(text)), 'Melder hat die Mail nicht erhalten');

  await api('PUT', '/settings/mail', { staff: 'all', others: 'all' });
  assert.equal((await api('GET', '/public/info')).testMode, false);
});

await step('E-Mail-Vorlagen: Platzhalter mit Vor- und Nachname, ohne {{App}}, Vorschau und zurück zum Standard', async () => {
  const templates = await api('GET', '/admin/mail-templates');
  const template = (key) => templates.find((t) => t.key === key);
  const names = (key) => template(key).placeholders.map((p) => p.name);
  assert.equal(template('confirmation').custom, false);
  for (const name of ['Nummer', 'Melder Vorname', 'Melder Nachname', 'Zuständig Vorname', 'Zuständig Nachname']) {
    assert.ok(names('confirmation').includes(name), `Eingangsbestätigung: {{${name}}}`);
  }
  assert.ok(names('assigned').includes('Zuständig Vorname') && names('assigned').includes('Zuständig Nachname'));
  // {{Melder}} und {{Zuständig}} (ganzer Name) und {{App}} gibt es nicht mehr, in keiner Vorlage
  for (const t of templates) {
    assert.deepEqual(t.placeholders.map((p) => p.name).filter((n) => ['Melder', 'Zuständig', 'App'].includes(n)), [], t.key);
  }
  // Standard-Fusszeilen einer neuen Installation: ohne App-Namen
  assert.deepEqual(
    ['reporterFooter', 'staffFooter'].map((key) => [template(key).body, template(key).custom]),
    [
      ['Bitte lassen Sie bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.', false],
      ['Benachrichtigung zu {{Nummer}}', false],
    ],
  );

  // Vorschau mit Beispieldaten (Melder Anna Muster, Zuständig Ivan IT)
  const preview = await api('POST', '/admin/mail-templates/confirmation/preview', {
    subject: 'Eingang: {{Titel}}',
    body: 'Nr. {{Nummer}} von {{Melder Vorname}} {{Melder Nachname}} für {{Zuständig Vorname}} {{Zuständig Nachname}}',
  });
  assert.equal(preview.subject, '[PW-123] Eingang: Drucker druckt nicht');
  assert.match(preview.html, /Nr\. PW-123/);
  assert.ok(preview.text.includes('Nr. PW-123 von Anna Muster für Ivan IT'), preview.text);
  // Die alten Platzhalter bleiben als Text stehen, der App-Name wird nicht mehr eingesetzt
  const old = await api('POST', '/admin/mail-templates/assigned/preview', { subject: '{{Titel}}', body: 'Alt: {{Melder}} / {{Zuständig}} / {{App}}' });
  assert.ok(old.text.startsWith('Alt: {{Melder}} / {{Zuständig}} / {{App}}'), old.text);
  assert.ok(!old.text.includes('Patchwork Test'), old.text);

  // Angepasste Vorlagen: Werte aus Melder und Zuständigem des Vorgangs, ohne Zuweisung leer
  await api('PUT', '/admin/mail-templates/confirmation', {
    subject: 'Eingang: {{Titel}}',
    body: 'Hallo {{Melder Vorname}} {{Melder Nachname}}\n\nIhre Nummer: **{{Nummer}}**, zuständig: «{{Zuständig Vorname}}{{Zuständig Nachname}}» {{App}}',
  });
  await api('PUT', '/admin/mail-templates/assigned', {
    subject: 'Zugewiesen: {{Titel}}',
    body: 'Für {{Zuständig Vorname}} {{Zuständig Nachname}}: {{Nummer}} von {{Melder Vorname}} {{Melder Nachname}}',
  });
  await api('PUT', '/admin/mail-templates/done', {
    subject: '{{Status}}: {{Titel}}',
    body: 'Hallo {{Melder Vorname}}, {{Zuständig Vorname}} {{Zuständig Nachname}} hat «{{Titel}}» erledigt.',
  });
  assert.deepEqual(
    (await api('GET', '/admin/mail-templates')).filter((t) => t.custom).map((t) => t.key).sort(),
    ['assigned', 'confirmation', 'done'],
  );

  // Kontakt aus einer Mail mit «Nachname, Vorname»
  const sender = `vorlage-${RUN}@test.local`;
  await sendMail({ from: { name: 'Vorlage, Vera', address: sender }, subject: `Vorlage ${RUN}`, text: 'Bitte um Hilfe' });
  await sleep(500);
  await poll();
  const confirmation = await waitForMail(sender, (m) => m.subject.includes(`Eingang: Vorlage ${RUN}`), 'Bestätigung mit angepasster Vorlage');
  assert.match(confirmation.subject, /^\[PW-\d+\] Eingang: Vorlage /);
  const number = Number(/^\[PW-(\d+)\]/.exec(confirmation.subject)[1]);
  const { reporter } = await detail(number);
  assert.deepEqual([reporter.name, reporter.firstName, reporter.lastName], ['Vorlage, Vera', 'Vera', 'Vorlage']);
  assert.ok(confirmation.text.includes('Hallo Vera Vorlage'), confirmation.text);
  assert.match(confirmation.text, /Ihre Nummer: \*\*PW-\d+\*\*, zuständig: «»/, 'ohne Zuweisung leer');
  assert.ok(!confirmation.text.includes('Patchwork Test'), '{{App}} ist kein Platzhalter mehr');

  await api('POST', `/items/${number}/type`, { type: 'incident' });
  await api('PATCH', `/items/${number}`, { assigneeId: ivan.id });
  const assigned = await waitForMail(IVAN, (m) => m.subject === `[PW-${number}] Zugewiesen: Vorlage ${RUN}`, 'Zuweisung mit angepasster Vorlage');
  assert.ok(assigned.text.includes(`Für Ivan Informatik: PW-${number} von Vera Vorlage`), assigned.text);
  await api('POST', `/items/${number}/move`, { statusId: status('incident', 'resolved').id });
  const done = await waitForMail(sender, (m) => m.subject === `[PW-${number}] Gelöst: Vorlage ${RUN}`, 'Erledigt mit angepasster Vorlage');
  assert.ok(done.text.includes(`Hallo Vera, Ivan Informatik hat «Vorlage ${RUN}» erledigt.`), done.text);

  for (const key of ['confirmation', 'assigned', 'done']) await api('DELETE', `/admin/mail-templates/${key}`);
  assert.ok((await api('GET', '/admin/mail-templates')).every((t) => !t.custom), 'zurück zum Standard');
  await api('PUT', '/admin/mail-templates/gibtsnicht', { subject: 'x', body: 'x' }, { expect: [404] });
});

// PNG mit 1×1 Pixel
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const uploadImage = (name, data = PNG) => {
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'image/png' }), name);
  return api('POST', '/uploads/images', form, { expect: [201, 400] });
};
const reply = async (path, body, kind) => {
  const form = new FormData();
  if (kind) form.append('kind', kind);
  form.append('body', body);
  await api('POST', path, form);
};
const entryStartingWith = async (n, start) => (await detail(n)).entries.find((e) => e.body.startsWith(start));

await step('Bilder im Text: hochladen, in der Antwort eingebettet, in der Mail eingebettet mit Link auf die volle Grösse', async () => {
  assert.match((await uploadImage('text.png', Buffer.from('kein Bild'))).message, /PNG, JPEG, GIF oder WebP/);
  assert.match((await uploadImage('gross.png', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).message, /10 MB/);
  const uploaded = await uploadImage('Fehler.png');
  assert.equal(uploaded.ref, `upload:${uploaded.id}`);
  const preview = await fetch(`${BASE}/uploads/${uploaded.id}`, { headers: { cookie } });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'image/png');

  const start = `Siehe Bild ${RUN}`;
  await reply(`/items/${itemNo}/entries`, `${start}:\n\n![Fehler.png](${uploaded.ref})`, 'reply');
  const entry = await entryStartingWith(itemNo, start);
  assert.equal(entry.attachments.length, 1);
  const [image] = entry.attachments;
  assert.equal(image.inline, true);
  assert.equal(entry.body, `${start}:\n\n![Fehler.png](attachment:${image.id})`);
  await api('GET', `/uploads/${uploaded.id}`, undefined, { expect: [404], raw: true });

  const mail = await waitForMail(ANNA, (m) => m.text.includes(start), 'Antwort mit Bild im Text');
  // Ohne keepCidLinks ersetzt mailparser die «cid:»-Verweise durch data:-Adressen
  const parsed = await simpleParser(mail.source, { keepCidLinks: true });
  assert.ok(parsed.text.includes('[Bild: Fehler.png]'), 'Textfassung nennt das Bild');
  const embedded = parsed.attachments.find((a) => a.filename === 'Fehler.png');
  assert.ok(embedded?.related, 'eingebettet, nicht als Anhang');
  assert.ok(parsed.html.includes(`src="cid:${embedded.cid}"`));
  // Link auf die volle Grösse: ohne Anmeldung, nur mit gültiger Signatur
  const link = new URL(/href="([^"]*\/api\/public\/images\/[^"]+)"/.exec(parsed.html)[1]);
  const origin = new URL(BASE).origin;
  const full = await fetch(`${origin}${link.pathname}${link.search}`);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), PNG);
  assert.equal((await fetch(`${origin}${link.pathname}?s=falsch`)).status, 404);
});

await step('Bilder im Text: kopiert aus einer internen Notiz, im Portal sichtbar, fremde Bilder nur für die IT', async () => {
  // Bild in einer internen Notiz eines anderen Vorgangs
  const noteStart = `Notiz mit Bild ${RUN}`;
  await reply(`/items/${task}/entries`, `${noteStart} ![Intern.png](${(await uploadImage('Intern.png')).ref})`, 'note');
  const internal = (await entryStartingWith(task, noteStart)).attachments[0];

  // Die IT kopiert es in eine öffentliche Antwort: Es wird ein eigenes Bild der Antwort
  const copyStart = `Kopiertes Bild ${RUN}`;
  await reply(`/items/${itemNo}/entries`, `${copyStart} ![Intern.png](attachment:${internal.id})`, 'reply');
  const copy = (await entryStartingWith(itemNo, copyStart)).attachments[0];
  assert.notEqual(copy.id, internal.id);

  await loginAs(ANNA, 'anna-passwort-1');
  const portal = await api('GET', `/portal/items/${itemNo}`);
  assert.ok(portal.entries.find((e) => e.body.startsWith(copyStart)).body.includes(`attachment:${copy.id}`));
  assert.equal((await fetch(`${BASE}/portal/attachments/${copy.id}/inline`, { headers: { cookie } })).status, 200);
  await api('GET', `/portal/attachments/${internal.id}/inline`, undefined, { expect: [404], raw: true });

  // Melder: eigenes Bild in der Antwort im Portal; das Bild der internen Notiz bleibt draussen
  const portalStart = `Antwort mit Bild ${RUN}`;
  const own = await uploadImage('Meldung.png');
  await reply(`/portal/items/${itemNo}/replies`, `${portalStart} ![Meldung.png](${own.ref}) ![Fremd](attachment:${internal.id})`);
  const sent = (await api('GET', `/portal/items/${itemNo}`)).entries.find((e) => e.body.startsWith(portalStart));
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.body, `${portalStart} ![Meldung.png](attachment:${sent.attachments[0].id}) Fremd`);
  await api('GET', `/uploads/${own.id}`, undefined, { expect: [404], raw: true });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Eingehende Mails: jede abgeholte Mail steht mit Ergebnis im Protokoll, Originalmail als Ansicht', async () => {
  // Mail von einer eigenen Adresse wird ignoriert, steht aber im Protokoll
  await sendMail({ from: MAILBOX, subject: `Schleife ${RUN}`, text: 'Von Patchwork an sich selbst' });
  await sleep(500);
  await poll();
  const all = await api('GET', '/admin/incoming-mails');
  const first = all.find((m) => m.subject === 'VPN verbindet nicht' && m.fromAddress === ANNA);
  assert.equal(first.result, 'created');
  assert.equal(first.item.number, itemNo);
  assert.equal(first.fromName, 'Anna Muster');
  assert.equal(first.simulated, false);
  assert.ok(first.cc.includes(BOB));
  assert.equal(first.mailbox.id, mailboxId);
  assert.ok(all.some((m) => m.result === 'reply' && m.item?.number === itemNo && m.fromAddress === ANNA), 'Antwort des Melders');
  assert.ok(all.some((m) => m.result === 'automated' && m.item?.number === itemNo), 'Abwesenheitsnotiz');
  assert.ok(all.some((m) => m.result === 'note' && m.fromAddress === FREMD), 'Unbeteiligter als interne Notiz');
  const loop = all.find((m) => m.subject === `Schleife ${RUN}`);
  assert.equal(loop.result, 'ignored');
  assert.match(loop.reason, /Postfach von Patchwork/);
  assert.equal(loop.item, null);
  const ignored = await api('GET', '/admin/incoming-mails?result=ignored');
  assert.ok(ignored.length >= 1 && ignored.every((m) => m.result === 'ignored'));

  const view = await api('GET', `/admin/incoming-mails/${first.id}`);
  assert.ok(view.text.includes('Seit heute Morgen geht das VPN nicht mehr.'));
  assert.ok(view.html.includes('<b>VPN</b>') && !view.html.includes('<script'), 'HTML bereinigt');
  assert.deepEqual(view.attachments.map((a) => a.filename), ['Fehlermeldung äöü.txt']);
  assert.equal(await (await fetch(`${BASE}/admin/incoming-mails/${first.id}/attachments/0`, { headers: { cookie } })).text(), 'Timeout');
  assert.match(await (await fetch(`${BASE}/admin/incoming-mails/${first.id}/eml`, { headers: { cookie } })).text(), /VPN verbindet nicht/);
  const again = await api('POST', `/admin/incoming-mails/${first.id}/reprocess`, undefined, { expect: [400] });
  assert.match(again.message, /Nur Mails mit Fehler/);

  // Originalmail im Vorgang zum Anschauen, mit Anhängen
  const messageId = encodeURIComponent((await detail(itemNo)).originalMessageId);
  const original = await api('GET', `/items/${itemNo}/original/view?messageId=${messageId}`);
  assert.ok(original.headers.from.includes(ANNA));
  assert.equal(original.headers.subject, 'VPN verbindet nicht');
  assert.ok(original.text.includes('Seit heute Morgen'));
  assert.equal(original.attachments[0].filename, 'Fehlermeldung äöü.txt');
  const file = await fetch(`${BASE}/items/${itemNo}/original/attachments/0?messageId=${messageId}`, { headers: { cookie } });
  assert.equal(await file.text(), 'Timeout');

  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/incoming-mails', undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

const simulation = (fields, files = []) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [name, content] of files) form.append('files', new Blob([content]), name);
  return form;
};

await step('Testbetrieb: Antworten und neue Mails simulieren, verarbeitet wie echte und als simuliert gekennzeichnet', async () => {
  const sent = (await api('GET', '/admin/outgoing-mails?status=sent')).find((m) => m.reply && m.item.number === itemNo);
  const refused = await api('POST', '/admin/incoming-mails/simulate', simulation({ replyTo: sent.id, from: ANNA, text: 'x' }), {
    expect: [400],
  });
  assert.match(refused.message, /nur im Testbetrieb/);

  await api('PUT', '/settings/mail', { staff: 'none', others: 'none' });
  // Ivan hat den Vorgang weiter oben stummgeschaltet; für die Benachrichtigung wieder aufheben
  await loginAs(IVAN, 'geheim-geheim');
  await api('PUT', `/items/${itemNo}/mute`, { muted: false });
  await loginAs('ada@test.local', 'geheim-geheim');
  const heldStart = `Zurückgehalten ${RUN}`;
  await reply(`/items/${itemNo}/entries`, heldStart, 'reply');
  let held;
  for (let i = 0; i < 30 && !held; i++) {
    for (const m of await api('GET', '/admin/outgoing-mails?status=held')) {
      if (m.reply && m.item.number === itemNo && (await api('GET', `/admin/outgoing-mails/${m.id}`)).text.includes(heldStart)) held = m;
    }
    if (!held) await sleep(1000);
  }
  assert.ok(held, 'Antwort im Testbetrieb zurückgehalten');

  // Antwort des Melders auf die zurückgehaltene Mail, mit Anhang
  const text = `Simulierte Antwort ${RUN}`;
  const result = await api('POST', '/admin/incoming-mails/simulate', simulation({ replyTo: held.id, from: ANNA, text }, [['Beleg.txt', 'Beleg']]));
  assert.equal(result.result, 'reply');
  assert.equal(result.simulated, true);
  assert.equal(result.simulatedBy, 'Ada Admin');
  assert.equal(result.item.number, itemNo);
  assert.equal(result.subject, `AW: [PW-${itemNo}] VPN verbindet nicht`);
  const entry = (await detail(itemNo)).entries.find((e) => e.body === text);
  assert.ok(entry, 'nur der neue Text, das Zitat ist entfernt');
  assert.equal(entry.kind, 'reply');
  assert.equal(entry.meta.simulated, true);
  assert.deepEqual(entry.attachments.map((a) => a.filename), ['Beleg.txt']);
  // Wie bei einer echten Antwort wird der Zuständige benachrichtigt, im Testbetrieb zurückgehalten
  let notice;
  for (let i = 0; i < 30 && !notice; i++) {
    notice = (await api('GET', '/admin/outgoing-mails?status=held')).find(
      (m) => m.to.includes(IVAN) && m.subject.startsWith(`[PW-${itemNo}] Neue Antwort`),
    );
    if (!notice) await sleep(1000);
  }
  assert.ok(notice, 'Benachrichtigung an den Zuständigen');

  const away = await api('POST', '/admin/incoming-mails/simulate', simulation({ replyTo: held.id, from: ANNA, text: 'Bin abwesend', automated: 'true' }));
  assert.equal(away.result, 'automated');
  const stranger = await api(
    'POST',
    '/admin/incoming-mails/simulate',
    simulation({ replyTo: held.id, from: `sim-${RUN}@test.local`, name: 'Simon Sim', text: 'Ich auch' }),
  );
  assert.equal(stranger.result, 'note');
  assert.equal(stranger.fromName, 'Simon Sim');

  // Neue Mail ohne Bezug
  const newSender = `simneu-${RUN}@test.local`;
  const created = await api(
    'POST',
    '/admin/incoming-mails/simulate',
    simulation({ mailboxId, from: newSender, name: 'Nina Simuliert', subject: `Simuliert neu ${RUN}`, text: 'Drucker streikt' }),
  );
  assert.equal(created.result, 'created');
  const item = await detail(created.item.number);
  assert.equal(item.simulated, true);
  assert.equal(item.reporter.name, 'Nina Simuliert');
  assert.equal(item.channel.label, 'E-Mail');
  assert.equal(item.description, 'Drucker streikt');
  const noSubject = await api('POST', '/admin/incoming-mails/simulate', simulation({ mailboxId, from: newSender, text: 'x' }), { expect: [400] });
  assert.match(noSubject.message, /Betreff/);

  // Nichts geht ins Postfach oder an die Absender
  await sleep(1500);
  assert.ok(!(await inbox(MAILBOX)).some((m) => m.subject.includes(RUN) && m.subject.includes('Simuliert')), 'nicht im Postfach');
  assert.equal((await inbox(newSender)).length, 0, 'Bestätigung im Testbetrieb zurückgehalten');
  const simulated = await api('GET', '/admin/incoming-mails?simulated=true');
  assert.ok(simulated.length >= 4 && simulated.every((m) => m.simulated));

  // Im Portal sieht der Melder den Vermerk
  await loginAs(ANNA, 'anna-passwort-1');
  assert.equal((await api('GET', `/portal/items/${itemNo}`)).entries.find((e) => e.body === text).simulated, true);
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/mail', { staff: 'all', others: 'all' });
});

await step('Als Benutzer arbeiten: nur Admins, nur IT/Admin, Rechte und Autor wie der Benutzer, zurück zum eigenen Konto', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const users = await api('GET', '/admin/users');
  const byEmail = (email) => users.find((u) => u.email === email);
  const ivan = byEmail(IVAN);
  // Nicht als Standard-Benutzer und nicht als man selbst
  await api('POST', `/admin/users/${byEmail(ANNA).id}/impersonate`, undefined, { expect: [400] });
  await api('POST', `/admin/users/${byEmail('ada@test.local').id}/impersonate`, undefined, { expect: [400] });
  await api('POST', '/auth/impersonation/end', undefined, { expect: [400] });
  const number = await createItem({ type: 'task', title: `Als Ivan ${RUN}` });

  assert.equal((await api('POST', `/admin/users/${ivan.id}/impersonate`)).email, IVAN);
  const me = await api('GET', '/auth/me');
  assert.deepEqual([me.user.email, me.impersonator?.email], [IVAN, 'ada@test.local']);
  // Rechte von Ivan (IT): keine Verwaltung
  await api('GET', '/admin/users', undefined, { expect: [403] });
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', `Notiz von Ivan ${RUN}`);
  await api('POST', `/items/${number}/entries`, note);
  const entry = (await detail(number)).entries.find((e) => e.body === `Notiz von Ivan ${RUN}`);
  assert.equal(entry.author.email, IVAN, 'im Namen von Ivan, ohne Vermerk');

  // Zurück: wieder Ada mit Admin-Rechten; Ivans letzte Anmeldung bleibt unverändert
  assert.equal((await api('POST', '/auth/impersonation/end')).email, 'ada@test.local');
  const back = await api('GET', '/auth/me');
  assert.deepEqual([back.user.email, back.impersonator], ['ada@test.local', null]);
  const after = (await api('GET', '/admin/users')).find((u) => u.email === IVAN);
  assert.equal(after.lastLoginAt, ivan.lastLoginAt);

  // Ein zweiter Admin (eigene Sitzung) für die Sicherheitsfälle
  const ole = await api('POST', '/admin/users', { name: `Ole Admin ${RUN}`, email: `ole-${RUN}@test.local`, role: 'admin', password: 'ole-passwort-1' });
  const adaCookie = cookie;
  cookie = '';
  await api('POST', '/auth/login', { username: `ole-${RUN}@test.local`, password: 'ole-passwort-1' });
  const oleCookie = cookie;

  // Hat Ivan inzwischen die Rolle Standard, führt der Weg zurück trotzdem
  cookie = adaCookie;
  await api('POST', `/admin/users/${ivan.id}/impersonate`);
  const asIvan = cookie;
  cookie = oleCookie;
  await api('PATCH', `/admin/users/${ivan.id}`, { role: 'standard' });
  cookie = asIvan;
  assert.equal((await api('POST', '/auth/impersonation/end')).email, 'ada@test.local');
  const adaAgain = cookie;
  cookie = oleCookie;
  await api('PATCH', `/admin/users/${ivan.id}`, { role: 'it' });

  // Passwort von Ada zurückgesetzt: auch ihre «Als Ivan»-Sitzung endet (kein Weg zurück zu einer Admin-Sitzung)
  cookie = adaAgain;
  await api('POST', `/admin/users/${ivan.id}/impersonate`);
  const asIvanAgain = cookie;
  cookie = oleCookie;
  await api('PATCH', `/admin/users/${byEmail('ada@test.local').id}`, { password: 'neues-passwort-1' });
  cookie = asIvanAgain;
  assert.equal((await api('GET', '/auth/me')).user, null);
  await api('POST', '/auth/impersonation/end', undefined, { expect: [400] });
  cookie = oleCookie;
  await api('PATCH', `/admin/users/${byEmail('ada@test.local').id}`, { password: 'geheim-geheim' });
  await api('PATCH', `/admin/users/${ole.id}`, { active: false });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('HTTPS: Anforderung, signiertes Zertifikat hochladen, Abruf über HTTPS', async () => {
  const host = new URL(BASE).hostname;
  let tls = await api('GET', '/admin/tls');
  assert.equal(tls.active, false);
  assert.deepEqual(tls.suggestedNames, [host]);
  tls = await api('POST', '/admin/tls/request', { names: [host, 'Patchwork.Test.local'] });
  assert.deepEqual(tls.pending.names, [host, 'patchwork.test.local']);

  // Test-CA signiert die Anforderung wie eine AD CS mit der Vorlage «Webserver»
  x509.cryptoProvider.set(webcrypto);
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const day = 24 * 60 * 60 * 1000;
  const caKeys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Smoke-CA',
    notBefore: new Date(Date.now() - day),
    notAfter: new Date(Date.now() + 30 * day),
    keys: caKeys,
    signingAlgorithm: alg,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  const csr = new x509.Pkcs10CertificateRequest(tls.pending.csr);
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: csr.subject,
    issuer: ca.subject,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 20 * day),
    publicKey: csr.publicKey,
    signingKey: caKeys.privateKey,
    signingAlgorithm: alg,
    extensions: [...csr.extensions, new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth])],
  });
  const upload = (text, name) => {
    const form = new FormData();
    form.append('file', new Blob([text]), name);
    return form;
  };

  // Ein Zertifikat zu einem fremden Schlüssel nimmt Patchwork nicht
  const rejected = await api('POST', '/admin/tls/certificate', upload(ca.toString('pem'), 'ca.cer'), { expect: [400] });
  assert.match(rejected.message, /passt zu keinem Schlüssel/);

  tls = await api('POST', '/admin/tls/certificate', upload(`${cert.toString('pem')}\n${ca.toString('pem')}\n`, 'patchwork.cer'));
  assert.equal(tls.active, true);
  assert.equal(tls.pending, null);
  assert.deepEqual(tls.certificate.names, [host, 'patchwork.test.local']);
  assert.equal(tls.certificate.issuer, 'Smoke-CA');
  assert.equal(tls.redirects, false, 'ohne https:// in PUBLIC_URL keine Umleitung');

  // Abruf über HTTPS, nur mit Vertrauen in die Test-CA
  const viaHttps = await new Promise((resolve, reject) => {
    const req = https.request({ host, port: HTTPS_PORT, path: '/api/public/info', ca: ca.toString('pem') }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, info: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(viaHttps.status, 200);
  assert.ok(viaHttps.info.certificateExpiresAt, 'Ablauf für den Hinweis an Admins');
  // HTTP läuft daneben weiter
  assert.equal((await api('GET', '/public/info')).certificateExpiresAt, viaHttps.info.certificateExpiresAt);
});

console.log('\nAlle Prüfungen bestanden.');
smtp.close();
