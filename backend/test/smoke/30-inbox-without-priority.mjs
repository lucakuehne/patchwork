// Smoke-Test, Bereich «Eingang ohne Priorität und Zuständig» (läuft über test/smoke.mjs, Entscheid vom 13.11.2026):
// Erst mit einem Typ gibt es Priorität und Zuständig, auch bei Regeln, Filtern, Auswertungen und CSV
import { api, assert, BASE, cond, cookie, detail, group, inboxNumber, IVAN, loginAs, poll, RUN, sendMail, sleep, state, step } from './lib.mjs';

const { ivan } = state;
const TYPE_FIRST = 'Priorität und Zuständig gibt es erst, wenn der Vorgang einen Typ hat (Störung oder Aufgabe)';
const SENDER = `regel-typ-${RUN}@test.local`;
const staysSubject = `Bleibt im Eingang ${RUN}`;
let stays = 0;

await step('Eingang: Priorität und Zuständig erst mit einem Typ', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const subject = `Ohne Typ ${RUN}`;
  await sendMail({ from: `ohne-typ-${RUN}@test.local`, subject, text: 'Hallo' });
  await sleep(500);
  await poll();
  const n = await inboxNumber(subject);
  const d = await detail(n);
  assert.deepEqual([d.type, d.priority, d.assignee], [null, 'normal', null]);
  assert.equal((await api('PATCH', `/items/${n}`, { priority: 'high' }, { expect: [400] })).message, TYPE_FIRST);
  assert.equal((await api('PATCH', `/items/${n}`, { assigneeId: ivan.id }, { expect: [400] })).message, TYPE_FIRST);
  // Unverändert geht (z.B. ein Formular, das alle Felder schickt)
  await api('PATCH', `/items/${n}`, { priority: 'normal', assigneeId: null });
  // Filter nach Priorität und Zuständig gelten im Eingang nicht
  for (const filter of ['priority=high', `assignee=${ivan.id}`]) {
    const { items } = await api('GET', `/items?view=inbox&${filter}`);
    assert.ok(items.some((i) => i.number === n), `Eingang mit ${filter}`);
  }
  // Mit Typ: beides wählbar
  await api('POST', `/items/${n}/type`, { type: 'incident' });
  await api('PATCH', `/items/${n}`, { priority: 'high', assigneeId: ivan.id });
  const typed = await detail(n);
  assert.deepEqual([typed.priority, typed.assignee?.email], ['high', IVAN]);
});

await step('Regeln: Priorität und Zuständig nur, wenn der Vorgang am Ende einen Typ hat', async () => {
  const people = await api('POST', '/admin/rules', {
    name: `Zuständig ohne Typ ${RUN}`,
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', SENDER)),
    actions: { priority: 'high', assigneeId: ivan.id },
  });
  // Eine spätere Regel setzt den Typ: dann gilt auch, was die frühere gesetzt hat
  const typing = await api('POST', '/admin/rules', {
    name: `Typ später ${RUN}`,
    triggers: ['mail_new'],
    conditions: group('and', cond('sender', 'is', SENDER), cond('subject', 'contains', 'Mit Typ')),
    actions: { type: 'incident' },
  });
  try {
    await sendMail({ from: SENDER, subject: staysSubject, text: 'Ohne Typ' });
    await sendMail({ from: SENDER, subject: `Mit Typ ${RUN}`, text: 'Mit Typ' });
    await sleep(500);
    await poll();
    stays = await inboxNumber(staysSubject);
    const inInbox = await detail(stays);
    assert.deepEqual([inInbox.type, inInbox.priority, inInbox.assignee], [null, 'normal', null], 'im Eingang ohne Priorität und Zuständig');
    assert.ok(!inInbox.entries.some((e) => e.meta?.field === 'rule'), 'keine Regel mit Wirkung im Verlauf');

    const typedItem = (await api('GET', '/items?view=incidents')).items.find((i) => i.title === `Mit Typ ${RUN}`);
    assert.ok(typedItem, 'Störung aus der Regel');
    const typed = await detail(typedItem.number);
    assert.deepEqual([typed.type, typed.priority, typed.assignee?.email], ['incident', 'high', IVAN]);
    const rules = typed.entries.filter((e) => e.meta?.field === 'rule').map((e) => e.meta.ruleName);
    assert.deepEqual(rules, [`Zuständig ohne Typ ${RUN}`, `Typ später ${RUN}`]);
  } finally {
    await api('DELETE', `/admin/rules/${people.id}`);
    await api('DELETE', `/admin/rules/${typing.id}`);
  }
});

await step('Auswertungen und CSV: Eingang ohne Priorität und Zuständig', async () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 3600 * 1000).toISOString();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FZurich`;
  const r = await api('GET', `/admin/reports?${query}&bucket=day`);
  assert.ok(r.open.inbox > 0, 'es gibt offene im Eingang');
  assert.ok(r.open.byPriority.every((x) => x.type !== null), 'nach Priorität ohne Eingang');
  assert.ok(r.open.byAssignee.every((x) => x.type !== null), 'nach Zuständigem ohne Eingang');
  const csv = await (await fetch(`${BASE}/admin/reports/items.csv?${query}`, { headers: { cookie } })).text();
  const line = csv.split('\r\n').find((l) => l.startsWith(`PW-${stays};`));
  assert.ok(line, 'Vorgang im Eingang im CSV');
  const [, type, , status, priority, , , assignee] = line.split(';');
  assert.deepEqual([type, status, priority, assignee], ['Eingang', '', '', '']);
});
