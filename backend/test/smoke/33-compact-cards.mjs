// Smoke-Test, Bereich «Kleine Karten» (läuft über test/smoke.mjs, Entscheid vom 20.11.2026): je Status einstellbar,
// Vorgabe für Backlog und Erledigt der Aufgaben
import { api, assert, IVAN, loginAs, RUN, step } from './lib.mjs';

await step('Kleine Karten: Vorgabe Backlog und Erledigt, je Status umstellbar, nur Admins', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const statuses = await api('GET', '/statuses');
  const compact = statuses.filter((s) => s.compactCards).map((s) => `${s.type}:${s.key}`).sort();
  assert.deepEqual(compact, ['task:backlog', 'task:done'], 'Vorgabe');
  const planned = statuses.find((s) => s.type === 'task' && s.key === 'planned');
  assert.equal((await api('PATCH', `/statuses/${planned.id}`, { compactCards: true })).compactCards, true);
  assert.equal((await api('GET', '/statuses')).find((s) => s.id === planned.id).compactCards, true);
  await api('PATCH', `/statuses/${planned.id}`, { compactCards: 'ja' }, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  await api('PATCH', `/statuses/${planned.id}`, { compactCards: false }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  await api('PATCH', `/statuses/${planned.id}`, { compactCards: false });
  // Neuer Status gleich mit kleinen Karten
  const created = await api('POST', '/statuses', { type: 'task', label: `Klein ${RUN}`, closed: false, compactCards: true });
  assert.equal(created.compactCards, true);
  await api('DELETE', `/statuses/${created.id}`);
  const { entries } = await api('GET', '/admin/audit-log?area=admin&limit=20');
  assert.ok(entries.some((e) => e.action === 'Status geändert'), 'im Aktionsprotokoll');
});
