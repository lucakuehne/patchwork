// Smoke-Test, Bereich «Notizen bearbeiten und Zeit anpassen, Antwort-Postfach, Personensuche» (läuft über test/smoke.mjs)
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

await step('Admin passt die Zeit einer internen Notiz an: auch fremde, nicht in die Zukunft, Notiz rückt an die neue Stelle', async () => {
  // Notiz von Ivan, ein Admin setzt sie zwei Tage zurück (z.B. ein früheres Telefonat)
  await loginAs(IVAN, 'geheim-geheim');
  const f = new FormData();
  f.append('kind', 'note');
  f.append('body', `Telefonat vorgestern ${RUN}`);
  await api('POST', `/items/${itemNo}/entries`, f);
  const note = (await detail(itemNo)).entries.find((e) => e.body === `Telefonat vorgestern ${RUN}`);
  assert.equal(note.timeChange, null);
  // Nur Admins
  const earlier = new Date(Date.now() - 2 * 86_400_000);
  await api('PATCH', `/entries/${note.id}/time`, { at: earlier.toISOString() }, { expect: [403] });

  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PATCH', `/entries/${note.id}/time`, { at: new Date(Date.now() + 3_600_000).toISOString() }, { expect: [400] });
  await api('PATCH', `/entries/${note.id}/time`, { at: 'gestern' }, { expect: [400] });
  const reply = (await detail(itemNo)).entries.find((e) => e.kind === 'reply');
  await api('PATCH', `/entries/${reply.id}/time`, { at: earlier.toISOString() }, { expect: [400] });

  await api('PATCH', `/entries/${note.id}/time`, { at: earlier.toISOString() });
  let entries = (await detail(itemNo)).entries;
  let moved = entries.find((e) => e.id === note.id);
  assert.equal(new Date(moved.createdAt).getTime(), earlier.getTime());
  assert.equal(moved.timeChange.originalAt, note.createdAt, 'ursprüngliche Zeit');
  assert.equal(moved.timeChange.by, 'Ada Admin');
  assert.equal(moved.author.email, IVAN, 'Autor bleibt');
  // Verlauf nach Zeit: die Notiz steht jetzt vor den Einträgen der letzten zwei Tage
  const index = entries.findIndex((e) => e.id === note.id);
  assert.ok(entries.slice(index + 1).every((e) => new Date(e.createdAt) >= earlier));
  assert.ok(entries.slice(0, index).every((e) => new Date(e.createdAt) <= earlier));

  // Erneut anpassen: die ursprüngliche Zeit bleibt
  const again = new Date(earlier.getTime() + 3_600_000);
  await api('PATCH', `/entries/${note.id}/time`, { at: again.toISOString() });
  moved = (await detail(itemNo)).entries.find((e) => e.id === note.id);
  assert.equal(new Date(moved.createdAt).getTime(), again.getTime());
  assert.equal(moved.timeChange.originalAt, note.createdAt);
  // Ivan kann seine Notiz weiterhin in den ersten Minuten (ab der ursprünglichen Zeit) bearbeiten
  await loginAs(IVAN, 'geheim-geheim');
  await api('PATCH', `/entries/${note.id}`, { body: `Telefonat vorgestern, 10 Minuten ${RUN}` });
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
