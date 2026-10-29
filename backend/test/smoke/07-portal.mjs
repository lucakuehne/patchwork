// Smoke-Test, Bereich «Portal» (läuft über test/smoke.mjs)
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
  setSessionCookie(''); // Annas Sitzung nicht abmelden
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/portal', { access: 'selected', emails: [], groupDn: '' });
  const adaCookie = cookie;
  setSessionCookie(annaCookie);
  assert.match((await api('GET', '/portal/items?state=open', undefined, { expect: [403] })).message, /nicht freigeschaltet/);
  setSessionCookie(adaCookie);
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
  assert.match(mail.source, new RegExp(`/portal/items/PW-${portalItem}\\b`));

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
  assert.deepEqual(bobsDuplicate.duplicateOf, { prefix: 'PW', number: dupOriginal, title: 'Drucker 3. OG', accessible: false });
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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
