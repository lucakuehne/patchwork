// Active-Directory-Test gegen eine Patchwork-Instanz mit eigener Test-Datenbank und einen Samba-AD-Testserver.
// Achtung: Speichert LDAP-Einstellungen. Nicht gegen eine Instanz mit echten Einstellungen laufen lassen.
//
// Samba-AD mit Zertifikat für «localhost» (ca.pem, cert.pem, key.pem unter /var/lib/samba/private/tls/):
//   docker run -d --name patchwork-ad -p 11389:389 -p 11636:636 -e REALM=TEST.PATCHWORK -e DOMAIN=TESTPW \
//     -e ADMINPASS='Adm1n-Passw0rd!' smblds/smblds:latest
//   Testkonten: svc-patchwork, lena (IT), otto (Admin), nina (IT über verschachtelte Gruppe it-team),
//   sam (Standard, Gruppe patchwork-portal), dora (deaktiviert), nomail (ohne E-Mail) – siehe README.
//
//   node test/ad-smoke.mjs <Basis-URL> <Admin-E-Mail> <Admin-Passwort> <Pfad zu ca.pem>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [base, adminEmail, adminPassword, caPath] = process.argv.slice(2);
if (!base || !adminEmail || !adminPassword || !caPath) {
  console.error('Aufruf: node test/ad-smoke.mjs <Basis-URL> <Admin-E-Mail> <Admin-Passwort> <Pfad zu ca.pem>');
  process.exit(2);
}
const API = `${base}/api`;
const ca = readFileSync(caPath, 'utf8');

async function call(cookie, method, path, body, expect = [200, 201, 204]) {
  const headers = { 'x-patchwork': '1', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return { status: res.status, data: text ? JSON.parse(text) : undefined, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const login = (username, password, expect) => call('', 'POST', '/auth/login', { username, password }, expect);

async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
}

const BASE_DN = 'DC=test,DC=patchwork';
const settings = {
  enabled: true,
  url: 'ldap://localhost:11389',
  startTls: true,
  rejectUnauthorized: true,
  caCertificate: ca,
  bindDn: 'svc-patchwork@test.patchwork',
  bindPassword: 'Svc-Passw0rd!',
  baseDn: BASE_DN,
  userFilter:
    '(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
  nameAttribute: 'displayName',
  mailAttribute: 'mail',
  adminGroupDn: `CN=patchwork-admin,CN=Users,${BASE_DN}`,
  itGroupDn: `CN=patchwork-it,CN=Users,${BASE_DN}`,
  nestedGroups: true,
};

// Einrichtung, falls die Test-Instanz noch leer ist
const info = (await call('', 'GET', '/public/info')).data;
if (info.setupRequired) {
  await call('', 'POST', '/setup', { appName: 'AD-Test', name: 'Admin', email: adminEmail, password: adminPassword });
}
const admin = (await login(adminEmail, adminPassword)).cookie;
const current = (await call(admin, 'GET', '/settings/ldap')).data;
if (current.url && !current.url.includes('localhost:11389') && !current.url.includes('localhost:11636')) {
  console.error(`Abbruch: Die Instanz hat bereits LDAP-Einstellungen (${current.url}). Bitte eine Test-Instanz verwenden.`);
  process.exit(3);
}
// Standard-Benutzer melden sich im Portal an; ohne Einstellung ist es aus
await call(admin, 'PUT', '/settings/portal', { access: 'all', emails: [], groupDn: '' });

const diagnose = async (overrides = {}, username, password) => {
  const body = { ...settings, ...overrides, username, password };
  const checks = (await call(admin, 'POST', '/settings/ldap/test', body)).data.checks;
  return Object.fromEntries(checks.map((c) => [c.key, c]));
};

await step('Unverschlüsselt: Server verlangt Signierung (Code 8), verständlich erklärt', async () => {
  const c = await diagnose({ startTls: false });
  assert.equal(c.tls.status, 'warning');
  assert.equal(c.directory.status, 'ok');
  assert.match(c.directory.message, /Active Directory/);
  assert.match(c.directory.message, /test\.patchwork/);
  assert.equal(c.bind.status, 'error');
  assert.match(c.bind.message, /signierte oder verschlüsselte Verbindung/);
  assert.ok(c.bind.detail, 'Originalmeldung des Servers als Detail');
  assert.equal(c.base.status, 'skipped');
});

await step('STARTTLS ohne CA-Zertifikat: Zertifikat nicht vertrauenswürdig', async () => {
  const c = await diagnose({ caCertificate: '' });
  assert.equal(c.tls.status, 'error');
  assert.match(c.tls.message, /CA-Zertifikat/);
  assert.equal(c.bind.status, 'skipped');
});

await step('STARTTLS ohne Prüfung: funktioniert, aber Warnung', async () => {
  const c = await diagnose({ caCertificate: '', rejectUnauthorized: false });
  assert.equal(c.tls.status, 'warning');
  assert.match(c.tls.message, /NICHT geprüft/);
  assert.equal(c.bind.status, 'ok');
});

await step('STARTTLS mit CA-Zertifikat: alles grün, Testbenutzer IT', async () => {
  const c = await diagnose({}, 'lena', 'Lena-Passw0rd!');
  for (const key of ['server', 'tls', 'directory', 'bind', 'base', 'filter', 'adminGroup', 'itGroup', 'user', 'login']) {
    assert.equal(c[key]?.status, 'ok', `${key}: ${c[key]?.message}`);
  }
  assert.match(c.tls.message, /STARTTLS aktiv, Zertifikat geprüft/);
  assert.match(c.user.message, /Rolle IT/);
});

await step('Rolle Standard: Grund wird genannt, Gruppen zur Übernahme angeboten', async () => {
  const lena = await diagnose({}, 'lena');
  assert.ok(lena.user.groups.some((g) => /^CN=patchwork-it,/i.test(g)), 'Gruppen von lena');
  const sam = await diagnose({}, 'sam');
  assert.equal(sam.user.status, 'warning');
  assert.match(sam.user.message, /weder Mitglied der Admin- noch der IT-Gruppe/);
  // sam ist nur in der Gruppe für das Portal
  assert.deepEqual(sam.user.groups, [`CN=patchwork-portal,CN=Users,${BASE_DN}`]);
  const noGroups = await diagnose({ adminGroupDn: '', itGroupDn: '' }, 'lena');
  assert.equal(noGroups.user.status, 'warning');
  assert.match(noGroups.user.message, /weder eine Admin- noch eine IT-Gruppe eingetragen/);
});

await step('Verschachtelte Gruppe: nina erhält IT über it-team', async () => {
  const c = await diagnose({}, 'nina');
  assert.match(c.user.message, /Rolle IT/);
  const flat = await diagnose({ nestedGroups: false }, 'nina');
  assert.match(flat.user.message, /Rolle Standard/);
});

await step('LDAPS mit CA-Zertifikat', async () => {
  const c = await diagnose({ url: 'ldaps://localhost:11636', startTls: false });
  assert.equal(c.tls.status, 'ok');
  assert.match(c.tls.message, /LDAPS/);
  assert.equal(c.bind.status, 'ok');
});

await step('LDAPS und STARTTLS gleichzeitig wird abgelehnt', async () => {
  const c = await diagnose({ url: 'ldaps://localhost:11636', startTls: true });
  assert.equal(c.server.status, 'error');
  assert.match(c.server.message, /STARTTLS ist nur mit ldap/);
});

await step('Dienstkonto als DN und als DOMÄNE\\Benutzer', async () => {
  assert.equal((await diagnose({ bindDn: `CN=svc-patchwork,CN=Users,${BASE_DN}` })).bind.status, 'ok');
  const netbios = await diagnose({ bindDn: 'TESTPW\\svc-patchwork' });
  assert.equal(netbios.bind.status, 'ok', netbios.bind.message);
});

await step('Falsches Passwort: AD-Code 52e mit Hinweis auf Schreibweisen', async () => {
  const c = await diagnose({ bindPassword: 'falsch' });
  assert.equal(c.bind.status, 'error');
  assert.match(c.bind.message, /Passwort ist falsch/);
  assert.match(c.bind.message, /benutzer@domäne/);
});

await step('Bind-DN geändert ohne neues Passwort: klare Meldung', async () => {
  await call(admin, 'PUT', '/settings/ldap', settings);
  const { bindPassword: _omit, ...withoutPassword } = settings;
  const same = await call(admin, 'POST', '/settings/ldap/test', withoutPassword);
  assert.equal(same.data.checks.find((x) => x.key === 'bind').status, 'ok', 'gleiches Konto: gespeichertes Passwort gilt');
  const other = await call(admin, 'POST', '/settings/ldap/test', { ...withoutPassword, bindDn: `CN=svc-patchwork,CN=Users,${BASE_DN}` });
  const bind = other.data.checks.find((x) => x.key === 'bind');
  assert.equal(bind.status, 'error');
  assert.match(bind.message, /Kein Passwort/);
});

await step('OpenLDAP-Filter im AD: Hinweis auf Vorlage', async () => {
  const c = await diagnose({ userFilter: '(&(objectClass=inetOrgPerson)(|(uid={{username}})(mail={{username}})))' });
  assert.equal(c.filter.status, 'warning');
  assert.match(c.filter.message, /Vorlage «Active Directory»/);
});

await step('Falscher Basis-DN: Vorschlag aus dem Verzeichnis', async () => {
  const c = await diagnose({ baseDn: 'DC=falsch,DC=local' });
  assert.equal(c.base.status, 'error');
  assert.match(c.base.message, /Vorschlag: DC=test,DC=patchwork/i);
});

await step('Deaktiviertes Konto im Test', async () => {
  const c = await diagnose({}, 'dora', 'Dora-Passw0rd!');
  assert.equal(c.login.status, 'error');
  assert.match(c.login.message, /deaktiviert/);
});

// Nur Treffer aus der Test-Domäne: Die Test-Instanz kann weitere Benutzer enthalten (z.B. aus dem OpenLDAP-Test)
const searchPeople = async (q) => {
  const { people, directoryError } = (await call(admin, 'GET', `/people/search?q=${encodeURIComponent(q)}`)).data;
  return { people: people.filter((p) => p.email.endsWith('@test.patchwork')), directoryError };
};

await step('Personensuche im AD: Name und Benutzername, ohne deaktivierte Konten und Konten ohne E-Mail', async () => {
  await call(admin, 'PUT', '/settings/ldap', settings);
  const sam = await searchPeople('sam');
  assert.equal(sam.directoryError, null);
  assert.deepEqual(
    sam.people.map((p) => [p.email, p.name, p.username, p.source]),
    [['sam@test.patchwork', 'Sam Standard', 'sam', 'directory']],
  );
  assert.deepEqual((await searchPeople('Standard Sam')).people.map((p) => p.username), ['sam']);
  assert.deepEqual((await searchPeople('dora')).people, [], 'deaktiviert');
  assert.deepEqual((await searchPeople('Ohnemail')).people, [], 'ohne E-Mail');
  assert.deepEqual(
    (await searchPeople('test.patchwork')).people.map((p) => p.username).sort(),
    ['lena', 'nina', 'otto', 'sam'],
  );
});

await step('Anmeldungen über AD (gespeicherte Einstellungen)', async () => {
  await call(admin, 'PUT', '/settings/ldap', settings);
  assert.equal((await login('lena', 'Lena-Passw0rd!')).data.role, 'it');
  assert.equal((await login('otto@test.patchwork', 'Otto-Passw0rd!')).data.role, 'admin');
  assert.equal((await login('nina', 'Nina-Passw0rd!')).data.role, 'it');
  await login('lena', 'falsch', [401]);
  assert.equal((await login('sam', 'Sam-Passw0rd!')).data.role, 'standard', 'Standard-Benutzer: Portal');
  await login('nomail', 'Nomail-Passw0rd!', [401]);
  const disabled = await login('dora', 'Dora-Passw0rd!', [403]);
  assert.match(JSON.stringify(disabled.data), /deaktiviert/);
});

await step('Portal nur für ausgewählte: Mitglieder der Portal-Gruppe ja, andere nicht, IT immer', async () => {
  const portal = (groupDn) => call(admin, 'PUT', '/settings/portal', { access: 'selected', emails: [], groupDn });
  await portal(`CN=patchwork-portal,CN=Users,${BASE_DN}`);
  assert.equal((await login('sam', 'Sam-Passw0rd!')).data.role, 'standard', 'Mitglied der Portal-Gruppe');
  await portal(settings.itGroupDn);
  const refused = await login('sam', 'Sam-Passw0rd!', [403]);
  assert.match(JSON.stringify(refused.data), /nicht freigeschaltet/);
  assert.equal((await login('lena', 'Lena-Passw0rd!')).data.role, 'it', 'IT ist nicht betroffen');
  await call(admin, 'PUT', '/settings/portal', { access: 'all', emails: [], groupDn: '' });
});

await step('Regel mit AD-Gruppe: Meldungen von IT-Mitgliedern (auch verschachtelt) erhalten Priorität hoch', async () => {
  const group = (operator) => ({
    kind: 'group',
    op: 'and',
    children: [{ kind: 'condition', field: 'adGroup', operator, value: settings.itGroupDn }],
  });
  const rule = (await call(admin, 'POST', '/admin/rules', { name: 'IT-Gruppe', triggers: ['portal_new'], conditions: group('member'), actions: { priority: 'high' } })).data;
  const report = async (username, password, title) => {
    const cookie = (await login(username, password)).cookie;
    return (await call(cookie, 'POST', '/portal/items', { type: 'incident', title, description: 'Test' })).data.number;
  };
  const fromLena = await report('lena', 'Lena-Passw0rd!', 'Von Lena');
  const fromNina = await report('nina', 'Nina-Passw0rd!', 'Von Nina');
  const fromSam = await report('sam', 'Sam-Passw0rd!', 'Von Sam');
  const priority = async (number) => (await call(admin, 'GET', `/items/${number}`)).data.priority;
  assert.equal(await priority(fromLena), 'high');
  assert.equal(await priority(fromNina), 'high', 'verschachtelt über it-team');
  assert.equal(await priority(fromSam), 'normal');
  // Nur die Meldungen dieses Tests: Absender ohne AD-Konto (z.B. aus dem OpenLDAP-Test) sind ebenfalls «nicht in der Gruppe»
  const preview = (await call(admin, 'POST', '/admin/rules/preview', { triggers: ['portal_new'], conditions: group('notMember') })).data;
  assert.deepEqual(
    preview.hits.map((h) => h.number).filter((n) => [fromLena, fromNina, fromSam].includes(n)),
    [fromSam],
  );
  await call(admin, 'DELETE', `/admin/rules/${rule.id}`);
});

await step('Dienstkonto defekt: verständliche Meldung beim Login, Suche zeigt Patchwork-Treffer', async () => {
  await call(admin, 'PUT', '/settings/ldap', { ...settings, bindPassword: 'falsch' });
  const res = await login('lena', 'Lena-Passw0rd!', [503]);
  assert.match(JSON.stringify(res.data), /zurzeit nicht möglich/);
  const search = await searchPeople('lena');
  assert.match(search.directoryError, /nicht möglich/);
  assert.deepEqual(
    search.people.map((p) => [p.email, p.source]),
    [['lena@test.patchwork', 'patchwork']],
  );
});

await step('Einstellungen zurücksetzen', async () => {
  await call(admin, 'PUT', '/settings/ldap', {
    ...settings,
    enabled: false,
    url: '',
    startTls: false,
    caCertificate: '',
    bindDn: '',
    bindPassword: '',
    baseDn: '',
    adminGroupDn: '',
    itGroupDn: '',
  });
});

console.log('\nAlle AD-Prüfungen bestanden.');
