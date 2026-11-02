// Smoke-Test, Bereich «Wiederkehrende Aufgaben» (läuft über test/smoke.mjs)
import { ANNA, api, assert, channel, detail, IVAN, loginAs, RUN, state, step, waitForMail } from './lib.mjs';

const { ivan, anna } = state;

/** Datum in der Zeitzone der Anwendung, «offset» Tage ab heute */
const day = (offset = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() + offset * 86_400_000));
const weekdayOf = (date) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Durchlauf zu einem Zeitpunkt; 10:00 UTC ist in Zürich 11 bzw. 12 Uhr, 03:00 UTC vor 06:00 */
const run = (date, utc = '10:00') => api('POST', '/admin/recurring-tasks/run', { now: `${date}T${utc}:00Z` });
const byId = async (id) => (await api('GET', '/recurring-tasks')).find((t) => t.id === id);
const dues = async (id) => (await byId(id)).recent.map((r) => r.dueDate);

let base;
let patchday;
let daily;

await step('Wiederkehrende Aufgabe: anlegen, nächste Termine mit Titel, Prüfungen', async () => {
  const statuses = await api('GET', '/statuses');
  const targets = await api('GET', '/statuses/targets');
  const open = statuses.find((s) => s.type === 'task' && !s.closed && s.id !== targets.task.start && s.id !== targets.task.reject);
  const closed = statuses.find((s) => s.type === 'task' && s.closed);
  base = {
    title: `Patchday {{Monat}} {{Jahr}} ${RUN}`,
    description: 'Updates **einspielen**',
    priority: 'high',
    statusId: open.id,
    assigneeId: ivan.id,
    channelId: channel('Intern').id,
    checklists: [{ title: 'Ablauf', items: ['Server', 'Clients'] }],
    schedule: { kind: 'monthlyWeekday', interval: 1, nth: 2, weekday: 2 },
    // Erster Termin frühestens in vier Tagen: mit drei Tagen Vorlauf legt ihn der Job im Hintergrund heute nicht an
    startDate: day(4),
    endDate: null,
    weekend: 'keep',
    leadDays: 3,
    active: true,
  };
  patchday = await api('POST', '/recurring-tasks', base);
  // Zweiter Dienstag: ein Dienstag zwischen dem 8. und 14.
  const secondTuesday = (date) => weekdayOf(date) === 2 && Number(date.slice(8)) >= 8 && Number(date.slice(8)) <= 14;
  assert.ok(secondTuesday(patchday.next.due), patchday.next.due);
  const { title, schedule, startDate, endDate, weekend, leadDays } = base;
  const preview = await api('POST', '/recurring-tasks/preview', { id: patchday.id, title, schedule, startDate, endDate, weekend, leadDays });
  assert.equal(preview.length, 5);
  assert.ok(preview.every((o) => secondTuesday(o.due)), JSON.stringify(preview));
  assert.match(preview[0].title, new RegExp(`^Patchday \\S+ \\d{4} ${RUN}$`));
  assert.equal(preview[0].due, patchday.next.due);
  // Prüfungen: Wochentag fehlt, 30. Februar, Ende vor Beginn, abgeschlossener Status, Melder als Zuständiger
  const refused = [
    { schedule: { kind: 'weekly', interval: 1, weekdays: [] } },
    { schedule: { kind: 'yearly', interval: 1, month: 2, day: 30 } },
    { endDate: day(-1) },
    { statusId: closed.id },
    { assigneeId: anna.id },
  ];
  for (const patch of refused) await api('POST', '/recurring-tasks', { ...base, ...patch }, { expect: [400] });
});

await step('Jetzt anlegen: Aufgabe des nächsten Termins mit Titel, Checkliste, Verlauf und Mail an den Zuständigen', async () => {
  const created = await api('POST', `/recurring-tasks/${patchday.id}/create-now`);
  const d = await detail(created.number);
  assert.equal(d.type, 'task');
  assert.equal(d.title, patchday.next.title);
  assert.equal(d.dueDate, patchday.next.due);
  assert.equal(d.status.id, base.statusId);
  assert.equal(d.priority, 'high');
  assert.equal(d.assignee.id, ivan.id);
  assert.equal(d.reporter.email, 'ada@test.local', 'Melder: wer die Vorlage angelegt hat');
  assert.equal(d.description, base.description);
  assert.deepEqual(
    d.checklists.map((c) => [c.title, c.items.map((i) => i.text)]),
    [['Ablauf', ['Server', 'Clients']]],
  );
  assert.deepEqual(d.recurring, { id: patchday.id, title: base.title });
  const entry = d.entries.find((e) => e.meta?.field === 'recurring');
  assert.equal(entry.author.email, 'ada@test.local');
  assert.equal(entry.meta.recurringTitle, base.title);
  await waitForMail(IVAN, (m) => m.subject === `[PW-${created.number}] Zugewiesen: ${d.title}`, 'Mail «Zugewiesen»');
  // Der Plan geht mit dem Termin danach weiter
  const after = await byId(patchday.id);
  assert.ok(after.next.due > patchday.next.due, `${after.next.due} nach ${patchday.next.due}`);
  assert.deepEqual(
    after.recent.map((r) => r.number),
    [created.number],
  );
});

await step('Durchlauf: ab 06:00 am Tag, einmal je Fälligkeit, verpasste entfallen, pausiert keine', async () => {
  // Pausiert: keine Aufgaben, auch wenn der Termin ansteht
  await api('PUT', `/recurring-tasks/${patchday.id}`, { ...base, active: false });
  // Ab morgen, damit der Job im Hintergrund (alle 15 Minuten) nicht dazwischenkommt
  daily = await api('POST', '/recurring-tasks', {
    ...base,
    title: `Täglich {{Datum}} ${RUN}`,
    schedule: { kind: 'daily', interval: 1 },
    startDate: day(1),
    leadDays: 0,
    statusId: null,
    assigneeId: null,
    checklists: [],
  });
  assert.equal(daily.next.due, day(1));
  await run(day(1), '03:00');
  assert.deepEqual(await dues(daily.id), [], 'vor 06:00 noch keine');
  await run(day(1));
  await run(day(1));
  assert.deepEqual(await dues(daily.id), [day(1)], 'einmal je Fälligkeit');
  // Zwei Tage verpasst: nur der heutige Termin
  await run(day(4));
  assert.deepEqual(await dues(daily.id), [day(4), day(1)]);
  const [latest] = (await byId(daily.id)).recent;
  const d = await detail(latest.number);
  assert.equal(d.title, `Täglich ${day(4).split('-').reverse().join('.')} ${RUN}`);
  assert.equal(d.assignee, null);
  const targets = await api('GET', '/statuses/targets');
  assert.equal(d.status.id, targets.task.start, 'ohne Wahl der Start-Status');
  const entry = d.entries.find((e) => e.meta?.field === 'recurring');
  assert.equal(entry.author, null, 'vom Durchlauf: ohne Bearbeiter');
  assert.deepEqual((await byId(patchday.id)).recent.length, 1, 'pausierte legt nichts an');
  // Ändern: der nächste Termin richtet sich neu aus, ohne angelegte zu wiederholen
  const changed = await api('PUT', `/recurring-tasks/${daily.id}`, { ...base, ...pick(daily) });
  assert.equal(changed.next.due, day(5));
});

await step('Wochenende auf Montag (Samstag, Sonntag und Montag ergeben eine Aufgabe) bzw. Freitag', async () => {
  // Nächster Samstag, mindestens zwei Tage voraus
  let offset = 2;
  while (weekdayOf(day(offset)) !== 6) offset++;
  const workdays = await api('POST', '/recurring-tasks', {
    ...base,
    title: `Werktage {{Wochentag}} ${RUN}`,
    schedule: { kind: 'daily', interval: 1 },
    startDate: day(offset),
    weekend: 'monday',
    leadDays: 0,
    assigneeId: null,
    checklists: [],
  });
  assert.equal(workdays.next.due, day(offset + 2), 'Samstag fällig am Montag');
  await run(day(offset + 2));
  assert.deepEqual(await dues(workdays.id), [day(offset + 2)]);
  // Titel nach dem Termin laut Rhythmus (Samstag), fällig am Montag
  const d = await detail((await byId(workdays.id)).recent[0].number);
  assert.equal(d.title, `Werktage Samstag ${RUN}`);
  await api('DELETE', `/recurring-tasks/${workdays.id}`);
  // Freitag davor: Monatsende am Wochenende ist am Freitag fällig, der Titel nennt den Termin laut Rhythmus
  const monthEnd = await api('POST', '/recurring-tasks/preview', {
    id: null,
    title: 'Abschluss {{Datum}}',
    schedule: { kind: 'monthlyDay', interval: 1, day: -1 },
    startDate: day(1),
    endDate: null,
    weekend: 'friday',
    leadDays: 0,
  });
  assert.equal(monthEnd.length, 5);
  for (const o of monthEnd) {
    const weekday = weekdayOf(o.on);
    assert.equal(o.due, weekday === 6 ? shift(o.on, -1) : weekday === 7 ? shift(o.on, -2) : o.on, o.on);
    assert.equal(o.title, `Abschluss ${o.on.split('-').reverse().join('.')}`);
  }
});

await step('Löschen: Aufgaben bleiben ohne Verweis; Rechte nach Rolle und Bereich', async () => {
  const [kept] = (await byId(daily.id)).recent;
  await api('DELETE', `/recurring-tasks/${daily.id}`);
  await api('DELETE', `/recurring-tasks/${daily.id}`, undefined, { expect: [404] });
  const d = await detail(kept.number);
  assert.equal(d.recurring, null);
  assert.ok(d.entries.some((e) => e.meta?.field === 'recurring'), 'Eintrag im Verlauf bleibt');
  // Standard-Benutzer: kein Zugriff; IT ohne Bereich Aufgaben ebenso; Durchlauf von Hand nur Admin
  await loginAs(ANNA, 'anna-passwort-1');
  await api('GET', '/recurring-tasks', undefined, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/areas', { it: ['inbox', 'incident'] });
  try {
    await loginAs(IVAN, 'geheim-geheim');
    await api('GET', '/recurring-tasks', undefined, { expect: [403] });
    await api('POST', `/recurring-tasks/${patchday.id}/create-now`, undefined, { expect: [403] });
    await api('POST', '/admin/recurring-tasks/run', {}, { expect: [403] });
  } finally {
    await loginAs('ada@test.local', 'geheim-geheim');
    await api('PUT', '/settings/areas', { it: ['inbox', 'incident', 'task'] });
  }
  await api('DELETE', `/recurring-tasks/${patchday.id}`);
});

/** Felder einer gespeicherten wiederkehrenden Aufgabe für PUT */
function pick(task) {
  const { title, description, priority, statusId, assigneeId, channelId, checklists, schedule, startDate, endDate, weekend, leadDays, active } = task;
  return { title, description, priority, statusId, assigneeId, channelId, checklists, schedule, startDate, endDate, weekend, leadDays, active };
}
