// Smoke-Test, Bereich «Reihenfolge beim Versand» (läuft über test/smoke.mjs, Entscheid vom 13.11.2026): Mails eines
// Postfachs gehen in der Reihenfolge hinaus, in der sie entstanden; dauerhafte Fehler halten nicht auf
import net from 'node:net';
import { ANNA, api, assert, createItem, detail, inbox, reply, RUN, sleep, state, step, waitForMail } from './lib.mjs';

const { anna, mailboxId } = state;
const ADDRESS = `reihenfolge-${RUN}@test.local`;
const box = (smtpHost, smtpPort) => ({
  name: 'Reihenfolge',
  address: ADDRESS,
  active: true,
  isDefault: false,
  imapHost: 'localhost',
  imapPort: 13143,
  imapSecure: false,
  imapFolder: 'INBOX',
  smtpHost,
  smtpPort,
  smtpSecurity: 'none',
  authType: 'password',
  username: ADDRESS,
  password: 'x',
});
const mail = (id) => api('GET', `/admin/outgoing-mails/${id}`);

/** Öffentliche Antwort; gibt die Mail zurück, sobald sie nicht mehr «wird versendet» ist */
async function send(itemNo, text) {
  await reply(`/items/${itemNo}/entries`, text, 'reply');
  for (let i = 0; i < 30; i++) {
    const entry = (await detail(itemNo)).entries.find((e) => e.body === text);
    if (entry?.mailId) {
      const m = await mail(entry.mailId);
      if (m.status !== 'queued') return m;
    }
    await sleep(1000);
  }
  throw new Error(`Antwort «${text}» nicht verarbeitet`);
}

async function until(id, check, what) {
  let m;
  for (let i = 0; i < 30; i++) {
    m = await mail(id);
    if (check(m)) return m;
    await sleep(1000);
  }
  throw new Error(`${what}: ${m?.status}`);
}

/** SMTP-Server, der jeden Empfänger dauerhaft ablehnt (550) */
function rejectingSmtp() {
  const server = net.createServer((socket) => {
    socket.on('error', () => undefined);
    socket.write('220 test ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf('\r\n'); end >= 0; end = buffer.indexOf('\r\n')) {
        const command = buffer.slice(0, end).slice(0, 4).toUpperCase();
        buffer = buffer.slice(end + 2);
        if (command === 'RCPT') socket.write('550 5.1.1 Recipient unknown\r\n');
        else if (command === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let itemNo = 0;
let boxId = '';

await step('Reihenfolge: neuere Mails warten auf eine ältere mit vorübergehendem Fehler, danach in der Reihenfolge', async () => {
  // Port 1: Verbindung abgelehnt (vorübergehend)
  boxId = (await api('POST', '/admin/mailboxes', box('localhost', 1))).id;
  itemNo = await createItem({ type: 'incident', title: `Reihenfolge ${RUN}`, reporterId: anna.id });
  await sleep(1500); // Eingangsbestätigung noch über das Standard-Postfach
  await api('PATCH', `/items/${itemNo}`, { mailboxId: boxId });

  const [textA, textB, textC] = ['A', 'B', 'C'].map((x) => `Reihenfolge ${x} ${RUN}`);
  const a = await send(itemNo, textA);
  assert.equal(a.status, 'failed');
  assert.ok(a.nextAttemptAt, 'vorübergehend: nächster Versuch geplant');
  assert.equal(a.attemptLog[0].permanent, undefined);

  const b = await send(itemNo, textB);
  assert.equal(b.status, 'waiting', 'neuere Mail wartet');
  assert.deepEqual([b.attempts, b.attemptLog.length, b.nextAttemptAt], [0, 0, null], 'kein eigener Versuch');
  assert.equal(b.waitingFor.id, a.id, 'wartet auf die ältere');
  const c = await send(itemNo, textC);
  assert.equal(c.status, 'waiting');
  assert.equal(c.waitingFor.id, a.id, 'wartet auf die älteste offene');
  // Auch beim Vorgang («Mail ansehen», Vermerk im Verlauf)
  const view = await api('GET', `/items/${itemNo}/mails/${b.id}`);
  assert.deepEqual([view.status, view.waitingFor?.id], ['waiting', a.id]);
  assert.equal((await detail(itemNo)).entries.find((e) => e.body === textB).delivery.status, 'waiting');
  assert.ok((await api('GET', '/admin/outgoing-mails?status=waiting')).some((m) => m.id === b.id), 'Filter «wartet»');
  // «Erneut senden» und «Als erledigt markieren» nur bei Fehlern
  assert.deepEqual(await api('POST', '/admin/outgoing-mails/bulk/resend', { ids: [b.id] }), { done: 0, skipped: 1 });
  await api('POST', `/admin/outgoing-mails/${b.id}/dismiss`, undefined, { expect: [400] });

  // Server wieder erreichbar, die ältere geht hinaus: danach die wartenden in ihrer Reihenfolge
  await api('PUT', `/admin/mailboxes/${boxId}`, box('localhost', 13025));
  await api('POST', `/admin/outgoing-mails/${a.id}/resend`);
  const sent = [];
  for (const m of [a, b, c]) sent.push(await until(m.id, (x) => x.status === 'sent', `Mail ${m.subject} versendet`));
  const times = sent.map((m) => new Date(m.sentAt).getTime());
  assert.ok(times[0] <= times[1] && times[1] <= times[2], `Reihenfolge beim Versand: ${sent.map((m) => m.sentAt).join(', ')}`);
  await waitForMail(ANNA, (m) => m.text.includes(textC), 'letzte Mail der Reihe');
  // Je Mail der neueste Text (eine Antwort kann die früheren zitieren)
  const newest = (m) => Math.max(...[textA, textB, textC].map((t, i) => (m.text.includes(t) ? i : -1)));
  const received = (await inbox(ANNA)).map(newest).filter((i) => i >= 0);
  assert.deepEqual(received, [0, 1, 2], 'beim Melder in der Reihenfolge angekommen');
  assert.deepEqual(
    sent.map((m) => m.attemptLog.at(-1).result),
    ['sent', 'sent', 'sent'],
  );
  assert.equal(sent[1].attemptLog.length, 1, 'die wartende hatte nur den einen Versuch');
});

await step('Reihenfolge: «Als erledigt markieren» gibt die wartenden frei', async () => {
  await api('PUT', `/admin/mailboxes/${boxId}`, box('localhost', 1));
  const d = await send(itemNo, `Reihenfolge D ${RUN}`);
  assert.equal(d.status, 'failed');
  const e = await send(itemNo, `Reihenfolge E ${RUN}`);
  assert.equal(e.status, 'waiting');
  await api('POST', `/admin/outgoing-mails/${d.id}/dismiss`);
  // E geht sofort, der Server ist aber noch nicht erreichbar: jetzt wartet E selbst auf den nächsten Versuch
  const tried = await until(e.id, (x) => x.status === 'failed', 'wartende Mail nach dem Aufgeben versucht');
  assert.equal(tried.attemptLog.length, 1);
  assert.ok(tried.nextAttemptAt);
  await api('POST', `/admin/outgoing-mails/${e.id}/dismiss`);
});

await step('Reihenfolge: dauerhafter Fehler (Empfänger abgelehnt) ohne Wiederholung, hält die neueren nicht auf', async () => {
  const server = await rejectingSmtp();
  try {
    await api('PUT', `/admin/mailboxes/${boxId}`, box('127.0.0.1', server.address().port));
    const x = await send(itemNo, `Dauerhaft X ${RUN}`);
    assert.equal(x.status, 'failed');
    assert.match(x.error, /550/);
    assert.equal(x.attemptLog[0].permanent, true, 'dauerhaft');
    assert.equal(x.nextAttemptAt, null, 'keine Wiederholung');
    const y = await send(itemNo, `Dauerhaft Y ${RUN}`);
    assert.equal(y.status, 'failed', 'neuere Mail wartet nicht, sondern wird versucht');
    assert.equal(y.attemptLog.length, 1);
    assert.deepEqual(await api('POST', '/admin/outgoing-mails/bulk/dismiss', { ids: [x.id, y.id] }), { done: 2, skipped: 0 });
  } finally {
    server.close();
    await api('PATCH', `/items/${itemNo}`, { mailboxId });
    await api('DELETE', `/admin/mailboxes/${boxId}`);
  }
});
