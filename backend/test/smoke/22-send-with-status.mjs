// Smoke-Test, Bereich «Status beim Senden» (läuft über test/smoke.mjs): Antworten und Notizen mit Statuswechsel als
// Einheit, Mail «Antwort mit Abschluss» statt Antwort-Mail und «Abgeschlossen» (Entscheid vom 04.11.2026)
import { ANNA, api, assert, createItem, detail, inbox, IVAN, loginAs, RUN, simpleParser, sleep, state, status, step, waitForMail } from './lib.mjs';

const { ivan, anna } = state;
const ADA = 'ada@test.local';
/** Antwort oder Notiz mit Status; «extra» z.B. { force: 'true' } */
const send = (n, kind, body, statusId, extra = {}, expect) => {
  const form = new FormData();
  form.append('kind', kind);
  form.append('body', body);
  if (statusId) form.append('statusId', statusId);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api('POST', `/items/${n}/entries`, form, expect ? { expect } : undefined);
};
const mailsOf = async (n) => (await api('GET', '/admin/outgoing-mails')).filter((m) => m.item?.number === n);

await step('Status beim Senden: Antwort und «In Arbeit», Verlauf und nur die Antwort-Mail', async () => {
  await loginAs(ADA, 'geheim-geheim');
  const n = await createItem({ type: 'incident', title: `Senden ${RUN}`, reporterId: anna.id });
  await waitForMail(ANNA, (m) => m.subject === `[PW-${n}] Senden ${RUN}`, 'Bestätigung');
  await send(n, 'reply', `Ich schaue es an ${RUN}`, status('incident', 'in_progress').id);
  const d = await detail(n);
  assert.equal(d.status.id, status('incident', 'in_progress').id);
  // Zuerst die Antwort, dann der Wechsel
  const reply = d.entries.findIndex((e) => e.kind === 'reply' && e.body === `Ich schaue es an ${RUN}`);
  const change = d.entries.findIndex((e) => e.kind === 'status' && e.meta.to === 'In Arbeit');
  assert.ok(reply >= 0 && change > reply, 'Antwort vor dem Statuswechsel');
  await waitForMail(ANNA, (m) => m.text.includes(`Ich schaue es an ${RUN}`), 'Antwort-Mail');
  assert.deepEqual((await mailsOf(n)).map((m) => m.template).sort(), ['confirmation', 'reply']);
  // Gleicher Status oder ohne Angabe: nur die Antwort
  await send(n, 'note', `Notiz ohne Wechsel ${RUN}`, status('incident', 'in_progress').id);
  assert.equal((await detail(n)).entries.filter((e) => e.kind === 'status').length, 1);
  // Aktionsprotokoll
  const log = (await api('GET', `/admin/audit-log?q=PW-${n}`)).entries.map((e) => e.action);
  assert.ok(log.includes('Öffentliche Antwort geschrieben, Status geändert'), log.join(' | '));
  assert.ok(log.includes('Interne Notiz geschrieben'), log.join(' | '));
});

await step('Status beim Senden: Antwort und «Gelöst» = eine Mail «Antwort mit Abschluss»', async () => {
  const n = await createItem({ type: 'incident', title: `Abschluss ${RUN}`, reporterId: anna.id });
  await send(n, 'reply', `Der Toner ist **ersetzt** ${RUN}`, status('incident', 'resolved').id);
  const d = await detail(n);
  assert.equal(d.status.id, status('incident', 'resolved').id);
  assert.ok(d.closedAt, 'Abschlussdatum');
  const mail = await waitForMail(ANNA, (m) => m.subject === `[PW-${n}] Gelöst: Abschluss ${RUN}`, 'Antwort mit Abschluss');
  assert.ok(mail.text.includes(`Deine Meldung «Abschluss ${RUN}» (PW-${n}) wurde auf «Gelöst» gesetzt.`), mail.text);
  assert.ok(mail.text.includes('**Ada Admin** hat geantwortet:'), mail.text);
  assert.ok((await simpleParser(mail.source)).html.includes('<strong>ersetzt</strong>'), 'Antwort mit Formatierung');
  await sleep(3000);
  const templates = (await mailsOf(n)).map((m) => m.template);
  assert.ok(templates.includes('replyClosed'), templates.join(', '));
  assert.ok(!templates.includes('done') && !templates.includes('reply'), `keine zweite Mail: ${templates.join(', ')}`);
  // Die Mail gehört zur Antwort («Mail ansehen»)
  assert.ok(d.entries.find((e) => e.kind === 'reply').mailId);
});

await step('Status beim Senden: Notiz und «Gelöst» = Mail «Abgeschlossen»', async () => {
  const n = await createItem({ type: 'incident', title: `Notiz Abschluss ${RUN}`, reporterId: anna.id });
  await send(n, 'note', `Erledigt am Telefon ${RUN}`, status('incident', 'resolved').id);
  await waitForMail(ANNA, (m) => m.subject === `[PW-${n}] Gelöst: Notiz Abschluss ${RUN}`, 'Abgeschlossen');
  await sleep(2000);
  const templates = (await mailsOf(n)).map((m) => m.template).sort();
  assert.deepEqual(templates, ['confirmation', 'done']);
  const mail = (await inbox(ANNA)).find((m) => m.subject === `[PW-${n}] Gelöst: Notiz Abschluss ${RUN}`);
  assert.ok(!mail.text.includes('Erledigt am Telefon'), 'Notiz bleibt intern');
});

await step('Status beim Senden: Einheit mit Checkliste und Zuständig Pflicht, Ablehnen-Status und Eingang', async () => {
  // Offene Checklisten-Punkte: 409, nichts gespeichert; mit «force» beides
  const task = await createItem({ type: 'task', title: `Checkliste senden ${RUN}` });
  await api('POST', `/items/${task}/checklists`, { title: 'Liste' });
  await api('POST', `/checklists/${(await detail(task)).checklists[0].id}/items`, { text: 'Offen' });
  const done = status('task', 'done').id;
  const conflict = await send(task, 'note', `Fertig ${RUN}`, done, {}, [409]);
  assert.equal(conflict.code, 'OPEN_CHECKLIST');
  let d = await detail(task);
  assert.ok(!d.entries.some((e) => e.body === `Fertig ${RUN}`), 'Notiz nicht gespeichert');
  await send(task, 'note', `Fertig ${RUN}`, done, { force: 'true' });
  d = await detail(task);
  assert.equal(d.status.id, done);
  assert.ok(d.entries.some((e) => e.body === `Fertig ${RUN}`));

  // Zuständig Pflicht: 400, nichts gespeichert; mit Zuständigem beides
  const inProgress = status('incident', 'in_progress');
  await api('PATCH', `/statuses/${inProgress.id}`, { assigneeRequired: true });
  try {
    const n = await createItem({ type: 'incident', title: `Pflicht senden ${RUN}` });
    const refused = await send(n, 'note', `Übernehme ${RUN}`, inProgress.id, {}, [400]);
    assert.equal(refused.code, 'ASSIGNEE_REQUIRED');
    assert.ok(!(await detail(n)).entries.some((e) => e.body === `Übernehme ${RUN}`));
    await send(n, 'note', `Übernehme ${RUN}`, inProgress.id, { assigneeId: ivan.id });
    d = await detail(n);
    assert.deepEqual([d.status.id, d.assignee.id], [inProgress.id, ivan.id]);
    await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Zugewiesen: Pflicht senden ${RUN}`, 'Zugewiesen');
  } finally {
    await api('PATCH', `/statuses/${inProgress.id}`, { assigneeRequired: false });
  }

  // Der Ablehnen-Status geht nur über «Ablehnen»; im Eingang braucht es zuerst einen Typ
  const t = await createItem({ type: 'task', title: `Ablehnen senden ${RUN}` });
  await send(t, 'note', 'x', status('task', 'rejected').id, {}, [400]);
  const inboxItem = (await api('GET', '/items?view=inbox')).items[0];
  if (inboxItem) {
    const message = (await send(inboxItem.number, 'note', 'x', inProgress.id, {}, [400])).message;
    assert.match(message, /zuerst einen Typ/);
  }
});

await step('Status beim Senden: Auslöser im Testbetrieb, eigene Vorlage', async () => {
  // Eigener Auslöser in den Blöcken mit Status, nicht im Block «Generell»
  const settings = await api('GET', '/settings/mail');
  await api('PUT', '/settings/mail', {
    ...settings,
    incident: { ...settings.incident, triggers: { replyClosed: 'none' } },
  });
  assert.deepEqual((await api('GET', '/settings/mail')).incident.triggers, { replyClosed: 'none' });
  await api('PUT', '/settings/mail', { ...settings, general: { ...settings.general, triggers: { replyClosed: 'none' } } });
  assert.deepEqual((await api('GET', '/settings/mail')).general.triggers, {}, 'im Block «Generell» nicht');
  await api('PUT', '/settings/mail', settings);
  // Vorlage unter E-Mail-Vorlagen, mit Erklärung im «?»
  const kinds = await api('GET', '/admin/mail-templates/kinds');
  const kind = kinds.find((k) => k.key === 'replyClosed');
  assert.equal(kind.label, 'Antwort mit Abschluss');
  assert.match(kind.description, /Ersetzt dann die Mails/);
});
