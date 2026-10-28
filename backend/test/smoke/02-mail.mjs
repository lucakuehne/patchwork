// Smoke-Test, Bereich «Mail-Eingang, Antworten, Typwechsel» (läuft über test/smoke.mjs)
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
  assert.ok(!confirmation.source.includes('/portal/items/'), 'ohne Portal keine Link-Zeile');
  // Standardtext per Du mit Vorname; Standard-Fusszeile mit «Patchwork», nicht dem App-Namen
  assert.ok(confirmation.text.startsWith('Hallo Anna\n\nDeine Meldung ist bei uns eingegangen'), confirmation.text);
  assert.ok(confirmation.text.includes(`Patchwork · PW-${itemNo}\nBitte lass bei Antworten die Nummer [PW-${itemNo}] im Betreff stehen.`), confirmation.text);
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
  // Standardtext mit Vor- und Nachname des Melders, Link-Zeile «Vorgang öffnen», Fusszeile mit «Patchwork»
  assert.ok(mail.text.includes(`Melder: Anna Muster (${ANNA})`), mail.text);
  assert.match(mail.text, new RegExp(`Vorgang öffnen: \\S+/items/${itemNo}\\b`));
  assert.ok(mail.text.includes(`Patchwork · Benachrichtigung zu PW-${itemNo}`), mail.text);
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
  await sendMail({ from: STRANGER, subject: `[PW-${itemNo}] Hallo`, text: 'Ich mische mich ein.' });
  await sleep(500);
  await poll();
  const item = await detail(itemNo);
  const last = item.entries.at(-1);
  assert.equal(last.kind, 'note');
  assert.equal(last.meta.external, true);
  assert.equal(item.status.label, 'Wartet auf Melder');
});

await step('Typwechsel Störung → Aufgabe nur mit gewähltem Status, zurück zur Störung nach seiner Rolle', async () => {
  // Zur Aufgabe immer mit Status (seit 23.10.2026), nie in den Ablehnen-Status
  const refused = await api('POST', `/items/${itemNo}/type`, { type: 'task' }, { expect: [400] });
  assert.match(refused.message, /Status für die Aufgabe wählen/);
  await api('POST', `/items/${itemNo}/type`, { type: 'task', statusId: status('task', 'rejected').id }, { expect: [400] });
  await api('POST', `/items/${itemNo}/type`, { type: 'task', statusId: status('task', 'in_progress').id });
  let item = await detail(itemNo);
  assert.equal(item.type, 'task');
  assert.equal(item.status.label, 'In Arbeit');
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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
