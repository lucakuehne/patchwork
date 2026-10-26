// Smoke-Test, Bereich «Notizen bearbeiten, Antwort-Postfach, Personensuche» (läuft über test/smoke.mjs)
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

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
