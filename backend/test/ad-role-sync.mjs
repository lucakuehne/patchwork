// Zweistufiger Test im Runner des Test-Stacks: Rolle «Aus AD-Gruppen» wird beim Speichern nachgezogen.
//   node test/ad-role-sync.mjs anlegen   → jan (IT im AD) vorab anlegen
//   node test/ad-role-sync.mjs pruefen   → nachdem jan im AD aus der IT-Gruppe entfernt wurde
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:8080/api';
const BASE_DN = 'DC=test,DC=patchwork';
const settings = {
  enabled: true,
  url: 'ldap://localhost:11389',
  startTls: true,
  rejectUnauthorized: true,
  caCertificate: readFileSync('/testfiles/tls/ca.pem', 'utf8'),
  bindDn: 'svc-patchwork@test.patchwork',
  bindPassword: 'Svc-Passw0rd!',
  baseDn: BASE_DN,
  userFilter: '(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
  nameAttribute: 'displayName',
  mailAttribute: 'mail',
  adminGroupDn: `CN=patchwork-admin,CN=Users,${BASE_DN}`,
  itGroupDn: `CN=patchwork-it,CN=Users,${BASE_DN}`,
  nestedGroups: true,
};

async function call(cookie, method, path, body, expect = [200, 201, 204]) {
  const headers = { 'x-patchwork': '1', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return { data: text ? JSON.parse(text) : undefined, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const admin = (await call('', 'POST', '/auth/login', { username: 'ada@test.local', password: 'geheim-geheim' })).cookie;
await call(admin, 'PUT', '/settings/ldap', settings);
const jan = () => call(admin, 'GET', '/admin/users').then((r) => r.data.find((u) => u.email === 'jan@test.patchwork'));

if (process.argv[2] === 'anlegen') {
  const created = (await call(admin, 'POST', '/admin/users/directory', { email: 'jan@test.patchwork', role: 'auto' })).data;
  assert.deepEqual([created.role, created.roleManual], ['it', false]);
  console.log('jan angelegt: it, aus AD-Gruppen');
} else {
  const before = await jan();
  assert.equal(before.role, 'it', 'gespeichert noch IT');
  const suggestion = (await call(admin, 'GET', '/admin/users/directory?email=jan@test.patchwork')).data;
  assert.equal(suggestion.role, 'standard', 'im AD nicht mehr IT');
  const saved = (await call(admin, 'PATCH', `/admin/users/${before.id}`, { name: before.name, role: 'auto', active: true })).data;
  assert.deepEqual([saved.role, saved.roleManual], ['standard', false]);
  // AD nicht erreichbar: Speichern geht trotzdem, Rolle bleibt
  await call(admin, 'PUT', '/settings/ldap', { ...settings, bindPassword: 'falsch' });
  const offline = (await call(admin, 'PATCH', `/admin/users/${before.id}`, { name: 'Jan Jost', role: 'auto', active: true })).data;
  assert.deepEqual([offline.name, offline.role, offline.roleManual], ['Jan Jost', 'standard', false]);
  // Von Hand zurück auf «Aus AD-Gruppen» braucht das AD
  await call(admin, 'PATCH', `/admin/users/${before.id}`, { role: 'it' });
  await call(admin, 'PATCH', `/admin/users/${before.id}`, { role: 'auto' }, [503]);
  console.log('Rolle nachgezogen: standard; ohne AD bleibt sie, Wechsel von Hand zurück verlangt das AD');
}
await call(admin, 'PUT', '/settings/ldap', { ...settings, enabled: false, url: '', startTls: false, caCertificate: '', bindDn: '', bindPassword: '', baseDn: '', adminGroupDn: '', itGroupDn: '' });
