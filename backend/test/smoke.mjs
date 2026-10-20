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
const status = (type, key) => statuses.find((s) => s.type === type && s.key === key);
const poll = () => api('POST', `/admin/mailboxes/${mailboxId}/poll`);
const detail = (n) => api('GET', `/items/${n}`);

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
  assert.deepEqual(item.participants.map((p) => p.email), [BOB]);
  assert.ok(item.descriptionHtml.includes('<b>VPN</b>'));
  assert.ok(!item.descriptionHtml.includes('script'));
  assert.equal(item.attachments[0].filename, 'Fehlermeldung äöü.txt');
  assert.ok(item.originalMessageId);
  const counts = await api('GET', '/items/counts');
  assert.deepEqual(counts, { inbox: 1, incidents: 0, tasks: 0 });
  const confirmation = await waitForMail(ANNA, (m) => m.subject === `[PW-${itemNo}] VPN verbindet nicht`, 'Bestätigung');
  assert.ok(/auto-submitted: auto-generated/i.test(confirmation.headers));
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
  await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Zugewiesen: VPN verbindet nicht`, 'Zuweisung');
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

await step('Typwechsel Störung → Aufgabe übernimmt Status sinngemäss', async () => {
  await api('POST', `/items/${itemNo}/type`, { type: 'task' });
  let item = await detail(itemNo);
  assert.equal(item.type, 'task');
  assert.equal(item.status.label, 'In Arbeit', 'Wartend → In Arbeit');
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

await step('Status bearbeiten mit Pflichtkategorien und Ersatz', async () => {
  const created = await api('POST', '/statuses', { type: 'task', label: 'Test läuft', category: 'in_progress' });
  assert.equal(created.key, 'test_laeuft');
  await api('POST', `/items/${t1}/move`, { statusId: created.id });
  await api('DELETE', `/statuses/${created.id}`, undefined, { expect: [400] });
  await api('DELETE', `/statuses/${created.id}?replacementId=${status('task', 'done').id}`);
  const item = await detail(t1);
  assert.equal(item.status.label, 'Erledigt');
  assert.ok(item.closedAt, 'Ersatz in abgeschlossener Kategorie setzt closedAt');
  await api('DELETE', `/statuses/${status('incident', 'resolved').id}?replacementId=${status('incident', 'new').id}`, undefined, {
    expect: [400],
  });
  await api('PATCH', `/statuses/${status('task', 'done').id}`, { category: 'in_progress' }, { expect: [400] });
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

await step('Stummschalten unterdrückt Mails an den Benutzer', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: IVAN, password: 'geheim-geheim' });
  await api('PUT', `/items/${itemNo}/mute`, { muted: true });
  assert.equal((await detail(itemNo)).muted, true);
  const before = (await inbox(IVAN)).length;
  await sendMail({ from: ANNA, subject: `[PW-${itemNo}] Nachtrag`, text: 'Noch ein Hinweis.' });
  await sleep(500);
  await poll().catch(() => undefined); // Ivan ist kein Admin
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: 'ada@test.local', password: 'geheim-geheim' });
  await poll();
  await sleep(4000);
  assert.equal((await inbox(IVAN)).length, before);
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
  await api('POST', '/statuses', { type: 'task', label: 'x', category: 'new' }, { expect: [403] });
  await api('GET', '/items?view=incidents&mine=1');
});

await step('Kontakt ohne Passwort kann sich nicht anmelden', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: ANNA, password: 'egal-egal-egal' }, { expect: [401] });
});

// ---------------------------------------------------------------- Etappe 2

const loginAs = async (username, password) => {
  await api('POST', '/auth/logout');
  return api('POST', '/auth/login', { username, password });
};
const createItem = async (fields, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [name, content] of files) f.append('files', new Blob([content]), name);
  return (await api('POST', '/items', f)).number;
};

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
  assert.ok(!(await detail(task)).entries.some((e) => e.kind === 'change'), 'Abhaken erzeugt keine Timeline-Einträge');
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
  assert.equal(dup.status.category, 'done');
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
  await sendMail({ from: BOB, cc: [CARLA], subject: 'Drucker 3. OG streikt', text: 'Bei mir auch.' });
  await sleep(500);
  await poll();
  dupOther = await inboxNumber('Drucker 3. OG streikt');
  // diesmal aus Sicht des Originals verknüpft
  await api('POST', `/items/${dupOriginal}/links`, { role: 'hasDuplicate', otherNumber: dupOther });
  const dup = await detail(dupOther);
  assert.equal(dup.status.category, 'done');
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
});

await step('Duplikat: Original muss offen sein und einer der beiden einen Typ haben', async () => {
  await sendMail({ from: ANNA, subject: 'Eingang eins', text: 'eins' });
  await sendMail({ from: ANNA, subject: 'Eingang zwei', text: 'zwei' });
  await sleep(500);
  await poll();
  const one = await inboxNumber('Eingang eins');
  const two = await inboxNumber('Eingang zwei');
  await api('POST', `/items/${two}/links`, { role: 'duplicateOf', otherNumber: one }, { expect: [400] });
  assert.equal((await detail(t1)).status.category, 'done');
  const closed = await api('POST', `/items/${one}/links`, { role: 'duplicateOf', otherNumber: t1 }, { expect: [400] });
  assert.match(closed.message, /bereits abgeschlossen/);
  assert.equal((await detail(one)).links.length, 0);
  for (const n of [one, two]) await api('POST', `/items/${n}/discard`, { discarded: true });
});

let anna;
await step('Portal: Standard-Benutzer mit Passwort meldet sich an, hat keinen IT-Zugriff', async () => {
  anna = (await api('GET', '/admin/users')).find((u) => u.email === ANNA);
  await api('PATCH', `/admin/users/${anna.id}`, { password: 'anna-passwort-1' });
  const me = await loginAs(ANNA, 'anna-passwort-1');
  assert.equal(me.role, 'standard');
  assert.equal((await api('GET', '/auth/me')).user.role, 'standard');
  await api('GET', '/items?view=inbox', undefined, { expect: [403] });
  await api('GET', '/items/counts', undefined, { expect: [403] });
  await api('GET', `/items/${itemNo}`, undefined, { expect: [403] });
});

await step('Portal: nur eigene Vorgänge und nur Öffentliches', async () => {
  const open = await api('GET', '/portal/items?state=open');
  assert.ok(open.some((i) => i.number === itemNo));
  const d = await api('GET', `/portal/items/${itemNo}`);
  assert.equal(d.status.label, 'In Bearbeitung');
  assert.ok(d.entries.every((e) => e.kind === 'reply'));
  assert.ok(!JSON.stringify(d).includes('Zertifikat abgelaufen'), 'interne Notiz unsichtbar');
  assert.ok(!JSON.stringify(d).includes('Ich mische mich ein'), 'Notiz von Unbeteiligten unsichtbar');
  assert.ok(!JSON.stringify(d).includes('Ich bin abwesend'), 'Abwesenheitsnotiz unsichtbar');
  assert.ok(d.entries.some((e) => e.own), 'eigene Antworten');
  assert.ok(d.entries.some((e) => e.author === 'IT'), 'Antworten der IT ohne Namen');
  const closed = await api('GET', '/portal/items?state=closed');
  assert.ok(closed.some((i) => i.number === t2) && closed.some((i) => i.number === t3));
  const notified = await api('GET', `/portal/items/${t3}`);
  assert.equal(notified.status.key, 'rejected');
  assert.ok(notified.entries.some((e) => e.kind === 'rejected' && e.body.includes('Wird extern gelöst')));
  const silent = await api('GET', `/portal/items/${t2}`);
  assert.ok(!silent.entries.some((e) => e.kind === 'rejected'), 'Begründung ohne «Melder informieren» unsichtbar');
  await api('GET', `/portal/items/${task}`, undefined, { expect: [404] });
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
  assert.equal(d.status.key, 'received');
  assert.equal(d.description, 'Seit heute\nflackert er.');
  assert.equal(d.attachments.length, 1);
  const mail = await waitForMail(ANNA, (m) => m.subject === `[PW-${portalItem}] Bildschirm flackert`, 'Bestätigung Portal');
  assert.match(mail.source, new RegExp(`/portal/v/${portalItem}`));

  await loginAs('ada@test.local', 'geheim-geheim');
  const inboxItem = (await api('GET', '/items?view=inbox')).items.find((i) => i.number === portalItem);
  assert.equal(inboxItem.suggestedType, 'incident');
  assert.equal(inboxItem.source, 'portal');
  await api('POST', `/items/${portalItem}/type`, { type: 'incident' });
  assert.equal((await detail(portalItem)).suggestedType, null);
});

await step('Portal: Antwort holt aus «Wartend» zurück und informiert den Zuständigen', async () => {
  await api('PATCH', `/items/${portalItem}`, { assigneeId: ivan.id });
  await api('POST', `/items/${portalItem}/move`, { statusId: status('incident', 'waiting').id });
  await loginAs(ANNA, 'anna-passwort-1');
  assert.equal((await api('GET', `/portal/items/${portalItem}`)).status.key, 'waiting');
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
  assert.equal(annasDuplicate.status.key, 'done');
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
  assert.ok((await detail(itemNo)).participants.some((p) => p.name === 'Nora Neu'));
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
  // Erinnern/Schliessen nur bei «Wartend», nicht Ereignis und Zeit gleichzeitig
  await api('POST', '/admin/rules', { name: 'x', schedule: { category: 'new', days: 1 }, conditions: group('and'), actions: { close: true } }, { expect: [400] });
  await api(
    'POST',
    '/admin/rules',
    { name: 'x', triggers: ['mail_new'], schedule: { category: 'waiting', days: 1 }, conditions: group('and'), actions: { priority: 'high' } },
    { expect: [400] },
  );
  const created = [
    await rule('Erinnern', { category: 'waiting', days: 1 }, group('and'), { remindReporter: true }),
    await rule('Schliessen', { category: 'waiting', days: 3 }, group('and'), { close: true }),
    await rule('Eskalation', { category: 'new', days: 2 }, group('and', cond('subject', 'contains', 'eskalation')), {
      priority: 'high',
      assigneeId: ivan.id,
    }),
  ];
  const waiting = await createItem({ type: 'incident', title: 'Wartet lange', reporterId: anna.id });
  await api('POST', `/items/${waiting}/move`, { statusId: status('incident', 'waiting').id });
  const fresh = await createItem({ type: 'incident', title: 'Eskalation Drucker', reporterId: anna.id });
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
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 0, closed: 0 });
      const escalated = await detail(fresh);
      assert.equal(escalated.priority, 'high');
      assert.equal(escalated.assignee.email, IVAN);

      await back(waiting, 4);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 0, closed: 1 }, 'schliessen statt erneut erinnern');
      const d = await detail(waiting);
      assert.equal(d.status.label, 'Gelöst');
      assert.equal(d.entries.at(-1).meta.ruleName, 'Schliessen');
      await waitForMail(
        ANNA,
        (m) => m.subject === `[PW-${waiting}] Gelöst: Wartet lange` && m.text.includes('keine Rückmeldung erhalten'),
        'Automatisch geschlossen',
      );
      const preview = await api('POST', '/admin/rules/preview', { schedule: { category: 'new', days: 2 }, conditions: created[2].conditions });
      assert.deepEqual(
        preview.hits.map((h) => [h.number, h.kind]),
        [[fresh, 'due']],
      );
    } finally {
      await db.end();
    }
  }
  for (const r of created) await api('DELETE', `/admin/rules/${r.id}`);
});

await step('Textbausteine: Admin pflegt, IT liest', async () => {
  const snippet = await api('POST', '/admin/snippets', {
    name: 'Passwort zurückgesetzt',
    body: 'Guten Tag {{Melder}}\r\n\r\nIhr Passwort wurde zurückgesetzt.',
  });
  assert.equal(snippet.body, 'Guten Tag {{Melder}}\n\nIhr Passwort wurde zurückgesetzt.');
  await api('POST', '/admin/snippets', { name: 'Leer', body: '  ' }, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  assert.ok((await api('GET', '/snippets')).some((s) => s.id === snippet.id));
  await api('POST', '/admin/snippets', { name: 'x', body: 'y' }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', `/admin/snippets/${snippet.id}`, { name: 'Passwort neu gesetzt', body: 'Erledigt, {{Melder}}.' });
  assert.equal((await api('GET', '/snippets')).find((s) => s.id === snippet.id).name, 'Passwort neu gesetzt');
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
  assert.ok(csv.startsWith('Nummer;Typ;Titel;Status;Priorität;Melder;E-Mail Melder;Zuständig;Erfasst;Abgeschlossen'));
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
  const vermerk = (await detail(itemNo)).entries.find((e) => e.body === text).delivery;
  assert.equal(vermerk.status, 'held', 'Vermerk in der Timeline');
  assert.ok(vermerk.withheld.includes(ANNA));
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

await step('E-Mail-Vorlagen: angepasste Eingangsbestätigung, Vorschau und zurück zum Standard', async () => {
  const templates = await api('GET', '/admin/mail-templates');
  const standard = templates.find((t) => t.key === 'confirmation');
  assert.equal(standard.custom, false);
  assert.ok(standard.placeholders.some((p) => p.name === 'Nummer'));

  await api('PUT', '/admin/mail-templates/confirmation', {
    subject: 'Eingang: {{Titel}}',
    body: 'Hallo {{Melder}}\n\nIhre Nummer: **{{Nummer}}**',
  });
  const preview = await api('POST', '/admin/mail-templates/confirmation/preview', { subject: 'Eingang: {{Titel}}', body: 'Nr. {{Nummer}}' });
  assert.equal(preview.subject, '[PW-123] Eingang: Drucker druckt nicht');
  assert.match(preview.html, /Nr\. PW-123/);

  const sender = `vorlage-${RUN}@test.local`;
  await sendMail({ from: `Vera Vorlage <${sender}>`, subject: `Vorlage ${RUN}`, text: 'Bitte um Hilfe' });
  await poll();
  const confirmation = await waitForMail(sender, (m) => m.subject.includes(`Eingang: Vorlage ${RUN}`), 'Bestätigung mit angepasster Vorlage');
  assert.match(confirmation.subject, /^\[PW-\d+\] Eingang: Vorlage /);
  assert.ok(confirmation.text.includes('Hallo Vera Vorlage'));
  assert.match(confirmation.text, /Ihre Nummer: \*\*PW-\d+\*\*/);

  await api('DELETE', '/admin/mail-templates/confirmation');
  assert.equal((await api('GET', '/admin/mail-templates')).find((t) => t.key === 'confirmation').custom, false);
  await api('PUT', '/admin/mail-templates/gibtsnicht', { subject: 'x', body: 'x' }, { expect: [404] });
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
