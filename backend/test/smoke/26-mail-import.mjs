// Smoke-Test, Bereich «Mail importieren» (läuft über test/smoke.mjs, Entscheid vom 10.11.2026): Mails, die an eine
// andere Adresse gingen, als .eml in den Eingang übernehmen, wie eine abgerufene Mail
import nodemailer from 'nodemailer';
import { ANNA, api, assert, detail, inbox, IVAN, loginAs, MAILBOX, RUN, sleep, state, step, waitForMail } from './lib.mjs';

const { ivan } = state;
const ADA = 'ada@test.local';
const SENDER = `importiert-${RUN}@test.local`;
const QUIET = `ohne-bestaetigung-${RUN}@test.local`;
const COLLEAGUE = `kollegin-${RUN}@test.local`;
const subject = `Falsch adressiert ${RUN}`;

/** Fertige Mail (MIME), wie Outlook sie als .eml speichert */
const build = async (opts) => (await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(opts)).message;
const form = (files, fields = {}) => {
  const data = new FormData();
  for (const [name, content] of files) data.append('files', new Blob([content]), name);
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const original = await build({
  from: `Ina Import <${SENDER}>`,
  to: IVAN,
  cc: [COLLEAGUE, ADA],
  subject,
  text: 'Mein Bildschirm flackert.',
  date: new Date('2026-11-09T17:42:00Z'),
  messageId: `<import-1-${RUN}@test.local>`,
});
let ref = '';

await step('Mail importieren: Vorschau mit Hinweisen, neuer Vorgang im Eingang, Eingangsbestätigung mit Hinweis', async () => {
  await loginAs(ADA, 'geheim-geheim');
  const forwarded = await build({ from: IVAN, to: ADA, subject: `WG: ${subject}`, text: 'Siehe unten', messageId: `<import-fw-${RUN}@test.local>` });
  const preview = await api(
    'POST',
    '/mail-import/preview',
    form([
      ['Falsch.eml', original],
      ['Weiterleitung.eml', forwarded],
      ['notiz.txt', Buffer.from('keine Mail')],
    ]),
  );
  assert.equal(preview.length, 3);
  assert.deepEqual(
    [preview[0].from.address, preview[0].subject, preview[0].date, preview[0].staffSender, preview[0].duplicate, preview[0].target],
    [SENDER, subject, '2026-11-09T17:42:00.000Z', false, null, null],
  );
  assert.equal(preview[1].staffSender, true, 'Weiterleitung: Absender ist in der IT');
  assert.match(preview[2].error, /Keine Mail/);
  // Die Vorschau übernimmt nichts
  assert.ok(!(await api('GET', '/items?view=inbox')).items.some((i) => i.title === subject));

  const rows = await api('POST', '/mail-import', form([['Falsch.eml', original]], { confirmation: 'true' }));
  assert.deepEqual(
    rows.map((r) => r.result),
    ['created'],
  );
  ref = rows[0].item.ref;
  const item = await detail(Number(ref.split('-')[1]));
  assert.equal(item.type, null, 'im Eingang');
  assert.equal(item.reporter.email, SENDER);
  assert.equal(item.channel.label, 'E-Mail');
  assert.deepEqual([item.importInfo.by, item.importInfo.sentAt, item.importInfo.to], ['Ada Admin', '2026-11-09T17:42:00.000Z', [IVAN]]);
  // Die Kollegin aus CC wird Beteiligte, IT-Mitarbeitende (Ada) nicht
  assert.deepEqual(
    item.participants.map((p) => p.email),
    [COLLEAGUE],
  );
  // Eingangsbestätigung mit dem Hinweis auf die richtige Adresse
  const confirmation = await waitForMail(SENDER, (m) => m.subject === `[${ref}] ${subject}`, 'Eingangsbestätigung');
  assert.ok(confirmation.text.includes(`Bitte schreib uns künftig direkt an ${MAILBOX}`), confirmation.text);
  // Im Protokoll der eingehenden Mails: importiert von Ada
  const logged = (await api('GET', '/admin/incoming-mails')).find((m) => m.subject === subject);
  assert.deepEqual([logged.result, logged.importedBy], ['created', 'Ada Admin']);
});

await step('Mail importieren: schon vorhanden, Antwort in den Vorgang, ohne Eingangsbestätigung, nur für IT', async () => {
  const n = Number(ref.split('-')[1]);
  // Dieselbe Mail noch einmal: übersprungen, mit dem Vorgang
  const again = await api('POST', '/mail-import', form([['Falsch.eml', original]], { confirmation: 'true' }));
  assert.deepEqual([again[0].result, again[0].item.ref], ['duplicate', ref]);
  const preview = await api('POST', '/mail-import/preview', form([['Falsch.eml', original]]));
  assert.equal(preview[0].duplicate.ref, ref);

  // Antwort der Melderin mit Nummer im Betreff: in den Vorgang; Ada importiert und ist zuständig, also keine Mail an sie
  await api('PATCH', `/items/${n}`, { assigneeId: (await api('GET', '/users/staff')).find((u) => u.email === ADA).id });
  const answer = await build({ from: SENDER, to: IVAN, subject: `AW: [${ref}] ${subject}`, text: 'Es flackert immer noch.', messageId: `<import-2-${RUN}@test.local>` });
  assert.equal((await api('POST', '/mail-import/preview', form([['Antwort.eml', answer]])))[0].target.ref, ref);
  const appended = await api('POST', '/mail-import', form([['Antwort.eml', answer]], { confirmation: 'true' }));
  assert.deepEqual([appended[0].result, appended[0].item.ref], ['reply', ref]);
  const entry = (await detail(n)).entries.find((e) => e.body === 'Es flackert immer noch.');
  assert.equal(entry.kind, 'reply');
  assert.equal(entry.meta.imported.by, 'Ada Admin');
  // Eine weitere Antwort, jetzt mit Ivan als Zuständigem: er erhält «Neue Antwort»
  await api('PATCH', `/items/${n}`, { assigneeId: ivan.id });
  const second = await build({ from: SENDER, to: ADA, subject: `AW: [${ref}] ${subject}`, text: 'Jetzt ganz schwarz.', messageId: `<import-3-${RUN}@test.local>` });
  await api('POST', '/mail-import', form([['Zweite.eml', second]], { confirmation: 'true' }));
  await waitForMail(IVAN, (m) => m.subject === `[${ref}] Neue Antwort: ${subject}` && m.text.includes('Jetzt ganz schwarz.'), 'Neue Antwort');
  await sleep(1500);
  assert.ok(!(await inbox(ADA)).some((m) => m.subject === `[${ref}] Neue Antwort: ${subject}`), 'keine Mail an die Importierende');

  // Ohne Eingangsbestätigung
  const quiet = await build({ from: QUIET, to: IVAN, subject: `Leise ${RUN}`, text: 'Bitte ohne Bestätigung.', messageId: `<import-4-${RUN}@test.local>` });
  const created = await api('POST', '/mail-import', form([['Leise.eml', quiet]], { confirmation: 'false' }));
  assert.equal(created[0].result, 'created');
  assert.equal(created[0].reason, 'Importiert ohne Eingangsbestätigung');
  await sleep(2500);
  assert.equal((await inbox(QUIET)).length, 0, 'keine Eingangsbestätigung');

  // Nur für IT und Admins
  await loginAs(ANNA, 'anna-passwort-1');
  await api('POST', '/mail-import/preview', form([['Falsch.eml', original]]), { expect: [403] });
  await loginAs(ADA, 'geheim-geheim');
});
