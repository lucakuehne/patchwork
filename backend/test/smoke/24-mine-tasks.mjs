// Smoke-Test, Bereich «Nur meine» bei Aufgaben (läuft über test/smoke.mjs, Entscheid vom 06.11.2026): mir zugewiesen und
// offene ohne Zuständige, ausser im Start-Status (Backlog); abgeschlossene ohne Zuständige nicht
import { api, assert, createItem, detail, loginAs, RUN, state, status, step } from './lib.mjs';

const { ivan } = state;

await step('Nur meine bei Aufgaben: zugewiesene und offene ohne Zuständige, ausser im Backlog', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const ada = (await api('GET', '/users/staff')).find((u) => u.email === 'ada@test.local');
  const backlog = await createItem({ type: 'task', title: `Meine Backlog ${RUN}` });
  const planned = await createItem({ type: 'task', title: `Meine Geplant ${RUN}`, statusId: status('task', 'planned').id });
  const others = await createItem({ type: 'task', title: `Meine Ivan ${RUN}`, assigneeId: ivan.id });
  const mineInBacklog = await createItem({ type: 'task', title: `Meine Ada ${RUN}`, assigneeId: ada.id });
  assert.equal((await detail(backlog)).status.id, status('task', 'backlog').id);

  for (const view of ['tasks', 'board']) {
    const numbers = (await api('GET', `/items?view=${view}&mine=1`)).items.map((i) => i.number);
    assert.ok(numbers.includes(planned), `${view}: offen ohne Zuständigen`);
    assert.ok(numbers.includes(mineInBacklog), `${view}: mir zugewiesen, auch im Backlog`);
    assert.ok(!numbers.includes(backlog), `${view}: ohne Zuständigen im Backlog nicht`);
    assert.ok(!numbers.includes(others), `${view}: anderen zugewiesen nicht`);
  }

  // Erledigt ohne Zuständigen: nicht unter «Nur meine», auch nicht in der Spalte «Erledigt» des Boards
  await api('POST', `/items/${planned}/move`, { statusId: status('task', 'done').id });
  assert.ok(!(await api('GET', '/items?view=tasks-done&mine=1')).items.some((i) => i.number === planned));
  assert.ok(!(await api('GET', '/items?view=board&mine=1')).items.some((i) => i.number === planned));
  assert.ok((await api('GET', '/items?view=tasks-done')).items.some((i) => i.number === planned), 'ohne Filter sichtbar');
});
