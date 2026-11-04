// Smoke-Test, Bereich «Zuständig Pflicht je Status» (läuft über test/smoke.mjs). Die übrigen Bereiche laufen ohne diese
// Pflicht (siehe 01-setup); hier wird sie für die vorbelegten Status eingeschaltet und am Ende wieder ausgeschaltet.
import { ANNA, api, assert, channel, createItem, detail, IVAN, loginAs, RUN, state, status, step, waitForMail } from './lib.mjs';

const { ivan, anna } = state;
const ADA = 'ada@test.local';
/** Status mit Pflicht laut Vorbelegung (Entscheid vom 04.11.2026): alle ausser Neu, Backlog und Geplant */
const REQUIRED = [
  ['incident', 'in_progress'],
  ['incident', 'waiting'],
  ['incident', 'resolved'],
  ['task', 'in_progress'],
  ['task', 'done'],
  ['task', 'rejected'],
];
const setRequired = async (value) => {
  for (const [type, key] of REQUIRED) await api('PATCH', `/statuses/${status(type, key).id}`, { assigneeRequired: value });
};
/** Vorgang ohne Zuständigen in einen Status bringen, der ihn verlangt (wie vor der Einführung) */
const placeWithoutAssignee = async (number, type, key) => {
  await api('PATCH', `/statuses/${status(type, key).id}`, { assigneeRequired: false });
  await api('POST', `/items/${number}/move`, { statusId: status(type, key).id });
  await api('PATCH', `/statuses/${status(type, key).id}`, { assigneeRequired: true });
};
const required = (res, label) => {
  assert.equal(res.code, 'ASSIGNEE_REQUIRED');
  assert.equal(res.message, `Im Status «${label}» braucht der Vorgang einen Zuständigen.`);
};

await step('Zuständig Pflicht: in der Verwaltung je Status einstellbar', async () => {
  await loginAs(ADA, 'geheim-geheim');
  await setRequired(true);
  const all = await api('GET', '/statuses');
  assert.deepEqual(
    all.filter((s) => s.assigneeRequired).map((s) => `${s.type}/${s.key}`).sort(),
    REQUIRED.map(([type, key]) => `${type}/${key}`).sort(),
  );
  // Neuer Status mit Pflicht; ohne Angabe ohne
  const review = await api('POST', '/statuses', { type: 'task', label: `Review ${RUN}`, closed: false, assigneeRequired: true });
  assert.equal(review.assigneeRequired, true);
  const idea = await api('POST', '/statuses', { type: 'task', label: `Idee ${RUN}`, closed: false });
  assert.equal(idea.assigneeRequired, false);
  for (const s of [review, idea]) await api('DELETE', `/statuses/${s.id}`);
  // Nur Admins
  await loginAs(IVAN, 'geheim-geheim');
  await api('PATCH', `/statuses/${status('task', 'planned').id}`, { assigneeRequired: true }, { expect: [403] });
  await loginAs(ADA, 'geheim-geheim');
});

await step('Zuständig Pflicht: Statuswechsel von Hand nur mit Zuständigem', async () => {
  const n = await createItem({ type: 'incident', title: `Pflicht ${RUN}` });
  const inProgress = status('incident', 'in_progress');
  required(await api('POST', `/items/${n}/move`, { statusId: inProgress.id }, { expect: [400] }), 'In Arbeit');
  let d = await detail(n);
  assert.deepEqual([d.status.id, d.assignee], [status('incident', 'new').id, null], 'nichts geändert');

  // Mit Zuständigem: zugewiesen und verschoben, beides im Verlauf, Mail «Zugewiesen»
  await api('POST', `/items/${n}/move`, { statusId: inProgress.id, assigneeId: ivan.id });
  d = await detail(n);
  assert.deepEqual([d.status.id, d.assignee.id], [inProgress.id, ivan.id]);
  const assigned = d.entries.find((e) => e.kind === 'change' && e.meta.field === 'assignee');
  assert.deepEqual([assigned.meta.from, assigned.meta.to], [null, ivan.name]);
  assert.ok(d.entries.some((e) => e.kind === 'status' && e.meta.to === 'In Arbeit'));
  await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Zugewiesen: Pflicht ${RUN}`, 'Zugewiesen beim Statuswechsel');

  // Mit Zuständigem gilt «assigneeId» nicht; leeren geht nicht, eine andere Person schon
  await api('POST', `/items/${n}/move`, { statusId: status('incident', 'waiting').id, assigneeId: anna.id });
  assert.equal((await detail(n)).assignee.id, ivan.id);
  required(await api('PATCH', `/items/${n}`, { assigneeId: null }, { expect: [400] }), 'Wartet auf Melder');
  const ada = (await api('GET', '/users/staff')).find((u) => u.email === ADA);
  await api('PATCH', `/items/${n}`, { assigneeId: ada.id });
  assert.equal((await detail(n)).assignee.id, ada.id);
  // Zuständig nur aktive IT-Benutzer
  const other = await createItem({ type: 'incident', title: `Pflicht Melderin ${RUN}` });
  assert.match(
    (await api('POST', `/items/${other}/move`, { statusId: inProgress.id, assigneeId: anna.id }, { expect: [400] })).message,
    /aktive IT-Benutzer/,
  );
  // In einen Status ohne Pflicht (Neu) und darin leeren geht
  await api('POST', `/items/${n}/move`, { statusId: status('incident', 'new').id });
  await api('PATCH', `/items/${n}`, { assigneeId: null });
});

await step('Zuständig Pflicht: bestehende Vorgänge ohne Zuständigen, Board, Ablehnen, Typ, Erfassen', async () => {
  // Steht ein Vorgang schon ohne Zuständigen in einem solchen Status, gilt die Pflicht erst beim nächsten Wechsel
  const a = await createItem({ type: 'task', title: `Pflicht alt ${RUN}` });
  const b = await createItem({ type: 'task', title: `Pflicht Nachbar ${RUN}` });
  await api('PATCH', `/items/${b}`, { assigneeId: ivan.id });
  await api('POST', `/items/${b}/move`, { statusId: status('task', 'in_progress').id });
  await placeWithoutAssignee(a, 'task', 'in_progress');
  await api('POST', `/items/${a}/move`, { statusId: status('task', 'in_progress').id, afterId: (await detail(b)).id });
  assert.equal((await detail(a)).assignee, null, 'Einordnen im Board ohne Zuständigen');
  required(await api('POST', `/items/${a}/move`, { statusId: status('task', 'done').id }, { expect: [400] }), 'Erledigt');

  // Ablehnen: Der Ablehnen-Status verlangt einen Zuständigen
  const c = await createItem({ type: 'task', title: `Pflicht ablehnen ${RUN}` });
  required(await api('POST', `/items/${c}/reject`, { reason: 'Nicht nötig', notify: false }, { expect: [400] }), 'Abgelehnt');
  await api('POST', `/items/${c}/reject`, { reason: 'Nicht nötig', notify: false, assigneeId: ivan.id });
  const rejected = await detail(c);
  assert.deepEqual([rejected.status.id, rejected.assignee.id], [status('task', 'rejected').id, ivan.id]);

  // Typwechsel in einen solchen Status
  const d = await createItem({ type: 'task', title: `Pflicht Typ ${RUN}` });
  const target = { type: 'incident', statusId: status('incident', 'in_progress').id };
  required(await api('POST', `/items/${d}/type`, target, { expect: [400] }), 'In Arbeit');
  await api('POST', `/items/${d}/type`, { ...target, assigneeId: ivan.id });
  const typed = await detail(d);
  assert.deepEqual([typed.type, typed.assignee.id], ['incident', ivan.id]);

  // Erfassen mit einem solchen Status
  const fields = { type: 'incident', title: `Pflicht erfasst ${RUN}`, statusId: status('incident', 'in_progress').id };
  const f = new FormData();
  for (const [k, v] of Object.entries({ channelId: channel('Telefon').id, ...fields })) f.append(k, v);
  required(await api('POST', '/items', f, { expect: [400] }), 'In Arbeit');
  const e = await createItem({ ...fields, assigneeId: ivan.id });
  const created = await detail(e);
  assert.deepEqual([created.status.id, created.assignee.id], [status('incident', 'in_progress').id, ivan.id]);
});

await step('Zuständig Pflicht: automatische Wechsel ohne Zuständigen (Antwort der Melderin)', async () => {
  const n = await createItem({ type: 'incident', title: `Pflicht Antwort ${RUN}`, reporterId: anna.id });
  await placeWithoutAssignee(n, 'incident', 'resolved');
  await loginAs(ANNA, 'anna-passwort-1');
  const f = new FormData();
  f.append('body', 'Geht doch nicht.');
  await api('POST', `/portal/items/${n}/replies`, f);
  await loginAs(ADA, 'geheim-geheim');
  const d = await detail(n);
  assert.deepEqual([d.status.id, d.assignee], [status('incident', 'in_progress').id, null]);
});

// Für die übrigen Prüfungen (Browser) wieder ohne Pflicht, auch wenn ein Schritt oben fehlschlug
await step('Zuständig Pflicht: wieder ausschalten', async () => {
  await loginAs(ADA, 'geheim-geheim');
  await setRequired(false);
});
