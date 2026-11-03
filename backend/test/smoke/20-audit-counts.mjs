// Smoke-Test, Bereich «Aktionsprotokoll, Zähler je Status, Arten von Mails» (läuft über test/smoke.mjs)
import { ANNA, api, assert, createItem, IVAN, loginAs, RUN, state, step } from './lib.mjs';

const { ivan, anna } = state;
const ADA = 'ada@test.local';
const log = async (query = '') => (await api('GET', `/admin/audit-log?limit=500${query ? `&${query}` : ''}`)).entries;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() + 86_400_000));

await step('Aktionsprotokoll: Anmeldungen, auch fehlgeschlagene', async () => {
  await api('POST', '/auth/logout');
  await api('POST', '/auth/login', { username: `niemand-${RUN}@test.local`, password: 'falsch-falsch' }, { expect: [401] });
  await loginAs(ADA, 'geheim-geheim');
  const entries = await log('area=account');
  assert.ok(entries.every((e) => e.area === 'account'));
  const failed = entries.find((e) => e.userName === `niemand-${RUN}@test.local`);
  assert.equal(failed?.action, 'Anmeldung fehlgeschlagen');
  assert.equal(failed.userId, null);
  assert.match(failed.target, /Benutzername und Passwort/);
  assert.ok(entries.some((e) => e.userName === 'Ada Admin' && e.action === 'Angemeldet'));
  assert.ok(entries.some((e) => e.userName === 'Ada Admin' && e.action === 'Abgemeldet'));
  // «Als dieser Benutzer arbeiten» (Bereich 15) unter dem Admin, mit dem Benutzer als Objekt
  assert.ok(entries.some((e) => e.action === '«Als dieser Benutzer arbeiten» gestartet' && e.target === anna.name));
  assert.ok(entries.some((e) => e.action === '«Als dieser Benutzer arbeiten» beendet' && e.userName === 'Ada Admin'));
});

await step('Aktionsprotokoll: Vorgänge, Verwaltung, Portal, Filter', async () => {
  const number = await createItem({ type: 'incident', title: `Protokoll ${RUN}` });
  await api('PATCH', `/items/${number}`, { priority: 'high' });
  const snippet = await api('POST', '/admin/snippets', { name: `Baustein ${RUN}`, body: 'Text' });
  await api('DELETE', `/admin/snippets/${snippet.id}`);

  // Suche nach der Kennung: die Einträge dieses Vorgangs, neueste zuerst, mit aktuellem Titel
  const ofItem = await log(`q=PW-${number}`);
  assert.deepEqual(
    ofItem.map((e) => e.action),
    ['Priorität geändert', 'Vorgang erfasst'],
  );
  assert.deepEqual(ofItem[1].item, { prefix: 'PW', number, type: 'incident', title: `Protokoll ${RUN}` });
  assert.equal(ofItem[1].target, `PW-${number} «Protokoll ${RUN}»`);
  assert.equal(ofItem[1].area, 'items');

  // Gelöschtes Objekt: Name vor dem Löschen
  const admin = await log(`area=admin&q=${encodeURIComponent(`Baustein ${RUN}`)}`);
  assert.deepEqual(
    admin.map((e) => [e.action, e.target]),
    [
      ['Textbaustein gelöscht', `Baustein ${RUN}`],
      ['Textbaustein erstellt', `Baustein ${RUN}`],
    ],
  );

  // Notiz als Ivan (Bereich 15): unter Ivan, durch Ada
  const asIvan = (await log(`q=${encodeURIComponent(`Als Ivan ${RUN}`)}`)).find((e) => e.action === 'Interne Notiz geschrieben');
  assert.equal(asIvan?.userName, ivan.name);
  assert.equal(asIvan.impersonatorName, 'Ada Admin');
  // Filter Person: auch Einträge, bei denen die Person als Admin dahinter stand
  const ofIvan = await log(`user=${ivan.id}`);
  assert.ok(ofIvan.length > 0 && ofIvan.every((e) => e.userId === ivan.id || e.impersonatorName === ivan.name));

  // Portal (Bereich 7): Meldungen von Anna
  const portal = await log('area=portal');
  assert.ok(portal.some((e) => e.userId === anna.id && e.action === 'Meldung erfasst' && e.item));

  // Zeitraum: heute mit Einträgen, ab morgen keine
  assert.ok((await log(`from=${today}&to=${today}`)).length > 0);
  assert.equal((await log(`from=${tomorrow}`)).length, 0);
  // Seiten: «more», Personen für den Filter
  const page = await api('GET', '/admin/audit-log?limit=2');
  assert.equal(page.entries.length, 2);
  assert.equal(page.more, true);
  const people = await api('GET', '/admin/audit-log/people');
  assert.ok(people.some((p) => p.email === ADA) && people.some((p) => p.email === IVAN));
  await api('GET', '/admin/audit-log?area=unbekannt', undefined, { expect: [400] });
});

await step('Aktionsprotokoll und Arten von Mails nur für Admins', async () => {
  await loginAs(IVAN, 'geheim-geheim');
  await api('GET', '/admin/audit-log', undefined, { expect: [403] });
  await api('GET', '/admin/mail-templates/kinds', undefined, { expect: [403] });
  await loginAs(ANNA, 'anna-passwort-1');
  await api('GET', '/admin/audit-log', undefined, { expect: [403] });
  await loginAs(ADA, 'geheim-geheim');
});

await step('Zähler je Status im Menü', async () => {
  const [counts, statuses, targets] = await Promise.all([api('GET', '/items/counts'), api('GET', '/statuses'), api('GET', '/statuses/targets')]);
  const open = (type) => statuses.filter((s) => s.type === type && !s.closed);
  const sum = (list) => list.reduce((n, s) => n + (counts.byStatus[s.id] ?? 0), 0);
  // Je Status nur offene; die Summe entspricht dem Zähler (Aufgaben ohne Backlog)
  assert.ok(Object.keys(counts.byStatus).every((id) => statuses.find((s) => s.id === id && !s.closed)));
  assert.ok(Object.values(counts.byStatus).every((n) => n > 0));
  assert.equal(sum(open('incident')), counts.incidents);
  assert.equal(sum(open('task').filter((s) => s.id !== targets.task.start)), counts.tasks);
  // Ohne Bereich Aufgaben: keine Status der Aufgaben
  await api('PUT', '/settings/areas', { it: ['inbox', 'incident'] });
  try {
    await loginAs(IVAN, 'geheim-geheim');
    const limited = await api('GET', '/items/counts');
    assert.equal(limited.tasks, 0);
    assert.ok(Object.keys(limited.byStatus).every((id) => statuses.find((s) => s.id === id).type === 'incident'));
  } finally {
    await loginAs(ADA, 'geheim-geheim');
    await api('PUT', '/settings/areas', { it: ['inbox', 'incident', 'task'] });
  }
});

await step('Arten von Mails: Erklärung und Stand der Regeln', async () => {
  const kinds = await api('GET', '/admin/mail-templates/kinds');
  const byKey = Object.fromEntries(kinds.map((k) => [k.key, k]));
  assert.ok(byKey.waitingReminder.description.includes('Melder per Mail erinnern'));
  assert.equal(byKey.confirmation.state, null);
  assert.equal(byKey.reporterFooter, undefined);
  assert.equal(byKey.duplicateRedirected.retired, true);
  const rules = await api('GET', '/admin/rules');
  const reminding = rules.filter((r) => r.active && r.actions.remindReporter).map((r) => `«${r.name}»`);
  assert.equal(
    byKey.waitingReminder.state,
    reminding.length
      ? `${reminding.length === 1 ? 'Aktive Regel' : 'Aktive Regeln'}: ${reminding.join(', ')}.`
      : 'Derzeit keine aktive Regel mit «Melder per Mail erinnern»: Diese Mail wird nicht verschickt.',
  );
});
