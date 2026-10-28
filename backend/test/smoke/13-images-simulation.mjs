// Smoke-Test, Bereich «Bilder im Text, eingehende Mails, simulierte Mails» (läuft über test/smoke.mjs)
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
  everyBlock,
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
  assert.ok(all.some((m) => m.result === 'note' && m.fromAddress === STRANGER), 'Unbeteiligter als interne Notiz');
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


await step('Testbetrieb: Antworten und neue Mails simulieren, verarbeitet wie echte und als simuliert gekennzeichnet', async () => {
  const sent = (await api('GET', '/admin/outgoing-mails?status=sent')).find((m) => m.reply && m.item.number === itemNo);
  const refused = await api('POST', '/admin/incoming-mails/simulate', simulation({ replyTo: sent.id, from: ANNA, text: 'x' }), {
    expect: [400],
  });
  assert.match(refused.message, /nur im Testbetrieb/);

  await api('PUT', '/settings/mail', everyBlock({ staff: 'none', others: 'none' }));
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
  await api('PUT', '/settings/mail', everyBlock({ staff: 'all', others: 'all' }));
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
