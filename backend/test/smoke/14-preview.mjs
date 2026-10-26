// Smoke-Test, Bereich «Aus echter Mail simulieren, eingebettete Bilder, Vorschau» (läuft über test/smoke.mjs)
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

await step('Aus einer echten Mail simulieren: vorbelegt, als Antwort auf einen Vorgang, Original verwerfen', async () => {
  await api('PUT', '/settings/mail', { staff: 'none', others: 'none' });
  // Echte Mail wie eine Antwort auf ein HelpSpot-Ticket: Patchwork kennt die Nummer nicht, sie landet im Eingang
  const subject = `AW: Installation PdfCraft - Ticket:{18195} ${RUN}`;
  await sendMail({ from: ANNA, subject, text: 'Danke, PdfCraft läuft jetzt.', attachments: [{ filename: 'log.txt', content: 'Logdatei' }] });
  await sleep(500);
  await poll();
  const logged = (await api('GET', '/admin/incoming-mails')).find((m) => m.subject === subject);
  assert.equal(logged.result, 'created');
  const real = logged.item.number;
  const realItem = await detail(real);
  assert.equal(realItem.type, null, 'im Eingang');

  // Vorbelegung über die Originalmail des Vorgangs und über das Protokoll
  const draft = await api('GET', `/admin/incoming-mails/draft?messageId=${encodeURIComponent(realItem.originalMessageId)}`);
  assert.deepEqual([draft.incomingMailId, draft.from, draft.subject, draft.mailboxId], [logged.id, ANNA, subject, mailboxId]);
  assert.ok(draft.text.includes('PdfCraft läuft jetzt'), draft.text);
  assert.deepEqual(draft.attachments.map((a) => a.filename), ['log.txt']);
  assert.equal(draft.discardable.number, real);
  assert.equal((await api('GET', `/admin/incoming-mails/draft?id=${logged.id}`)).subject, subject);
  await api('GET', '/admin/incoming-mails/draft?id=keine-id', undefined, { expect: [404] });

  // Geändert als Antwort auf einen bestehenden Vorgang simulieren, mit dem Anhang der echten Mail, Original verwerfen
  const result = await api(
    'POST',
    '/admin/incoming-mails/simulate',
    simulation({
      mailboxId,
      from: draft.from,
      name: draft.name,
      subject: 'AW: Installation PdfCraft',
      text: draft.text,
      replyToItem: String(itemNo),
      originalId: draft.incomingMailId,
      originalAttachments: '0',
      discardOriginal: 'true',
    }),
  );
  assert.equal(result.result, 'reply');
  assert.equal(result.simulated, true);
  assert.equal(result.item.number, itemNo);
  assert.equal(result.subject, `[PW-${itemNo}] AW: Installation PdfCraft`);
  const entry = (await detail(itemNo)).entries.find((e) => e.meta?.simulated && e.body.includes('PdfCraft läuft jetzt'));
  assert.ok(entry, 'Antwort beim bestehenden Vorgang');
  assert.deepEqual(entry.attachments.map((a) => a.filename), ['log.txt']);
  assert.equal((await detail(real)).discarded, true, 'Original verworfen');
  assert.equal((await api('GET', `/admin/incoming-mails/draft?id=${logged.id}`)).discardable, null, 'nur einmal');

  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', `/admin/incoming-mails/draft?id=${logged.id}`, undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/mail', { staff: 'all', others: 'all' });
});

await step('Eingebettete Bilder: im HTML auch in einem leeren <span>, in Antworten an ihrer Stelle, Zitat-Bilder weg', async () => {
  // Neue Mail wie aus Outlook: Bild in einem leeren <span>
  const subject = `Bild im Span ${RUN}`;
  await sendMail({
    from: ANNA,
    subject,
    text: 'Siehe Bild\n[cid:span@test]',
    html: '<p>Siehe Bild</p><p><span><img width="1" height="1" src="cid:span@test"></span></p>',
    attachments: [{ filename: 'span.png', content: PNG, cid: 'span@test' }],
  });
  await sleep(500);
  await poll();
  const created = (await api('GET', '/admin/incoming-mails')).find((m) => m.subject === subject);
  const item = await detail(created.item.number);
  const image = item.attachments.find((a) => a.filename === 'span.png');
  assert.ok(item.descriptionHtml.includes(`/api/attachments/${image.id}/inline`), 'Bild im HTML der Meldung');
  assert.ok(item.description.includes(`![span.png](attachment:${image.id})`), 'im Text an seiner Stelle');

  // Antwort mit neuem Bild und einem Bild aus dem zitierten Verlauf
  await sendMail({
    from: ANNA,
    subject: `Re: [PW-${item.number}] ${subject}`,
    text: `Hier das neue Bild:\n[cid:neu@test]\nGruss Anna\n\n-----Ursprüngliche Nachricht-----\nVon: IT\nGesendet: heute\n[cid:alt@test]`,
    html: '<p>Hier das neue Bild:<br><img src="cid:neu@test"></p><p>Gruss Anna</p><blockquote><img src="cid:alt@test"></blockquote>',
    attachments: [
      { filename: 'neu.png', content: PNG, cid: 'neu@test' },
      { filename: 'alt.png', content: PNG, cid: 'alt@test' },
      { filename: 'Protokoll.log', content: 'Zeile 1\nZeile 2' },
    ],
  });
  await sleep(500);
  await poll();
  const reply = (await detail(item.number)).entries.find((e) => e.kind === 'reply' && e.body.includes('Hier das neue Bild'));
  assert.deepEqual(reply.attachments.map((a) => a.filename).sort(), ['Protokoll.log', 'neu.png'], 'Bild aus dem Zitat nicht übernommen');
  const neu = reply.attachments.find((a) => a.filename === 'neu.png');
  assert.ok(reply.body.includes(`Hier das neue Bild:\n![neu.png](attachment:${neu.id})\nGruss Anna`), reply.body);
  assert.ok(!reply.body.includes('cid:'), 'keine Marken mehr');
});

await step('Vorschau von Anhängen: Text, Bild, PDF, Mail (.eml) mit Anhängen, auch aus gespeicherten Mails und im Portal', async () => {
  const eml = [
    'From: Bob <bob@firma.ch>',
    'To: anna@firma.ch',
    'Subject: Weitergeleitete Mail',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Inhalt der weitergeleiteten Mail',
    '--b1',
    'Content-Type: text/plain; name="innen.txt"',
    'Content-Disposition: attachment; filename="innen.txt"',
    '',
    'Innerer Anhang',
    '--b1--',
    '',
  ].join('\r\n');
  const form = new FormData();
  form.append('kind', 'reply');
  form.append('body', `Mit Anhängen ${RUN}`);
  form.append('files', new Blob(['Ein Log\nmit Grüssen']), 'setup.log');
  form.append('files', new Blob([PNG], { type: 'image/png' }), 'bild.png');
  form.append('files', new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' }), 'Rechnung.pdf');
  form.append('files', new Blob([eml], { type: 'message/rfc822' }), 'Weitergeleitet.eml');
  form.append('files', new Blob(['PK'], { type: 'application/zip' }), 'archiv.zip');
  await api('POST', `/items/${itemNo}/entries`, form);
  const entry = (await detail(itemNo)).entries.find((e) => e.body === `Mit Anhängen ${RUN}`);
  const att = (name) => entry.attachments.find((a) => a.filename === name);

  assert.deepEqual(await api('GET', `/attachments/${att('setup.log').id}/preview`), { kind: 'text', text: 'Ein Log\nmit Grüssen', truncated: false });
  assert.deepEqual(await api('GET', `/attachments/${att('bild.png').id}/preview`), { kind: 'image' });
  assert.deepEqual(await api('GET', `/attachments/${att('Rechnung.pdf').id}/preview`), { kind: 'pdf' });
  await api('GET', `/attachments/${att('archiv.zip').id}/preview`, undefined, { expect: [404] });
  // PDF zur Anzeige im Browser, Text weiterhin als Download
  const pdf = await fetch(`${BASE}/attachments/${att('Rechnung.pdf').id}/inline`, { headers: { cookie } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /^inline;/);
  assert.ok(!pdf.headers.get('content-security-policy').includes('sandbox'), 'PDF-Betrachter ohne Sandbox');
  const log = await fetch(`${BASE}/attachments/${att('setup.log').id}/inline`, { headers: { cookie } });
  assert.match(log.headers.get('content-disposition'), /^attachment;/);
  // Mail als Anhang: Kopf, Text, Anhänge; innerer Anhang herunterladbar
  const mail = await api('GET', `/attachments/${att('Weitergeleitet.eml').id}/preview`);
  assert.equal(mail.kind, 'mail');
  assert.equal(mail.mail.headers.subject, 'Weitergeleitete Mail');
  assert.ok(mail.mail.text.includes('Inhalt der weitergeleiteten Mail'));
  assert.deepEqual(mail.mail.attachments.map((a) => a.filename), ['innen.txt']);
  const inner = await fetch(`${BASE}/attachments/${att('Weitergeleitet.eml').id}/mail-attachments/0`, { headers: { cookie } });
  assert.equal((await inner.text()).trim(), 'Innerer Anhang');

  // Anhang der Originalmail (gespeicherte Mail)
  const messageId = encodeURIComponent((await detail(itemNo)).originalMessageId);
  assert.deepEqual(await api('GET', `/items/${itemNo}/original/attachments/0/preview?messageId=${messageId}`), {
    kind: 'text',
    text: 'Timeout',
    truncated: false,
  });

  // Portal (Zugang für alle seit dem Schritt «Portal»): Anhang einer öffentlichen Antwort im eigenen Vorgang
  await loginAs(ANNA, 'anna-passwort-1');
  assert.equal((await api('GET', `/portal/attachments/${att('setup.log').id}/preview`)).text, 'Ein Log\nmit Grüssen');
  const portalInner = await fetch(`${BASE}/portal/attachments/${att('Weitergeleitet.eml').id}/mail-attachments/0`, { headers: { cookie } });
  assert.equal((await portalInner.text()).trim(), 'Innerer Anhang');
  await loginAs('ada@test.local', 'geheim-geheim');
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
