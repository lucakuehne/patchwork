// Smoke-Test, Bereich «Bereiche je Rolle, als Benutzer arbeiten, HTTPS» (läuft über test/smoke.mjs)
import {
  ANNA,
  api,
  ARCHIVE,
  archiveMailbox,
  assert,
  BASE,
  cookie,
  BERTA,
  BOB,
  byTitle,
  CARLA,
  channel,
  cond,
  createItem,
  detail,
  entryStartingWith,
  EXTERN,
  finish,
  STRANGER,
  PRIZE,
  group,
  https,
  HTTPS_PORT,
  ImapFlow,
  inbox,
  inboxNumber,
  IVAN,
  SUPPLIER,
  loginAs,
  MAILBOX,
  NEWS,
  PNG,
  poll,
  reply,
  RUN,
  sendMail,
  setSessionCookie,
  simpleParser,
  simulation,
  sleep,
  smtp,
  state,
  status,
  step,
  MUTED,
  uploadImage,
  waitForMail,
  webcrypto,
  x509,
} from './lib.mjs';

let { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule } = state;

await step('Bereiche je Rolle: IT nur mit Aufgaben, gesperrte Vorgänge, Verweise nur mit Nummer, keine Mails ohne Zugriff', async () => {
  assert.deepEqual(await api('GET', '/areas'), { areas: ['inbox', 'incident', 'task'] });
  assert.deepEqual(await api('GET', '/settings/areas'), { it: ['inbox', 'incident', 'task'] }, 'Standard: alle');
  assert.match((await api('PUT', '/settings/areas', { it: [] }, { expect: [400] })).message, /mindestens einen Bereich/);
  const task = await createItem({ type: 'task', title: `Bereiche ${RUN}` });
  await api('POST', `/items/${task}/links`, { role: 'relates', other: itemNo });
  const incidentFile = (await detail(itemNo)).attachments[0].id;
  await api('PUT', '/settings/areas', { it: ['task', 'task'] });
  assert.deepEqual(await api('GET', '/settings/areas'), { it: ['task'] });

  await loginAs(IVAN, 'geheim-geheim');
  assert.deepEqual(await api('GET', '/areas'), { areas: ['task'] });
  await api('GET', '/settings/areas', undefined, { expect: [403] });
  const counts = await api('GET', '/items/counts');
  assert.deepEqual([counts.inbox, counts.incidents], [0, 0]);
  assert.ok(counts.tasks > 0);
  assert.equal((await api('GET', '/items?view=inbox')).items.length, 0);
  assert.equal((await api('GET', '/items?view=incidents')).items.length, 0);
  assert.ok(!(await api('GET', '/items?view=search&q=VPN')).items.some((i) => i.number === itemNo), 'nicht in der Suche');
  // Gesperrt, auch per Link, über Anhänge und beim Erfassen bzw. Umklassieren
  assert.match((await api('GET', `/items/${itemNo}`, undefined, { expect: [403] })).message, /Kein Zugriff auf den Bereich «Störungen»/);
  await api('PATCH', `/items/${itemNo}`, { priority: 'low' }, { expect: [403] });
  await api('GET', `/items/${itemNo}/original/view?messageId=x`, undefined, { expect: [403] });
  await api('GET', `/attachments/${incidentFile}/preview`, undefined, { expect: [403] });
  await api('POST', `/items/${task}/type`, { type: 'incident' }, { expect: [403] });
  const f = new FormData();
  for (const [k, v] of Object.entries({ type: 'incident', title: 'Nicht erlaubt', channelId: channel('Telefon').id })) f.append(k, v);
  await api('POST', '/items', f, { expect: [403] });
  // Verknüpfung und Verlauf: nur die Nummer, ohne Titel
  const visible = await api('GET', `/items/${task}`);
  assert.deepEqual([visible.links[0].other.number, visible.links[0].other.title, visible.links[0].other.hidden], [itemNo, '', true]);
  const linked = visible.entries.find((e) => e.meta?.field === 'linkAdded');
  assert.deepEqual([linked.meta.refHidden, linked.meta.otherTitle], [true, undefined]);
  await api('POST', `/items/${task}/links`, { role: 'fixes', other: itemNo }, { expect: [403] });
  await loginAs('ada@test.local', 'geheim-geheim');
  // Admins sehen alles mit Titel
  assert.equal((await detail(task)).links[0].other.title, 'VPN verbindet nicht');

  // Zuständig bleibt wählbar, ohne Zugriff aber keine Mail
  const incident = await createItem({ type: 'incident', title: `Ohne Zugriff ${RUN}` });
  await api('PATCH', `/items/${incident}`, { assigneeId: ivan.id });
  await api('PATCH', `/items/${task}`, { assigneeId: ivan.id });
  await waitForMail(IVAN, (m) => m.subject === `[PW-${task}] Zugewiesen: Bereiche ${RUN}`, 'Zuweisung der Aufgabe');
  assert.ok(!(await inbox(IVAN)).some((m) => m.subject.startsWith(`[PW-${incident}]`)), 'keine Mail zur Störung');
  assert.equal((await detail(incident)).assignee.email, IVAN);

  await api('PUT', '/settings/areas', { it: ['inbox', 'incident', 'task'] });
});

await step('Als Benutzer arbeiten: nur Admins, nur IT/Admin, Rechte und Autor wie der Benutzer, zurück zum eigenen Konto', async () => {
  await loginAs('ada@test.local', 'geheim-geheim');
  const users = await api('GET', '/admin/users');
  const byEmail = (email) => users.find((u) => u.email === email);
  const ivan = byEmail(IVAN);
  // Nicht als Standard-Benutzer und nicht als man selbst
  await api('POST', `/admin/users/${byEmail(ANNA).id}/impersonate`, undefined, { expect: [400] });
  await api('POST', `/admin/users/${byEmail('ada@test.local').id}/impersonate`, undefined, { expect: [400] });
  await api('POST', '/auth/impersonation/end', undefined, { expect: [400] });
  const number = await createItem({ type: 'task', title: `Als Ivan ${RUN}` });

  assert.equal((await api('POST', `/admin/users/${ivan.id}/impersonate`)).email, IVAN);
  const me = await api('GET', '/auth/me');
  assert.deepEqual([me.user.email, me.impersonator?.email], [IVAN, 'ada@test.local']);
  // Rechte von Ivan (IT): keine Verwaltung
  await api('GET', '/admin/users', undefined, { expect: [403] });
  const note = new FormData();
  note.append('kind', 'note');
  note.append('body', `Notiz von Ivan ${RUN}`);
  await api('POST', `/items/${number}/entries`, note);
  const entry = (await detail(number)).entries.find((e) => e.body === `Notiz von Ivan ${RUN}`);
  assert.equal(entry.author.email, IVAN, 'im Namen von Ivan, ohne Vermerk');

  // Zurück: wieder Ada mit Admin-Rechten; Ivans letzte Anmeldung bleibt unverändert
  assert.equal((await api('POST', '/auth/impersonation/end')).email, 'ada@test.local');
  const back = await api('GET', '/auth/me');
  assert.deepEqual([back.user.email, back.impersonator], ['ada@test.local', null]);
  const after = (await api('GET', '/admin/users')).find((u) => u.email === IVAN);
  assert.equal(after.lastLoginAt, ivan.lastLoginAt);

  // Ein zweiter Admin (eigene Sitzung) für die Sicherheitsfälle
  const ole = await api('POST', '/admin/users', { name: `Ole Admin ${RUN}`, email: `ole-${RUN}@test.local`, role: 'admin', password: 'ole-passwort-1' });
  const adaCookie = cookie;
  setSessionCookie('');
  await api('POST', '/auth/login', { username: `ole-${RUN}@test.local`, password: 'ole-passwort-1' });
  const oleCookie = cookie;

  // Hat Ivan inzwischen die Rolle Standard, führt der Weg zurück trotzdem
  setSessionCookie(adaCookie);
  await api('POST', `/admin/users/${ivan.id}/impersonate`);
  const asIvan = cookie;
  setSessionCookie(oleCookie);
  await api('PATCH', `/admin/users/${ivan.id}`, { role: 'standard' });
  setSessionCookie(asIvan);
  assert.equal((await api('POST', '/auth/impersonation/end')).email, 'ada@test.local');
  const adaAgain = cookie;
  setSessionCookie(oleCookie);
  await api('PATCH', `/admin/users/${ivan.id}`, { role: 'it' });

  // Passwort von Ada zurückgesetzt: auch ihre «Als Ivan»-Sitzung endet (kein Weg zurück zu einer Admin-Sitzung)
  setSessionCookie(adaAgain);
  await api('POST', `/admin/users/${ivan.id}/impersonate`);
  const asIvanAgain = cookie;
  setSessionCookie(oleCookie);
  await api('PATCH', `/admin/users/${byEmail('ada@test.local').id}`, { password: 'neues-passwort-1' });
  setSessionCookie(asIvanAgain);
  assert.equal((await api('GET', '/auth/me')).user, null);
  await api('POST', '/auth/impersonation/end', undefined, { expect: [400] });
  setSessionCookie(oleCookie);
  await api('PATCH', `/admin/users/${byEmail('ada@test.local').id}`, { password: 'geheim-geheim' });
  await api('PATCH', `/admin/users/${ole.id}`, { active: false });
  await loginAs('ada@test.local', 'geheim-geheim');
});

await step('HTTPS: Anforderung, signiertes Zertifikat hochladen, Abruf über HTTPS', async () => {
  const host = new URL(BASE).hostname;
  let tls = await api('GET', '/admin/tls');
  assert.equal(tls.active, false);
  assert.deepEqual(tls.suggestedNames, [host]);
  tls = await api('POST', '/admin/tls/request', { names: [host, 'Patchwork.Test.local'] });
  assert.deepEqual(tls.pending.names, [host, 'patchwork.test.local']);

  // Test-CA signiert die Anforderung wie eine AD CS mit der Vorlage «Webserver»
  x509.cryptoProvider.set(webcrypto);
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const day = 24 * 60 * 60 * 1000;
  const caKeys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Smoke-CA',
    notBefore: new Date(Date.now() - day),
    notAfter: new Date(Date.now() + 30 * day),
    keys: caKeys,
    signingAlgorithm: alg,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  const csr = new x509.Pkcs10CertificateRequest(tls.pending.csr);
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: csr.subject,
    issuer: ca.subject,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 20 * day),
    publicKey: csr.publicKey,
    signingKey: caKeys.privateKey,
    signingAlgorithm: alg,
    extensions: [...csr.extensions, new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth])],
  });
  const upload = (text, name) => {
    const form = new FormData();
    form.append('file', new Blob([text]), name);
    return form;
  };

  // Ein Zertifikat zu einem fremden Schlüssel nimmt Patchwork nicht
  const rejected = await api('POST', '/admin/tls/certificate', upload(ca.toString('pem'), 'ca.cer'), { expect: [400] });
  assert.match(rejected.message, /passt zu keinem Schlüssel/);

  tls = await api('POST', '/admin/tls/certificate', upload(`${cert.toString('pem')}\n${ca.toString('pem')}\n`, 'patchwork.cer'));
  assert.equal(tls.active, true);
  assert.equal(tls.pending, null);
  assert.deepEqual(tls.certificate.names, [host, 'patchwork.test.local']);
  assert.equal(tls.certificate.issuer, 'Smoke-CA');
  assert.equal(tls.redirects, false, 'ohne https:// in PUBLIC_URL keine Umleitung');

  // Abruf über HTTPS, nur mit Vertrauen in die Test-CA
  const viaHttps = await new Promise((resolve, reject) => {
    const req = https.request({ host, port: HTTPS_PORT, path: '/api/public/info', ca: ca.toString('pem') }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, info: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(viaHttps.status, 200);
  assert.ok(viaHttps.info.certificateExpiresAt, 'Ablauf für den Hinweis an Admins');
  // HTTP läuft daneben weiter
  assert.equal((await api('GET', '/public/info')).certificateExpiresAt, viaHttps.info.certificateExpiresAt);
});

Object.assign(state, { mailboxId, ivan, itemNo, statuses, channels, firstMessageId, t1, t2, t3, task, taskListId, mentionTask, dupOriginal, dupSame, dupOther, anna, portalItem, supplierRule });
