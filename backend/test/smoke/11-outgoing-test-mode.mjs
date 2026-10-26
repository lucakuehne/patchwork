// Smoke-Test, Bereich «Abruf ab Zeitpunkt, ausgehende Mails, Versandfehler, Testbetrieb» (läuft über test/smoke.mjs)
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
  assert.ok(mails.some((m) => m.template === 'done' && m.label === 'Abgeschlossen'), 'Mail «Abgeschlossen» im Verlauf');
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

  // Hinweis für Admins (Balken oben), bis die Mail erneut gesendet oder als erledigt markiert ist; nur für Admins
  const alerts = await api('GET', '/admin/alerts');
  assert.ok(alerts.failedMails >= 1, 'Hinweis auf fehlgeschlagene Mails');
  assert.ok(alerts.disk === null || alerts.disk.freePercent < 10, 'Speicher nur bei wenig Platz');
  // Läuft gerade ein automatischer Wiederholungsversuch, steht die Mail kurz auf «wird versendet»
  for (let i = 0; i < 10; i++) {
    const done = await api('POST', `/admin/outgoing-mails/${failed.mailId}/dismiss`, undefined, { expect: [204, 400] });
    if (done === '') break;
    await sleep(1000);
  }
  assert.ok((await api('GET', `/admin/outgoing-mails/${failed.mailId}`)).dismissedAt, 'als erledigt markiert');
  assert.equal((await api('GET', '/admin/alerts')).failedMails, alerts.failedMails - 1);
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/alerts', undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');

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
  assert.equal(after.dismissedAt, null, '«Erneut senden» hebt «erledigt» auf');
  await api('POST', `/admin/outgoing-mails/${failed.mailId}/dismiss`, undefined, { expect: [400] });
  const eml = await fetch(`${BASE}/items/${itemNo}/mails/${failed.mailId}/eml`, { headers: { cookie } });
  assert.match(await eml.text(), new RegExp(`^From: .*${FIXED}`, 'im'), 'Protokoll zeigt die versendete Fassung');
  assert.equal((await detail(itemNo)).entries.find((e) => e.body === text).delivery, null, 'kein Vermerk mehr');

  // Mail-Abruf: Hinweis erst nach 60 Minuten ohne Unterbruch; ein erfolgreicher Abruf beendet ihn
  if (process.env.SMOKE_DATABASE_URL) {
    const { default: pg } = await import('pg');
    const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
    await db.connect();
    try {
      const since = async (minutes) =>
        db.query(`update mailboxes set last_error = 'Testfehler', error_since = now() - make_interval(mins => $2) where id = $1`, [
          mb.id,
          minutes,
        ]);
      const listed = async () => (await api('GET', '/admin/alerts')).mailboxes.some((m) => m.id === mb.id);
      await since(59);
      assert.equal(await listed(), false, 'nach 59 Minuten noch kein Hinweis');
      await since(61);
      assert.equal(await listed(), true, 'nach 61 Minuten Hinweis');
      await api('POST', `/admin/mailboxes/${mb.id}/poll`);
      assert.equal(await listed(), false, 'erfolgreicher Abruf beendet den Hinweis');
    } finally {
      await db.end();
    }
  } else {
    process.stdout.write('(Abruf-Hinweis übersprungen, SMOKE_DATABASE_URL fehlt) ');
  }

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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
