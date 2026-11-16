// Smoke-Test, Bereich «Typ wählen und Typ korrigiert» (läuft über test/smoke.mjs, Entscheid vom 16.11.2026)
import { api, assert, cond, createItem, group, inboxNumber, IVAN, loginAs, poll, RUN, sendMail, sleep, state, status, step } from './lib.mjs';

const { anna } = state;
const ADA = 'ada@test.local';
const DEFAULT_GUIDE = {
  incident: { hint: 'Ging bisher, geht nicht mehr', examples: ['Drucker druckt nicht mehr', 'Kein Zugriff aufs Netzlaufwerk', 'Outlook startet nicht'] },
  task: { hint: 'Etwas Neues oder Anderes', examples: ['Zugang für eine neue Mitarbeiterin', 'Software installieren', 'Neues Gerät bestellen'] },
};
const period = () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 3600 * 1000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FZurich&bucket=day`;
};

await step('Typ wählen: Leitfrage und Beispiele, für die IT lesbar, nur Admins ändern', async () => {
  await loginAs(IVAN, 'geheim-geheim');
  assert.deepEqual(await api('GET', '/settings/type-guide'), DEFAULT_GUIDE, 'Vorgabe, auch für die IT');
  await api('PUT', '/settings/type-guide', DEFAULT_GUIDE, { expect: [403] });
  await loginAs(ADA, 'geheim-geheim');
  const tooMany = Array.from({ length: 11 }, (_, i) => `Beispiel ${i}`);
  for (const wrong of [
    { ...DEFAULT_GUIDE, task: { hint: ' ', examples: [] } },
    { ...DEFAULT_GUIDE, task: { hint: 'x'.repeat(41), examples: [] } },
    { ...DEFAULT_GUIDE, task: { hint: 'Neu', examples: tooMany } },
    { ...DEFAULT_GUIDE, task: { hint: 'Neu', examples: ['x'.repeat(81)] } },
    { incident: DEFAULT_GUIDE.incident },
  ]) {
    await api('PUT', '/settings/type-guide', wrong, { expect: [400] });
  }
  // Leere und doppelte Beispiele fallen weg
  const saved = await api('PUT', '/settings/type-guide', { ...DEFAULT_GUIDE, task: { hint: ' Neu ', examples: ['Zugang', '', ' Zugang ', 'Monitor'] } });
  assert.deepEqual(saved.task, { hint: 'Neu', examples: ['Zugang', 'Monitor'] });
  assert.deepEqual((await api('GET', '/settings/type-guide')).task, saved.task);
  const { entries } = await api('GET', '/admin/audit-log?limit=20');
  assert.ok(entries.some((e) => e.action === '«Typ wählen» geändert'), 'im Aktionsprotokoll');
  await api('PUT', '/settings/type-guide', DEFAULT_GUIDE);
});

await step('Typ korrigiert: Zuweisungen je Person und Regel, Korrekturen mit Richtung', async () => {
  // Ivan weist eine Mail aus dem Eingang als Störung zu, Ada korrigiert zur Aufgabe
  const subject = `Typ falsch ${RUN}`;
  await sendMail({ from: `typ-${RUN}@test.local`, subject, text: 'Bitte neuen Zugang' });
  await sleep(500);
  await poll();
  const n = await inboxNumber(subject);
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', `/items/${n}/type`, { type: 'incident' });
  await loginAs(ADA, 'geheim-geheim');
  const backlog = status('task', 'backlog');
  await api('POST', `/items/${n}/type`, { type: 'task', statusId: backlog.id });

  // Ada erfasst eine Aufgabe, Ivan macht eine Störung daraus
  const created = await createItem({ type: 'task', title: `Erfasst falsch ${RUN}`, reporterId: anna.id });
  await loginAs(IVAN, 'geheim-geheim');
  await api('POST', `/items/${created}/type`, { type: 'incident' });
  await loginAs(ADA, 'geheim-geheim');

  // Eine Regel weist zu, Ada korrigiert
  const rule = await api('POST', '/admin/rules', {
    name: `Typ per Regel ${RUN}`,
    triggers: ['mail_new'],
    conditions: group('and', cond('subject', 'contains', `Regeltyp ${RUN}`)),
    actions: { type: 'incident' },
  });
  try {
    await sendMail({ from: `regeltyp-${RUN}@test.local`, subject: `Regeltyp ${RUN}`, text: 'Neues Gerät' });
    await sleep(500);
    await poll();
    const ruled = (await api('GET', '/items?view=incidents')).items.find((i) => i.title === `Regeltyp ${RUN}`);
    assert.ok(ruled, 'Störung aus der Regel');
    await api('POST', `/items/${ruled.number}/type`, { type: 'task', statusId: backlog.id });

    const report = await api('GET', `/admin/reports?${period()}`);
    const tc = report.typeCorrections;
    assert.ok(tc, 'Abschnitt bei «Alle»');
    const byNumber = (num) => tc.cases.find((c) => c.number === num);
    assert.deepEqual(
      [byNumber(n)?.from, byNumber(n)?.to, byNumber(n)?.assignedBy, byNumber(n)?.correctedBy],
      ['incident', 'task', 'Ivan IT', 'Ada Admin'],
      'aus dem Eingang zugewiesen, korrigiert',
    );
    assert.deepEqual([byNumber(created)?.from, byNumber(created)?.assignedBy, byNumber(created)?.correctedBy], ['task', 'Ada Admin', 'Ivan IT'], 'beim Erfassen');
    assert.deepEqual([byNumber(ruled.number)?.assignedBy, byNumber(ruled.number)?.correctedBy], [`Regel «Typ per Regel ${RUN}»`, 'Ada Admin'], 'durch eine Regel');
    const ivan = tc.byPerson.find((p) => p.name === 'Ivan IT');
    assert.ok(ivan && ivan.corrected >= 1 && ivan.assigned >= ivan.corrected, JSON.stringify(ivan));
    assert.ok(tc.corrected >= 3 && tc.assigned >= tc.corrected);
    assert.ok(tc.byPerson.every((p, i, all) => i === 0 || all[i - 1].corrected >= p.corrected), 'meiste Korrekturen zuerst');
    // Nur bei «Alle»
    assert.equal((await api('GET', `/admin/reports?${period()}&scope=incident`)).typeCorrections, null);
  } finally {
    await api('DELETE', `/admin/rules/${rule.id}`);
  }
});
