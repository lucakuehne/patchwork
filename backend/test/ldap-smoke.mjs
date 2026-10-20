// LDAP-Test gegen eine laufende Patchwork-Instanz und einen OpenLDAP-Testserver.
// Achtung: Speichert LDAP-Einstellungen und setzt sie am Ende zurück. Nur gegen eine Test-Instanz laufen lassen.
//
//   docker run -d --name patchwork-ldap -p 10389:389 -e LDAP_ORGANISATION=Test -e LDAP_DOMAIN=test.local \
//     -e LDAP_ADMIN_PASSWORD=admin-pw osixia/openldap:1.5.0
//   docker exec -i patchwork-ldap ldapadd -x -H ldap://localhost -D cn=admin,dc=test,dc=local -w admin-pw < test/ldap-seed.ldif
//
//   node test/ldap-smoke.mjs <Basis-URL> <Admin-E-Mail> <Admin-Passwort>
import assert from 'node:assert/strict';

const [base = 'http://localhost:8080', adminEmail, adminPassword] = process.argv.slice(2);
if (!adminEmail || !adminPassword) {
  console.error('Aufruf: node test/ldap-smoke.mjs <Basis-URL> <Admin-E-Mail> <Admin-Passwort>');
  process.exit(2);
}
const BASE = `${base}/api`;

async function call(cookie, method, path, body, expect = [200, 201, 204]) {
  const headers = { 'x-patchwork': '1', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return { status: res.status, data: text ? JSON.parse(text) : undefined, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const login = (username, password, expect) => call('', 'POST', '/auth/login', { username, password }, expect);

const settings = {
  enabled: true,
  url: 'ldap://localhost:10389',
  startTls: false,
  rejectUnauthorized: true,
  caCertificate: '',
  bindDn: 'cn=admin,dc=test,dc=local',
  bindPassword: 'admin-pw',
  baseDn: 'dc=test,dc=local',
  userFilter: '(&(objectClass=inetOrgPerson)(|(uid={{username}})(mail={{username}})))',
  nameAttribute: 'displayName',
  mailAttribute: 'mail',
  adminGroupDn: 'cn=patchwork-admin,ou=groups,dc=test,dc=local',
  itGroupDn: 'cn=patchwork-it,ou=groups,dc=test,dc=local',
  nestedGroups: false,
};

async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
}

const info = (await call('', 'GET', '/public/info')).data;
if (info.setupRequired) {
  await call('', 'POST', '/setup', { appName: 'LDAP-Test', name: 'Admin', email: adminEmail, password: adminPassword });
}
const admin = (await login(adminEmail, adminPassword)).cookie;
const current = (await call(admin, 'GET', '/settings/ldap')).data;
if (current.url && !current.url.includes('localhost:10389')) {
  console.error(`Abbruch: Die Instanz hat bereits LDAP-Einstellungen (${current.url}). Bitte eine Test-Instanz verwenden.`);
  process.exit(3);
}
// Standard-Benutzer melden sich im Portal an; ohne Einstellung ist es aus
await call(admin, 'PUT', '/settings/portal', { access: 'all', emails: [], groupDn: '' });
const diagnose = async (overrides, username, password) =>
  (await call(admin, 'POST', '/settings/ldap/test', { ...settings, ...overrides, username, password })).data.checks;
const byKey = (checks) => Object.fromEntries(checks.map((c) => [c.key, c]));

await step('Diagnose mit korrekten Einstellungen', async () => {
  const c = byKey(await diagnose({}, 'lena', 'lena-passwort'));
  assert.equal(c.server.status, 'ok');
  assert.equal(c.tls.status, 'warning', 'unverschlüsselt');
  assert.equal(c.bind.status, 'ok');
  assert.equal(c.base.status, 'ok');
  assert.equal(c.directory.status, 'ok');
  assert.match(c.directory.message, /LDAP-Server/);
  assert.equal(c.filter.status, 'ok');
  assert.match(c.filter.message, /4 Benutzer gefunden/);
  assert.match(c.filter.message, /1 davon ohne/);
  assert.equal(c.adminGroup.status, 'ok');
  assert.equal(c.itGroup.status, 'ok');
  assert.equal(c.user.status, 'ok');
  assert.match(c.user.message, /Rolle IT/);
  assert.equal(c.login.status, 'ok');
});

await step('Diagnose: falsches Testpasswort', async () => {
  assert.equal(byKey(await diagnose({}, 'lena', 'falsch')).login.status, 'error');
});

await step('Diagnose: Server nicht erreichbar', async () => {
  const c = byKey(await diagnose({ url: 'ldap://localhost:10399' }));
  assert.equal(c.server.status, 'error');
  assert.equal(c.bind.status, 'skipped');
});

await step('Diagnose: ungültige URL', async () => {
  assert.equal(byKey(await diagnose({ url: 'http://x' })).server.status, 'error');
});

await step('Diagnose: falsches Dienstkonto-Passwort', async () => {
  const c = byKey(await diagnose({ bindPassword: 'falsch' }));
  assert.equal(c.bind.status, 'error');
  assert.match(c.bind.message, /abgelehnt/);
  assert.equal(c.base.status, 'skipped');
});

await step('Diagnose: Basis-DN existiert nicht', async () => {
  const c = byKey(await diagnose({ baseDn: 'dc=gibtsnicht,dc=local' }));
  assert.equal(c.base.status, 'error');
  assert.equal(c.filter.status, 'skipped');
});

await step('Diagnose: Gruppe existiert nicht, Filter findet nichts', async () => {
  const c = byKey(
    await diagnose({ adminGroupDn: 'cn=fehlt,ou=groups,dc=test,dc=local', userFilter: '(&(objectClass=device)(cn={{username}}))' }),
  );
  assert.equal(c.adminGroup.status, 'error');
  assert.equal(c.filter.status, 'warning');
});

await step('Einstellungen speichern', async () => {
  const saved = (await call(admin, 'PUT', '/settings/ldap', settings)).data;
  assert.equal(saved.hasBindPassword, true);
  assert.equal(saved.bindPasswordEnc, undefined);
});

const searchPeople = async (q) => (await call(admin, 'GET', `/people/search?q=${encodeURIComponent(q)}`)).data;

await step('Personensuche im Verzeichnis: Name und Anmeldename, ohne Konten ohne E-Mail', async () => {
  const sam = await searchPeople('standard SAM');
  assert.equal(sam.directoryError, null);
  assert.deepEqual(
    sam.people.map((p) => [p.email, p.name, p.username, p.source, p.id]),
    [['sam@test.local', 'Sam Standard', 'sam', 'directory', null]],
  );
  assert.deepEqual((await searchPeople('nomail')).people, []);
  assert.ok(!(await searchPeople('s')).people.some((p) => p.source === 'directory'), 'Verzeichnis erst ab 2 Zeichen');
});

await step('Vor- und Nachname aus givenName und sn: vorab angelegt und neue Kontakte', async () => {
  // Aus dem Namen geschätzt wäre es «Otto von» / «Ober»
  const otto = (await call(admin, 'POST', '/admin/users/directory', { email: 'otto@test.local', role: 'auto' })).data;
  assert.deepEqual(
    [otto.name, otto.firstName, otto.lastName, otto.role, otto.authSource],
    ['Otto von Ober', 'Otto', 'von Ober', 'admin', 'ldap'],
  );
  // Neuer Kontakt (z.B. Absender einer Mail): im Verzeichnis per E-Mail nachgeschlagen, der Name bleibt
  const sam = (await call(admin, 'POST', '/users/contacts', { email: 'sam@test.local', name: 'sam' })).data;
  assert.deepEqual([sam.name, sam.firstName, sam.lastName], ['sam', 'Sam', 'Standard']);
  // Ohne Konto im Verzeichnis aus dem Namen geschätzt
  const extern = (await call(admin, 'POST', '/users/contacts', { email: 'muster@extern.test', name: 'Muster, Anna' })).data;
  assert.deepEqual([extern.firstName, extern.lastName], ['Anna', 'Muster']);
});

await step('Login IT-Benutzer (Benutzername)', async () => {
  const res = await login('lena', 'lena-passwort');
  assert.equal(res.data.role, 'it');
  assert.equal(res.data.email, 'lena@test.local');
  assert.equal(res.data.name, 'Lena Lind');
  assert.deepEqual([res.data.firstName, res.data.lastName], ['Lena', 'Lind'], 'aus givenName und sn');
});

await step('Login Admin-Benutzer (E-Mail)', async () => {
  const otto = (await login('otto@test.local', 'otto-passwort')).data;
  assert.equal(otto.role, 'admin');
  assert.deepEqual([otto.firstName, otto.lastName], ['Otto', 'von Ober']);
});

await step('Falsches Passwort, Standard-Benutzer (Portal), ohne Mail', async () => {
  await login('lena', 'falsch', [401]);
  assert.equal((await login('sam', 'sam-passwort')).data.role, 'standard', 'Standard-Benutzer: Portal');
  await login('nomail', 'nomail-passwort', [401]);
});

await step('Benutzerliste zeigt LDAP-Benutzer', async () => {
  const users = (await call(admin, 'GET', '/admin/users')).data;
  const lena = users.find((u) => u.email === 'lena@test.local');
  assert.equal(lena.authSource, 'ldap');
  assert.equal(lena.role, 'it');
  const sam = users.find((u) => u.email === 'sam@test.local');
  assert.equal(sam.role, 'standard', 'Kontakt wird beim ersten Login zum LDAP-Benutzer');
  assert.deepEqual([sam.authSource, sam.name, sam.firstName, sam.lastName], ['ldap', 'Sam Standard', 'Sam', 'Standard']);
});

await step('Personensuche: bekannte Konten erscheinen als Patchwork-Benutzer mit Anmeldename', async () => {
  const { people } = await searchPeople('lind');
  assert.deepEqual(
    people.map((p) => [p.email, p.username, p.source, !!p.id]),
    [['lena@test.local', 'lena', 'patchwork', true]],
  );
});

await step('Regel mit LDAP-Gruppe: Meldung eines IT-Mitglieds erhält Priorität hoch', async () => {
  const rule = (
    await call(admin, 'POST', '/admin/rules', {
      name: 'IT-Gruppe',
      triggers: ['portal_new'],
      conditions: { kind: 'group', op: 'and', children: [{ kind: 'condition', field: 'adGroup', operator: 'member', value: settings.itGroupDn }] },
      actions: { priority: 'high' },
    })
  ).data;
  const report = async (username, password, title) => {
    const cookie = (await login(username, password)).cookie;
    return (await call(cookie, 'POST', '/portal/items', { type: 'incident', title, description: 'Test' })).data.number;
  };
  const fromLena = await report('lena', 'lena-passwort', 'Von Lena');
  const fromSam = await report('sam', 'sam-passwort', 'Von Sam');
  assert.equal((await call(admin, 'GET', `/items/${fromLena}`)).data.priority, 'high');
  assert.equal((await call(admin, 'GET', `/items/${fromSam}`)).data.priority, 'normal');
  await call(admin, 'DELETE', `/admin/rules/${rule.id}`);
});

await step('LDAP-Einstellungen zurücksetzen', async () => {
  await call(admin, 'PUT', '/settings/ldap', {
    ...settings,
    enabled: false,
    url: '',
    bindDn: '',
    bindPassword: '',
    baseDn: '',
    adminGroupDn: '',
    itGroupDn: '',
  });
  await login('lena', 'lena-passwort', [401]);
});

console.log('\nAlle LDAP-Prüfungen bestanden.');
