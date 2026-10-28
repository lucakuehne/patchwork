// Smoke-Test, Bereich «E-Mail-Vorlagen und Willkommens-Mail» (läuft über test/smoke.mjs)
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
  // Standard-Fusszeilen einer neuen Installation: mit «Patchwork», nicht dem App-Namen
  assert.deepEqual(
    ['reporterFooter', 'staffFooter'].map((key) => [template(key).body, template(key).custom]),
    [
      ['Patchwork · {{Nummer}}\nBitte lass bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.', false],
      ['Patchwork · Benachrichtigung zu {{Nummer}}', false],
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

await step('Willkommens-Mail: nur von Hand an IT und Admins, ohne Vorgang und ohne Passwort', async () => {
  const newEmail = `willkommen-${RUN}@test.local`;
  const created = await api('POST', '/admin/users', { name: 'Wilma Willkommen', email: newEmail, role: 'it', password: 'willkommen-123' });
  await sleep(1500);
  assert.equal((await inbox(newEmail)).length, 0, 'nicht automatisch beim Anlegen');
  await api('POST', `/admin/users/${created.id}/welcome`);
  const mail = await waitForMail(newEmail, (m) => m.subject === 'Willkommen bei Patchwork', 'Willkommens-Mail');
  assert.ok(mail.text.startsWith('Hallo Wilma\n'), mail.text);
  assert.match(mail.text, /Rolle \*\*IT\*\*/);
  assert.ok(mail.text.includes(`Benutzername: ${newEmail}`), mail.text);
  assert.ok(mail.text.includes('Anmeldung: mit deiner E-Mail-Adresse und dem Passwort, das du separat erhältst'), mail.text);
  assert.match(mail.text, /Patchwork öffnen: http\S+\/(\s|$)/);
  assert.ok(!mail.source.includes('willkommen-123'), 'kein Passwort');
  assert.ok(!/\[PW-\d+\]/.test(mail.subject), 'ohne Nummer');

  // Im Protokoll ohne Vorgang, Art «Willkommen»
  const logged = (await api('GET', '/admin/outgoing-mails')).find((m) => m.to.includes(newEmail));
  assert.deepEqual([logged.item, logged.template, logged.status], [null, 'welcome', 'sent']);
  assert.ok((await api('GET', `/admin/outgoing-mails/${logged.id}`)).text.includes('Hallo Wilma'));

  // Erneut senden geht; nur an aktive IT und Admins, nur durch Admins
  await api('POST', `/admin/users/${created.id}/welcome`);
  const standard = (await api('GET', '/admin/users')).find((u) => u.email === ANNA);
  assert.match((await api('POST', `/admin/users/${standard.id}/welcome`, undefined, { expect: [400] })).message, /IT oder Admin/);
  await api('PATCH', `/admin/users/${created.id}`, { active: false });
  await api('POST', `/admin/users/${created.id}/welcome`, undefined, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', `/admin/users/${created.id}/welcome`, undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');

  // Vorlage unter E-Mail-Vorlagen (IT), Vorschau ohne Nummer im Betreff
  const template = (await api('GET', '/admin/mail-templates')).find((t) => t.key === 'welcome');
  assert.deepEqual([template.group, template.standalone, template.custom], ['staff', true, false]);
  const preview = await api('POST', '/admin/mail-templates/welcome/preview', { subject: template.subject, body: template.body });
  assert.equal(preview.subject, 'Willkommen bei Patchwork');
  assert.ok(preview.text.includes('Benutzername: iinformatik'), preview.text);
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
