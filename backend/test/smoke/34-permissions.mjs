// Smoke-Test, Bereich «Rechte» (läuft über test/smoke.mjs, Entscheid vom 20.11.2026): Rechte je Rolle unter
// Verwaltung → Rechte; Admins haben alle, Standard-Benutzer keine, die Rechte der IT stellt man ein
import { api, assert, cookie, IVAN, loginAs, RUN, setSessionCookie, step } from './lib.mjs';

const ADA = 'ada@test.local';
const DEFAULT = { it: ['inbox', 'incident', 'task'] };
const period = () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 3600 * 1000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FZurich`;
};
/** Rechte der IT setzen (als Ada) und als Ivan weiterarbeiten */
async function itWith(permissions) {
  await loginAs(ADA, 'geheim-geheim');
  const saved = await api('PUT', '/settings/permissions', { it: permissions });
  await loginAs(IVAN, 'geheim-geheim');
  return saved;
}

await step('Rechte: Vorgabe, «Pläne bearbeiten» schliesst «Pläne ansehen» ein, mindestens ein Bereich', async () => {
  await loginAs(ADA, 'geheim-geheim');
  assert.deepEqual(await api('GET', '/settings/permissions'), DEFAULT, 'Vorgabe: Eingang, Störungen, Aufgaben');
  assert.deepEqual((await api('GET', '/areas')).permissions, ['inbox', 'incident', 'task', 'plansView', 'plansEdit', 'reports', 'admin'], 'Admins: alle');
  assert.deepEqual(await api('PUT', '/settings/permissions', { it: ['plansEdit', 'task'] }), { it: ['task', 'plansView', 'plansEdit'] });
  assert.match((await api('PUT', '/settings/permissions', { it: ['reports', 'admin'] }, { expect: [400] })).message, /mindestens eines dieser Rechte/);
  await api('PUT', '/settings/permissions', { it: ['task', 'alles'] }, { expect: [400] });
  await api('PUT', '/settings/permissions', {}, { expect: [400] });
  await loginAs(IVAN, 'geheim-geheim');
  assert.deepEqual(await api('GET', '/areas'), { areas: ['task', 'plans'], permissions: ['task', 'plansView', 'plansEdit'] });
  // Mit «Pläne bearbeiten» legt die IT an und löscht
  const site = await api('POST', '/plans/sites', { name: `Rechte ${RUN}` });
  await api('DELETE', `/plans/sites/${site.id}`);
  await api('PUT', '/settings/permissions', DEFAULT, { expect: [403] });
});

await step('Rechte: Auswertungen und Verwaltung für die IT, gelten sofort', async () => {
  await itWith(['task']);
  assert.match((await api('GET', `/admin/reports?${period()}`, undefined, { expect: [403] })).message, /Dafür fehlt das Recht «Auswertungen»/);
  assert.match((await api('GET', '/admin/audit-log?limit=1', undefined, { expect: [403] })).message, /Dafür fehlt das Recht «Verwaltung»/);
  await api('GET', '/admin/alerts', undefined, { expect: [403] });

  await itWith(['task', 'reports']);
  assert.ok((await api('GET', `/admin/reports?${period()}`)).flow, 'Auswertungen mit dem Recht');
  await api('GET', '/admin/users', undefined, { expect: [403] });

  await itWith(['task', 'admin']);
  await api('GET', '/admin/audit-log?limit=1');
  await api('GET', '/admin/alerts');
  await api('GET', '/admin/users');
  await api('GET', `/admin/reports?${period()}`, undefined, { expect: [403] });
  // Mit «Verwaltung» auch die Rechte selbst
  assert.deepEqual(await api('GET', '/settings/permissions'), { it: ['task', 'admin'] });
  // Entzogen: gilt in Ivans laufender Sitzung sofort (Ada meldet sich daneben an, ohne Ivan abzumelden)
  const ivanSession = cookie;
  setSessionCookie('');
  await api('POST', '/auth/login', { username: ADA, password: 'geheim-geheim' });
  await api('PUT', '/settings/permissions', { it: ['task'] });
  const adaSession = cookie;
  setSessionCookie(ivanSession);
  assert.equal((await api('GET', '/auth/me')).user.email, IVAN);
  await api('GET', '/admin/audit-log?limit=1', undefined, { expect: [403] });
  setSessionCookie(adaSession);
});

await step('Rechte: im Aktionsprotokoll, zurück zur Vorgabe', async () => {
  await loginAs(ADA, 'geheim-geheim');
  await api('PUT', '/settings/permissions', DEFAULT);
  assert.deepEqual(await api('GET', '/settings/permissions'), DEFAULT);
  const { entries } = await api('GET', '/admin/audit-log?area=admin&limit=50');
  assert.ok(entries.some((e) => e.action === 'Rechte geändert'), 'Rechte geändert');
  // Die frühere Adresse gibt es nicht mehr
  await api('GET', '/settings/areas', undefined, { expect: [404] });
});
