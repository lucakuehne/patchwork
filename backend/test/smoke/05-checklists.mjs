// Smoke-Test, Bereich «Checklisten, Fälligkeit, Board-Karte, Erwähnen» (läuft über test/smoke.mjs)
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

await step('Checklisten: anlegen, abhaken, sortieren, Fortschritt in Listen', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  task = await createItem({ type: 'task', title: 'Notebook für Neueintritt' }, [['intern.txt', 'nur IT']]);
  await api('POST', `/items/${task}/checklists`, { title: 'Hardware' });
  let d = await detail(task);
  taskListId = d.checklists[0].id;
  await api('POST', `/checklists/${taskListId}/items`, { text: 'Notebook bestellen' });
  await api('POST', `/checklists/${taskListId}/items`, { text: 'Dockingstation' });
  d = await detail(task);
  const [first] = d.checklists[0].items;
  await api('PATCH', `/checklist-items/${first.id}`, { done: true });
  d = await detail(task);
  assert.equal(d.checklists[0].items[0].done, true);
  assert.equal(d.checklists[0].items[0].doneBy, 'Ada Admin');
  const card = (await api('GET', '/items?view=board')).items.find((i) => i.number === task);
  assert.deepEqual(card.checklist, { done: 1, total: 2 });
  await api('PUT', `/checklists/${taskListId}/items/order`, { ids: d.checklists[0].items.map((i) => i.id).reverse() });
  assert.equal((await detail(task)).checklists[0].items[0].text, 'Dockingstation');
  // Abhaken und Zurücknehmen stehen im Verlauf, Umbenennen nicht
  await api('PATCH', `/checklist-items/${first.id}`, { done: false });
  await api('PATCH', `/checklist-items/${first.id}`, { text: 'Notebook bestellt' });
  const ticks = (await detail(task)).entries.filter((e) => e.kind === 'change').map((e) => e.meta);
  assert.deepEqual(
    ticks.map((m) => [m.field, m.itemId, m.text, m.from, m.to]),
    [
      ['checklistItem', first.id, 'Notebook bestellen', false, true],
      ['checklistItem', first.id, 'Notebook bestellen', true, false],
    ],
  );
  await api('PATCH', `/checklist-items/${first.id}`, { done: true });
  assert.equal((await detail(task)).entries.at(-1).meta.text, 'Notebook bestellt');
  // Nicht im Portal: dort erscheinen nur Antworten und mitgeteilte Ablehnungen
});

await step('Fälligkeit: nur Aufgaben, im Verlauf, auf dem Board, beim Typwechsel ausgeblendet', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ type: 'task', title: 'Mit Fälligkeit', channelId: channel('Intern').id, dueDate: '2026-12-24' })) f.append(k, v);
  const due = (await api('POST', '/items', f)).number;
  assert.equal((await detail(due)).dueDate, '2026-12-24');
  assert.equal((await api('GET', '/items?view=board')).items.find((i) => i.number === due).dueDate, '2026-12-24');
  await api('PATCH', `/items/${due}`, { dueDate: '2026-12-31' });
  assert.deepEqual((await detail(due)).entries.at(-1).meta, { field: 'dueDate', from: '24.12.2026', to: '31.12.2026' });
  await api('PATCH', `/items/${due}`, { dueDate: 'morgen' }, { expect: [400] });
  await api('PATCH', `/items/${due}`, { dueDate: null });
  assert.deepEqual((await detail(due)).entries.at(-1).meta, { field: 'dueDate', from: '31.12.2026', to: null });
  await api('PATCH', `/items/${due}`, { dueDate: '2027-01-15' });
  // Bei Störungen ausgeblendet (bleibt gespeichert), nicht änderbar; zurück zur Aufgabe wieder da
  await api('POST', `/items/${due}/type`, { type: 'incident' });
  let d = await detail(due);
  assert.equal(d.dueDate, null);
  assert.equal(d.entries.at(-1).meta.dueDate, 'hidden');
  await api('PATCH', `/items/${due}`, { dueDate: '2027-02-01' }, { expect: [400] });
  await api('POST', `/items/${due}/type`, { type: 'task', statusId: status('task', 'backlog').id });
  d = await detail(due);
  assert.equal(d.dueDate, '2027-01-15');
  assert.equal(d.entries.at(-1).meta.dueDate, 'shown');
  // Beim Erfassen einer Störung wird kein Datum gespeichert
  const g = new FormData();
  for (const [k, v] of Object.entries({ type: 'incident', title: 'Störung ohne Fälligkeit', channelId: channel('Intern').id, dueDate: '2026-12-24' })) g.append(k, v);
  const incident = (await api('POST', '/items', g)).number;
  await api('POST', `/items/${incident}/type`, { type: 'task', statusId: status('task', 'backlog').id });
  assert.equal((await detail(incident)).dueDate, null);
});

await step('Mail bei Fälligkeit: einmal pro Datum an den Zuständigen, nur offene Aufgaben', async () => {
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(d);
  };
  const make = async (title, fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ type: 'task', title, channelId: channel('Intern').id, ...fields })) f.append(k, v);
    return (await api('POST', '/items', f)).number;
  };
  // Alles, was schon fällig ist, vorher abarbeiten (andere Schritte)
  await api('POST', '/admin/rules/run-due');
  const overdue = await make(`Fällig gestern ${RUN}`, { dueDate: day(-1), assigneeId: ivan.id });
  await make(`Fällig morgen ${RUN}`, { dueDate: day(1), assigneeId: ivan.id });
  await make(`Fällig ohne Zuständigen ${RUN}`, { dueDate: day(-1) });
  const closed = await make(`Fällig erledigt ${RUN}`, { dueDate: day(-1), assigneeId: ivan.id, statusId: status('task', 'done').id });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 1 });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 0 }, 'nur einmal pro Datum');
  const mail = await waitForMail(IVAN, (m) => m.subject === `[PW-${overdue}] Fällig: Fällig gestern ${RUN}`, 'Mail bei Fälligkeit');
  assert.ok(mail.text.includes(`ist am ${day(-1).split('-').reverse().join('.')} fällig`), mail.text);
  // Neues Datum (heute oder früher): wieder eine Mail; wieder geöffnete erledigte Aufgabe ebenso
  await api('PATCH', `/items/${overdue}`, { dueDate: day(-2) });
  await api('POST', `/items/${closed}/move`, { statusId: status('task', 'in_progress').id });
  assert.deepEqual(await api('POST', '/admin/rules/run-due'), { reminded: 2 });
  // Nicht im Verlauf (Mails an die IT erscheinen dort nicht)
  assert.ok(!(await detail(overdue)).mails.some((m) => m.template === 'dueReminder'));
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', '/admin/rules/run-due', undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('Board-Karte: Beschreibung und Anzahl Kommentare (Antworten und Notizen)', async () => {
  mentionTask = await createItem({ type: 'task', title: `Erwähnen ${RUN}`, description: '## Ablauf\n\n**Zuerst** sichern', reporterId: (await api('GET', '/users/staff')).find((u) => u.email === 'ada@test.local').id });
  const card = async () => (await api('GET', '/items?view=board')).items.find((i) => i.number === mentionTask);
  assert.equal((await card()).descriptionPreview, '## Ablauf\n\n**Zuerst** sichern');
  assert.equal((await card()).commentCount, 0);
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', 'Erste Notiz');
  await api('POST', `/items/${mentionTask}/entries`, note);
  await api('PATCH', `/items/${mentionTask}`, { priority: 'high' });
  assert.equal((await card()).commentCount, 1, 'Änderungen zählen nicht');
  const empty = await createItem({ type: 'task', title: `Ohne Beschreibung ${RUN}` });
  assert.equal((await api('GET', '/items?view=board')).items.find((i) => i.number === empty).descriptionPreview, null);
});

await step('Erwähnen: Mail «Erwähnt» an die IT, nicht an sich selbst, beim Melder als Text', async () => {
  const staff = await api('GET', '/users/staff');
  const ada = staff.find((u) => u.email === 'ada@test.local');
  const anna = (await detail(itemNo)).reporter;
  const mention = (u, label) => `[@${label}](mention:${u.id})`;
  const before = (await inbox('ada@test.local')).length;

  // Interne Notiz: Ivan erhält die Mail, Ada (Verfasserin) und Anna (keine IT) nicht
  const noteText = `Bitte ${mention(ivan, 'Ivan IT')} und ${mention(ada, 'Ada Admin')} und ${mention(anna, 'Anna Muster')} prüfen ${RUN}`;
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', noteText);
  await api('POST', `/items/${mentionTask}/entries`, note);
  const mail = await waitForMail(IVAN, (m) => m.subject === `[PW-${mentionTask}] Erwähnt: Erwähnen ${RUN}`, 'Erwähnt');
  assert.ok(mail.text.includes(`Ada Admin hat dich in PW-${mentionTask} «Erwähnen ${RUN}» erwähnt (interne Notiz)`), mail.text);
  assert.ok(mail.text.includes(`Bitte @Ivan IT und @Ada Admin und @Anna Muster prüfen ${RUN}`), mail.text);
  assert.ok(!mail.text.includes('mention:'), 'ohne Link-Ziel');
  await sleep(1500);
  assert.equal((await inbox('ada@test.local')).length, before, 'keine Mail an sich selbst');
  assert.ok(!(await inbox(ANNA)).some((m) => m.subject.includes('Erwähnt')), 'keine Mail an Melder');

  // Notiz bearbeiten: nur neu Erwähnte erhalten die Mail, bereits Erwähnte nicht noch einmal
  const entry = (await detail(mentionTask)).entries.find((e) => e.body === noteText);
  const count = async () => (await inbox(IVAN)).filter((m) => m.subject === `[PW-${mentionTask}] Erwähnt: Erwähnen ${RUN}`).length;
  await api('PATCH', `/entries/${entry.id}`, { body: `${noteText} – ergänzt` });
  await sleep(1500);
  assert.equal(await count(), 1, 'beim Bearbeiten keine zweite Mail an bereits Erwähnte');

  // Öffentliche Antwort an Anna mit Erwähnung: Anna sieht «@Ivan IT» als Text, Ivan erhält «Erwähnt»
  const replyText = `Wir klären das mit ${mention(ivan, 'Ivan IT')} ${RUN}`;
  const reply = new FormData();
  reply.append('kind', 'reply');
  reply.append('body', replyText);
  await api('POST', `/items/${itemNo}/entries`, reply);
  const toAnna = await waitForMail(ANNA, (m) => m.text.includes(`Wir klären das mit @Ivan IT ${RUN}`), 'Antwort mit Erwähnung');
  assert.ok(!toAnna.source.includes('mention:'), 'kein Link-Ziel in der Mail an den Melder');
  await waitForMail(IVAN, (m) => m.subject === `[PW-${itemNo}] Erwähnt: VPN verbindet nicht` && m.text.includes('(öffentliche Antwort)'), 'Erwähnt in Antwort');
});

await step('Abschliessen mit offenen Punkten nur nach Bestätigung, Ablehnen ohne', async () => {
  const conflict = await api('POST', `/items/${task}/move`, { statusId: status('task', 'done').id }, { expect: [409] });
  assert.equal(conflict.code, 'OPEN_CHECKLIST');
  assert.equal(conflict.open, 1);
  assert.equal((await detail(task)).status.label, 'Backlog');
  await api('POST', `/items/${task}/move`, { statusId: status('task', 'done').id, force: true });
  assert.equal((await detail(task)).status.label, 'Erledigt');
  await api('POST', `/items/${task}/move`, { statusId: status('task', 'in_progress').id });

  const other = await createItem({ type: 'task', title: 'Wird abgelehnt' });
  await api('POST', `/items/${other}/checklists`, { title: 'Offen' });
  const list = (await detail(other)).checklists[0].id;
  await api('POST', `/checklists/${list}/items`, { text: 'offener Punkt' });
  await api('POST', `/items/${other}/reject`, { reason: 'Nicht nötig', notify: false });
  assert.equal((await detail(other)).status.label, 'Abgelehnt');
  // Aus dem Ablehnen-Status in einen abgeschlossenen Status gilt ebenfalls als Abschliessen
  const fromRejected = await api('POST', `/items/${other}/move`, { statusId: status('task', 'done').id }, { expect: [409] });
  assert.equal(fromRejected.code, 'OPEN_CHECKLIST');
  assert.equal((await detail(other)).status.label, 'Abgelehnt');
});

await step('Typwechsel blendet Checklisten aus und wieder ein', async () => {
  await api('POST', `/items/${task}/type`, { type: 'incident' });
  let d = await detail(task);
  assert.deepEqual(d.checklists, []);
  assert.equal(d.entries.at(-1).meta.checklists, 'hidden');
  await api('POST', `/checklists/${taskListId}/items`, { text: 'bei Störung' }, { expect: [400] });
  await api('POST', `/items/${task}/type`, { type: 'task', statusId: status('task', 'in_progress').id });
  d = await detail(task);
  assert.equal(d.checklists.length, 1);
  assert.equal(d.checklists[0].items.length, 2);
  assert.equal(d.entries.at(-1).meta.checklists, 'shown');
});

await step('Checklisten-Vorlagen: nur Admin verwaltet, IT fügt ein', async () => {
  await api('POST', '/admin/checklist-templates', { name: 'Neuer Mitarbeiter', items: ['AD-Konto anlegen', '  ', 'Mailbox einrichten'] });
  const template = (await api('GET', '/checklist-templates')).find((t) => t.name === 'Neuer Mitarbeiter');
  assert.deepEqual(template.items, ['AD-Konto anlegen', 'Mailbox einrichten']);
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', '/admin/checklist-templates', { name: 'x', items: ['y'] }, { expect: [403] });
  await api('POST', `/items/${task}/checklists/from-template`, { templateId: template.id });
  const inserted = (await detail(task)).checklists.find((c) => c.title === 'Neuer Mitarbeiter');
  assert.deepEqual(
    inserted.items.map((i) => i.text),
    ['AD-Konto anlegen', 'Mailbox einrichten'],
  );
  await loginAs('ada@test.local', 'geheim-geheim');
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
