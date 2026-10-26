// Prüfung im Browser: Benutzer aus dem AD vorab anlegen (Verwaltung → Benutzer). Braucht das Samba-AD des Test-Stacks
// mit dem Konto «iris» (IT), angelegt von ops/ldap-ad-test.ps1.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://net:8080';
const OUT = '/work/shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'de-CH', timezoneId: 'Europe/Zurich' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const problems = [];
page.on('pageerror', (e) => problems.push(`Fehler auf der Seite: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`Konsole: ${m.text()}`);
});
const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        headers: { 'x-patchwork': '1', ...(b ? { 'content-type': 'application/json' } : {}) },
        body: b ? JSON.stringify(b) : undefined,
      });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    [method, path, body],
  );
const shot = async (name, locator) => {
  await page.waitForTimeout(300);
  await (locator ?? page).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`Bild ${name}`);
};

const BASE_DN = 'DC=test,DC=patchwork';
const ldap = {
  enabled: true,
  url: 'ldap://localhost:11389',
  startTls: true,
  rejectUnauthorized: false,
  caCertificate: '',
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

await page.goto(`${BASE}/login`);
await page.fill('#login-user', 'ada@test.local');
await page.fill('#login-pass', 'geheim-geheim');
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.startsWith('/login'));

try {
  console.log('LDAP-Einstellungen:', (await api('PUT', '/settings/ldap', ldap)).status);
  await page.goto(`${BASE}/admin/benutzer`);
  await page.locator('table.table').waitFor();
  await page.getByRole('button', { name: '+ Benutzer' }).click();
  const dialog = page.locator('.dialog');
  await dialog.locator('.person-search input').waitFor();
  await shot('20-neuer-benutzer-ad', dialog);
  await dialog.locator('.person-search input').fill('iris');
  await dialog.locator('.person-search .option').first().waitFor();
  await shot('21-ad-treffer', dialog);
  await dialog.locator('.person-search .option').first().click();
  await dialog.locator('#u-role option[value="auto"]', { hasText: 'zurzeit: IT' }).waitFor({ state: 'attached' });
  await shot('22-ad-gewaehlt', dialog);
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  // Neues Konto mit Rolle IT: Frage nach der Willkommens-Mail (hier nicht senden)
  const welcome = page.locator('.dialog', { hasText: 'Willkommens-Mail mit Link und Anmeldung' });
  await welcome.waitFor();
  await welcome.getByRole('button', { name: 'Nicht senden' }).click();
  await dialog.waitFor({ state: 'detached' });
  const row = page.locator('tbody tr', { hasText: 'iris@test.patchwork' });
  await row.waitFor();
  console.log('Zeile:', (await row.innerText()).replace(/\s+/g, ' '));
  const staff = (await api('GET', '/users/staff')).data;
  if (!staff.some((u) => u.email === 'iris@test.patchwork')) problems.push('ida fehlt bei «Zuständig»');
  // Rolle von Hand
  await row.click();
  await dialog.locator('#u-role').waitFor();
  await page.waitForTimeout(800);
  await dialog.locator('#u-role').selectOption('standard');
  await shot('23-ad-bearbeiten', dialog);
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await dialog.waitFor({ state: 'detached' });
  // Als Standard nicht mehr unter «Admin & IT»
  await page.getByRole('button', { name: 'Alle' }).click();
  await page.locator('tbody tr', { hasText: 'iris@test.patchwork' }).filter({ hasText: 'von Hand' }).waitFor();
  await shot('24-benutzerliste');
  // Zuweisen im Vorgang: ida ist wählbar
  const ida = (await api('GET', '/admin/users')).data.find((u) => u.email === 'iris@test.patchwork');
  await api('PATCH', `/admin/users/${ida.id}`, { role: 'auto' });
  const back = (await api('GET', '/admin/users')).data.find((u) => u.email === 'iris@test.patchwork');
  console.log('Zurück auf «Aus AD-Gruppen»:', back.role, back.roleManual);
} catch (err) {
  problems.push(err.message.split('\n')[0]);
  await page.screenshot({ path: `${OUT}/fehler-ad.png` }).catch(() => undefined);
} finally {
  await api('PUT', '/settings/ldap', { ...ldap, enabled: false, url: '', startTls: false, bindDn: '', bindPassword: '', baseDn: '', adminGroupDn: '', itGroupDn: '' });
}

await browser.close();
console.log(problems.length ? `PROBLEME:\n${problems.join('\n')}` : 'Keine Probleme');
