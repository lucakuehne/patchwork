// Smoke-Test, Bereich «Newsletter, Beteiligte, Rechte, Meldewege» (läuft über test/smoke.mjs)
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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
