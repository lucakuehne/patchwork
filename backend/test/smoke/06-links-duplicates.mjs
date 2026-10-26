// Smoke-Test, Bereich «Verknüpfungen und Duplikate» (läuft über test/smoke.mjs)
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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
