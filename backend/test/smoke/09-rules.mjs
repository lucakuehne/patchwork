// Smoke-Test, Bereich «Regeln und zeitgesteuerte Regeln» (läuft über test/smoke.mjs)
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

// ---------------------------------------------------------------- Etappe 3


await step('Regeln: Mail vom Lieferanten wird Aufgabe mit Priorität, Zuständigem und Checkliste (UND/ODER)', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const template = (await api('GET', '/checklist-templates')).find((t) => t.name === 'Neuer Mitarbeiter');
  const lieferant = (actions) => ({
    name: 'Lieferant',
    active: true,
    triggers: ['mail_new'],
    // Domain des Lieferanten ODER (Betreff «Bestellung» UND Text ohne «Newsletter»)
    conditions: group(
      'or',
      cond('sender', 'domain', `@lieferant-${RUN}.test`),
      group('and', cond('subject', 'contains', 'bestellung'), cond('body', 'notContains', 'newsletter')),
    ),
    actions: { type: 'task', priority: 'high', assigneeId: ivan.id, checklistTemplateId: template.id, ...actions },
  });
  // «Typ: Aufgabe» verlangt einen Status (seit 23.10.2026), nicht den Ablehnen-Status
  assert.match((await api('POST', '/admin/rules', lieferant({}), { expect: [400] })).message, /Status wählen/);
  const rejectedId = status('task', 'rejected').id;
  assert.match((await api('POST', '/admin/rules', lieferant({ statusId: rejectedId }), { expect: [400] })).message, /Ablehnen/);
  lieferantRule = await api('POST', '/admin/rules', lieferant({ statusId: status('task', 'planned').id }));
  await sendMail({ from: LIEFERANT, subject: 'Lieferschein 4711', text: 'Anbei der Lieferschein.' });
  await sendMail({ from: CARLA, subject: 'Bestellung Monitor', text: 'Bitte einen Monitor bestellen.' });
  await sendMail({ from: CARLA, subject: 'Bestellung Newsletter', text: 'Unser Newsletter zur Bestellung.' });
  await sleep(500);
  await poll();

  const item = await byTitle('Lieferschein 4711');
  const d = await detail(item.number);
  assert.equal(d.type, 'task');
  assert.equal(d.status.label, 'Geplant', 'Status aus der Regel');
  assert.equal(d.priority, 'high');
  assert.equal(d.assignee.email, IVAN);
  assert.equal(d.checklists[0].title, 'Neuer Mitarbeiter');
  const entry = d.entries.find((e) => e.meta?.field === 'rule');
  assert.equal(entry.meta.ruleName, 'Lieferant');
  assert.equal(entry.author, null);
  await waitForMail(
    IVAN,
    (m) => m.subject === `[PW-${item.number}] Zugewiesen: Lieferschein 4711` && m.text.includes('Regel «Lieferant»'),
    'Zuweisung durch Regel',
  );
  assert.equal((await detail((await byTitle('Bestellung Monitor')).number)).type, 'task', 'ODER-Zweig');
  assert.equal((await detail((await byTitle('Bestellung Newsletter')).number)).type, null, 'UND mit «enthält nicht»');

  const preview = await api('POST', '/admin/rules/preview', { triggers: ['mail_new'], conditions: lieferantRule.conditions });
  assert.deepEqual(
    preview.hits.map((h) => h.title).sort(),
    ['Bestellung Monitor', 'Lieferschein 4711'],
  );
});

await step('Regeln: Aufgabe gleich abgeschlossen, Mail «Abgeschlossen» nach der Eingangsbestätigung; gelöschter Status', async () => {
  const sender = `quittung-${RUN}@test.local`;
  const title = `Quittung ${RUN}`;
  const archiv = await api('POST', '/statuses', { type: 'task', label: 'Archiv', closed: true });
  const rule = await api('POST', '/admin/rules', {
    name: 'Quittungen',
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', sender)),
    actions: { type: 'task', statusId: archiv.id },
  });
  await sendMail({ from: sender, subject: title, text: 'Nur zur Ablage.' });
  await sleep(500);
  await poll();
  const n = (await api('GET', '/items?view=tasks-done')).items.find((i) => i.title === title).number;
  const d = await detail(n);
  assert.equal(d.status.label, 'Archiv');
  assert.ok(d.closedAt, 'abgeschlossen');
  await waitForMail(sender, (m) => m.subject.startsWith(`[PW-${n}]`) && m.text.includes('ist bei uns eingegangen'), 'Eingangsbestätigung');
  const done = await waitForMail(sender, (m) => m.subject === `[PW-${n}] Archiv: ${title}`, 'Erledigt nach Regel');
  const mails = (await inbox(sender)).filter((m) => m.subject.startsWith(`[PW-${n}]`));
  assert.equal(mails.length, 2);
  assert.equal(mails.at(-1).subject, done.subject, '«Erledigt» nach der Eingangsbestätigung');

  // Status der Regel gelöscht: Die Regel erhält den Ersatz bzw. den Start-Status der Aufgaben
  await api('DELETE', `/statuses/${archiv.id}`, { replacementId: status('task', 'done').id });
  assert.equal((await api('GET', '/admin/rules')).find((r) => r.id === rule.id).actions.statusId, status('task', 'done').id);
  await api('DELETE', `/admin/rules/${rule.id}`);
});

await step('Regeln: Verwerfen ohne Bestätigung, Bestätigung unterdrücken, Reihenfolge', async () => {
  await api('POST', '/admin/rules', {
    name: 'Spam',
    triggers: ['mail_new'],
    conditions: group('and', cond('subject', 'contains', 'Gewinnspiel')),
    actions: { discard: true },
  });
  await api('POST', '/admin/rules', {
    name: 'Ohne Bestätigung',
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', STUMM)),
    actions: { suppressConfirmation: true, priority: 'high' },
  });
  // Von oben nach unten: die spätere Regel gewinnt
  await api('POST', '/admin/rules', {
    name: 'Später: Priorität tief',
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', STUMM)),
    actions: { priority: 'low' },
  });
  await sendMail({ from: GEWINN, subject: 'Gewinnspiel', text: 'Sie haben gewonnen!' });
  await sendMail({ from: STUMM, subject: 'Ohne Antwort bitte', text: 'Nur zur Info.' });
  await sleep(500);
  await poll();
  const inboxItems = (await api('GET', '/items?view=inbox')).items;
  assert.ok(!inboxItems.some((i) => i.title === 'Gewinnspiel'), 'verworfen');
  const quiet = inboxItems.find((i) => i.title === 'Ohne Antwort bitte');
  assert.equal(quiet.priority, 'low');
  const rulesApplied = (await detail(quiet.number)).entries.filter((e) => e.meta?.field === 'rule').map((e) => e.meta.ruleName);
  assert.deepEqual(rulesApplied, ['Ohne Bestätigung', 'Später: Priorität tief']);
  await sleep(3000);
  assert.equal((await inbox(GEWINN)).length, 0, 'keine Bestätigung für Verworfenes');
  assert.equal((await inbox(STUMM)).length, 0, 'Bestätigung unterdrückt');
});

await step('Regeln: Antwort mit «dringend» setzt Priorität, Typ nur im Eingang', async () => {
  await api('POST', '/admin/rules', {
    name: 'Dringend',
    triggers: ['mail_reply', 'portal_reply'],
    conditions: group('and', cond('body', 'contains', 'dringend')),
    actions: { type: 'incident', priority: 'high' },
  });
  const quiet = await byTitle('Ohne Antwort bitte');
  await sendMail({ from: STUMM, subject: `Re: [PW-${quiet.number}] Ohne Antwort bitte`, text: 'Jetzt ist es doch dringend!' });
  // bestehende Aufgabe: Typ bleibt, Priorität wird hoch
  const task1 = await byTitle('Bestellung Monitor');
  await api('PATCH', `/items/${task1.number}`, { priority: 'low' });
  await sendMail({ from: CARLA, subject: `Re: [PW-${task1.number}] Bestellung Monitor`, text: 'Bitte dringend!' });
  await sleep(500);
  await poll();
  const d = await detail(quiet.number);
  assert.equal(d.type, 'incident');
  assert.equal(d.priority, 'high');
  const t = await detail(task1.number);
  assert.equal(t.type, 'task');
  assert.equal(t.priority, 'high');
});

await step('Regeln: neue Portal-Meldung, Verwaltung nur für Admin', async () => {
  await api('POST', '/admin/rules', {
    name: 'Portal Anna',
    triggers: ['portal_new'],
    conditions: group('and', cond('sender', 'is', ANNA)),
    actions: { assigneeId: ivan.id },
  });
  await api('POST', '/admin/rules', { name: 'Leer', triggers: [], conditions: group('and'), actions: { priority: 'low' } }, { expect: [400] });
  await api('POST', '/admin/rules', { name: 'Ohne Aktion', triggers: ['mail_new'], conditions: group('and'), actions: {} }, { expect: [400] });
  await loginAs(ANNA, 'anna-passwort-1');
  const f = new FormData();
  f.append('type', 'incident');
  f.append('title', 'Maus defekt');
  const number = (await api('POST', '/portal/items', f)).number;
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/rules', undefined, { expect: [403] });
  assert.equal((await detail(number)).assignee.email, IVAN);
  await loginAs('ada@test.local', 'geheim-geheim');
  // Reihenfolge ändern und ausschalten
  const all = await api('GET', '/admin/rules');
  await api('PUT', '/admin/rules/order', { ids: all.map((r) => r.id).reverse() });
  assert.equal((await api('GET', '/admin/rules'))[0].id, all.at(-1).id);
  await api('PATCH', `/admin/rules/${lieferantRule.id}/active`, { active: false });
  assert.equal((await api('GET', '/admin/rules')).find((r) => r.id === lieferantRule.id).active, false);
});

await step('Zeitgesteuerte Regeln: erinnern, schliessen und eskalieren', async () => {
  const rule = (name, schedule, conditions, actions) => api('POST', '/admin/rules', { name, schedule, conditions, actions });
  const invalid = (schedule, actions) => api('POST', '/admin/rules', { name: 'x', schedule, conditions: group('and'), actions }, { expect: [400] });
  const neu = status('incident', 'new').id;
  // Erinnern/Schliessen nur mit «Wartet auf den Melder» allein
  await invalid({ days: 1, statusIds: [neu], waiting: false }, { close: true });
  await invalid({ days: 1, statusIds: [neu], waiting: true }, { remindReporter: true });
  // Mindestens ein Status, nur bestehende und offene
  await invalid({ days: 1, statusIds: [], waiting: false }, { priority: 'high' });
  assert.match((await invalid({ days: 1, statusIds: [status('incident', 'resolved').id] }, { priority: 'high' })).message, /offene Status/);
  assert.match((await invalid({ days: 1, statusIds: [webcrypto.randomUUID()] }, { priority: 'high' })).message, /existiert nicht/);
  // Nicht Ereignis und Zeit gleichzeitig
  await api(
    'POST',
    '/admin/rules',
    {
      name: 'x',
      triggers: ['mail_new'],
      schedule: { days: 1, statusIds: [], waiting: true },
      conditions: group('and'),
      actions: { priority: 'high' },
    },
    { expect: [400] },
  );
  const created = [
    await rule('Erinnern', { days: 1, statusIds: [], waiting: true }, group('and'), { remindReporter: true }),
    await rule('Schliessen', { days: 3, statusIds: [], waiting: true }, group('and'), { close: true }),
    // Status beider Typen
    await rule(
      'Eskalation',
      { days: 2, statusIds: [neu, status('task', 'backlog').id], waiting: false },
      group('and', cond('subject', 'contains', 'eskalation')),
      { priority: 'high', assigneeId: ivan.id },
    ),
  ];
  assert.deepEqual(created[0].schedule, { days: 1, statusIds: [], waiting: true });
  const waiting = await createItem({ type: 'incident', title: 'Wartet lange', reporterId: anna.id });
  await api('POST', `/items/${waiting}/move`, { statusId: status('incident', 'waiting').id });
  const fresh = await createItem({ type: 'incident', title: 'Eskalation Drucker', reporterId: anna.id });
  const freshTask = await createItem({ type: 'task', title: 'Eskalation Lieferung', reporterId: anna.id });
  assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 0, reminded: 0, closed: 0 }, 'noch zu früh');

  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(Zeitreise übersprungen, SMOKE_DATABASE_URL fehlt) ');
  } else {
    const { default: pg } = await import('pg');
    const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
    await db.connect();
    const back = (number, days) =>
      db.query(`update items set status_changed_at = now() - $1::interval where number = $2`, [`${days} days`, number]);
    try {
      await back(waiting, 2);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 1, closed: 0 });
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 0, reminded: 0, closed: 0 }, 'nur einmal erinnern');
      await waitForMail(
        ANNA,
        (m) => m.subject === `[PW-${waiting}] Erinnerung: Wartet lange` && m.text.includes('Ohne Rückmeldung schliessen wir'),
        'Erinnerung',
      );
      const reminded = (await detail(waiting)).entries.at(-1);
      assert.equal(reminded.meta.ruleName, 'Erinnern');

      await back(fresh, 3);
      await back(freshTask, 3);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 2, reminded: 0, closed: 0 });
      for (const n of [fresh, freshTask]) {
        const escalated = await detail(n);
        assert.equal(escalated.priority, 'high');
        assert.equal(escalated.assignee.email, IVAN);
      }

      await back(waiting, 4);
      assert.deepEqual(await api('POST', '/admin/rules/run-timed'), { items: 1, reminded: 0, closed: 1 }, 'schliessen statt erneut erinnern');
      const d = await detail(waiting);
      assert.equal(d.status.label, 'Gelöst', '«Automatisch schliessen in»');
      assert.ok(d.closedAt);
      assert.equal(d.entries.at(-1).meta.ruleName, 'Schliessen');
      await waitForMail(
        ANNA,
        (m) => m.subject === `[PW-${waiting}] Gelöst: Wartet lange` && m.text.includes('keine Rückmeldung erhalten'),
        'Automatisch geschlossen',
      );
      const preview = await api('POST', '/admin/rules/preview', { schedule: created[2].schedule, conditions: created[2].conditions });
      assert.deepEqual(
        preview.hits.map((h) => [h.number, h.kind]).sort(),
        [
          [fresh, 'due'],
          [freshTask, 'due'],
        ].sort(),
      );
    } finally {
      await db.end();
    }
  }
  for (const r of created) await api('DELETE', `/admin/rules/${r.id}`);
});

await step('Zeitgesteuerte Regeln: Status löschen ersetzt ihn in den Regeln oder entfernt ihn', async () => {
  const neu = status('incident', 'new').id;
  const inProgress = status('incident', 'in_progress').id;
  const add = (label) => api('POST', '/statuses', { type: 'incident', label, closed: false });
  const [supplier, vendor, customer] = [await add('Beim Lieferanten'), await add('Beim Hersteller'), await add('Beim Kunden')];
  // Passt auf keinen Vorgang, damit die Regeln nichts verändern
  const never = group('and', cond('subject', 'contains', `nie-${RUN}`));
  const rule = (name, statusIds, waiting = false) =>
    api('POST', '/admin/rules', { name, schedule: { days: 30, statusIds, waiting }, conditions: never, actions: { priority: 'high' } });
  const created = [
    await rule('Mit Ersatz', [supplier.id, neu]),
    await rule('Nur gelöschter', [vendor.id]),
    await rule('Mit Wartet', [vendor.id], true),
    await rule('Ersatz abgeschlossen', [customer.id]),
  ];
  const usage = await api('GET', '/statuses/rules-usage');
  assert.deepEqual(usage[supplier.id], ['Mit Ersatz']);
  assert.deepEqual([...usage[vendor.id]].sort(), ['Mit Wartet', 'Nur gelöschter']);
  // Zeitgesteuerte Regeln gelten nur für offene Status
  assert.match((await api('PATCH', `/statuses/${supplier.id}`, { closed: true }, { expect: [400] })).message, /Mit Ersatz/);

  await api('DELETE', `/statuses/${supplier.id}`, { replacementId: inProgress });
  await api('DELETE', `/statuses/${vendor.id}`, {});
  const item = await createItem({ type: 'incident', title: 'Beim Kunden', statusId: customer.id });
  await api('DELETE', `/statuses/${customer.id}`, { replacementId: status('incident', 'resolved').id });
  const d = await detail(item);
  assert.equal(d.status.label, 'Gelöst');
  assert.ok(d.closedAt);

  const rules = await api('GET', '/admin/rules');
  const state = (r) => {
    const { schedule, active } = rules.find((x) => x.id === r.id);
    return [schedule.statusIds, schedule.waiting, active];
  };
  assert.deepEqual(state(created[0]), [[neu, inProgress], false, true], 'offener Ersatz tritt an die Stelle');
  assert.deepEqual(state(created[1]), [[], false, false], 'ohne Status ausgeschaltet');
  assert.deepEqual(state(created[2]), [[], true, true], 'mit «Wartet auf den Melder» bleibt sie aktiv');
  assert.deepEqual(state(created[3]), [[], false, false], 'abgeschlossener Ersatz fällt weg');
  assert.deepEqual(await api('GET', '/statuses/rules-usage'), { [neu]: ['Mit Ersatz'], [inProgress]: ['Mit Ersatz'] });
  for (const r of created) await api('DELETE', `/admin/rules/${r.id}`);
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, lieferantRule });
