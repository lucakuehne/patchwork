// Smoke-Test, Bereich «Import aus HelpSpot» gegen einen nachgebauten HelpSpot (läuft über test/smoke.mjs).
// Patchwork und der Runner teilen im Test-Stack das Netz: Patchwork erreicht den Server hier über 127.0.0.1.
import http from 'node:http';
import { ANNA, api, assert, channel, detail, inbox, IVAN, loginAs, MAILBOX, PNG, poll, reply, RUN, sendMail, sleep, status, step, waitForMail } from './lib.mjs';

const PORT = 18181;
const URL_HS = `http://127.0.0.1:${PORT}`;
const KEY = `hs-key-${RUN}`;
const FIRST_MAIL = `<hs-first-${RUN}@test.local>`;
const STATUS_IDS = { Active: 1, 'Problem Solved': 3, SPAM: 2 };
const OLD = 1000; // Zeitpunkt der letzten Änderung (Unix-Sekunden) für den ersten Lauf

const entry = (id, fields) => ({ xRequestHistory: id, fPinned: 0, external: 0, fMergedFromRequest: 0, tEmailHeaders: '', tLog: '', ...fields });
const tickets = {
  12401: {
    xRequest: 12401,
    fOpenedVia: 'Email',
    xPersonAssignedTo: 'Ivan IT',
    fOpen: 0,
    xStatus: 'Problem Solved',
    fUrgent: 0,
    dtGMTOpened: '15. Jan 2024',
    dtGMTClosed: '16. Jan 2024',
    fTrash: 0,
    sTitle: `Drucker aus HelpSpot ${RUN}`,
    sFirstName: 'Anna',
    sLastName: 'Muster',
    sEmail: ANNA,
    Custom1: 'Incident',
    request_history: {
      item: {
        5001: entry(5001, {
          xPerson: 'Anna Muster',
          person_type: 'customer',
          dtGMTChange: '15. Jan 2024, 09:30 Uhr',
          fPublic: 1,
          fNoteIsHTML: 1,
          fInitial: 1,
          tNote: '<p>Der Drucker druckt nicht.</p><img src="cid:bild1@hs">',
          tEmailHeaders: `a:1:{s:10:"message-id";s:${FIRST_MAIL.length}:"${FIRST_MAIL}";}`,
          files: { file: [{ sCID: 'bild1@hs', sFilename: 'Fehler.png', xDocumentId: 9101, sFileMimeType: 'image/png' }] },
        }),
        5002: entry(5002, { xPerson: 'Ivan IT', person_type: 'staff', dtGMTChange: '15. Jan 2024, 10:00 Uhr', fPublic: 1, fNoteIsHTML: 1, tNote: '<p>Bitte neu starten.</p>' }),
        5003: entry(5003, {
          xPerson: 'Ivan IT',
          person_type: 'staff',
          dtGMTChange: '15. Jan 2024, 10:01 Uhr',
          fPublic: 0,
          fNoteIsHTML: 0,
          tNote: 'Treiber geprüft',
          files: { file: [{ sCID: '', sFilename: 'Protokoll.txt', xDocumentId: 9102, sFileMimeType: 'text/plain' }] },
        }),
        5004: entry(5004, { xPerson: 'Ivan IT', person_type: 'staff', dtGMTChange: '16. Jan 2024, 08:00 Uhr', fPublic: 0, tLog: 'Request Changed:', tNote: 'Status: Active → Problem Solved' }),
        // Ohne Text und ohne Anhang (z.B. nur ein Protokoll von HelpSpot): wird nicht übernommen
        5041: entry(5041, { xPerson: 'Ivan IT', person_type: 'staff', dtGMTChange: '16. Jan 2024, 08:01 Uhr', fPublic: 0, tLog: 'a:1:{s:7:"ccstaff";s:0:"";}', tNote: '' }),
        5005: entry(5005, { xPerson: 'Anna Muster', person_type: 'customer', dtGMTChange: '16. Jan 2024, 08:15 Uhr', fPublic: 1, fNoteIsHTML: 0, tNote: 'Danke, geht wieder.' }),
      },
    },
  },
  12402: {
    xRequest: 12402,
    fOpenedVia: 'Phone',
    xPersonAssignedTo: 'Ehemalig Person',
    fOpen: 1,
    xStatus: 'Active',
    fUrgent: 1,
    fTrash: 0,
    sTitle: `Neuer Bildschirm ${RUN}`,
    sFirstName: 'Max',
    sLastName: 'Telefon',
    sEmail: '',
    Custom1: 'Changes',
    request_history: {
      item: {
        6001: entry(6001, { xPerson: 'Ehemalig Person', person_type: 'staff', dtGMTChange: '3. Mar 2025, 14:05 Uhr', fPublic: 0, fNoteIsHTML: 0, fInitial: 1, tNote: 'Anruf: braucht einen zweiten Bildschirm' }),
      },
    },
  },
  12403: { xRequest: 12403, fOpen: 0, xStatus: 'SPAM', fTrash: 0, sTitle: 'Gewinnspiel', sEmail: 'spam@test.local', Custom1: '', request_history: { item: {} } },
  12404: { xRequest: 12404, fOpen: 0, xStatus: 'Problem Solved', fTrash: 1, sTitle: 'Im Papierkorb', sEmail: ANNA, Custom1: 'Incident', request_history: { item: {} } },
};
// Weitere Tickets, deren erste Mail auch in Patchwork ankam (Kopien aus der Parallelphase)
const copyTicket = (number, title, messageId) => ({
  xRequest: number,
  fOpenedVia: 'Email',
  xPersonAssignedTo: 'Ivan IT',
  fOpen: 0,
  xStatus: 'Problem Solved',
  fUrgent: 0,
  fTrash: 0,
  sTitle: title,
  sFirstName: 'Anna',
  sLastName: 'Muster',
  sEmail: ANNA,
  Custom1: 'Incident',
  request_history: {
    item: {
      [number * 10]: entry(number * 10, {
        xPerson: 'Anna Muster',
        person_type: 'customer',
        dtGMTChange: '2. Feb 2024, 10:00 Uhr',
        fPublic: 1,
        fInitial: 1,
        tNote: title,
        tEmailHeaders: `a:1:{s:10:"message-id";s:${messageId.length}:"${messageId}";}`,
      }),
    },
  },
});
const TASK_MAIL = `<hs-task-${RUN}@test.local>`;
const NOTE_MAIL = `<hs-note-${RUN}@test.local>`;
tickets[12406] = copyTicket(12406, `Zugang aus HelpSpot ${RUN}`, TASK_MAIL);
tickets[12407] = copyTicket(12407, `Laufwerk aus HelpSpot ${RUN}`, NOTE_MAIL);
const documents = { 9101: PNG.toString('base64'), 9102: Buffer.from('Protokoll').toString('base64') };
// 12405 wurde in HelpSpot in 12401 zusammengeführt: die API liefert dann 12401
const changed = new Map([12401, 12402, 12403, 12404, 12405, 12406, 12407].map((n) => [n, OLD]));

function helpspot(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { reply: 'Invalid API key' });
  const p = Object.fromEntries(new URL(req.url, URL_HS).searchParams);
  switch (p.method) {
    case 'private.request.getStatusTypes':
      return send(200, { status: Object.entries(STATUS_IDS).map(([sStatus, xStatus]) => ({ xStatus, sStatus })) });
    case 'private.util.getAllStaff':
      return send(200, { person: { 1: { fullname: 'Ivan IT', sEmail: IVAN }, 2: { fullname: 'Ehemalig Person', sEmail: `ehemalig-${RUN}@test.local` } } });
    case 'private.request.search': {
      const rows = Number(p.start ?? 0) > 0 ? [] : Object.values(tickets).filter((t) => STATUS_IDS[t.xStatus] === Number(p.xStatus));
      return send(200, { request: rows.map(({ request_history, ...summary }) => summary) });
    }
    case 'private.request.getChanged': {
      const since = Number(p.dtGMTChange);
      return send(200, { xRequest: [...changed].filter(([, at]) => at >= since).flatMap(([n]) => [n, n]) });
    }
    case 'private.request.get': {
      const n = Number(p.xRequest);
      const ticket = tickets[n === 12405 ? 12401 : n];
      return ticket ? send(200, ticket) : send(400, { reply: 'Valid request ID required' });
    }
    case 'private.document.get':
      return documents[p.xDocumentId] ? send(200, { sBody: documents[p.xDocumentId], sFilename: 'Datei' }) : send(400, { reply: 'Not found' });
    default:
      return send(400, { reply: `Unbekannte Methode ${p.method}` });
  }
}

const server = http.createServer(helpspot);
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

/** Mail, die in der Parallelphase auch in Patchwork ankam: Nummer des Vorgangs im Eingang, nach der Eingangsbestätigung */
async function mailCopy(subject, messageId) {
  await sendMail({ from: ANNA, to: MAILBOX, subject, text: subject, messageId });
  let number;
  for (let i = 0; i < 20 && !number; i++) {
    await poll();
    number = (await api('GET', '/items?view=inbox')).items.find((x) => x.title === subject)?.number;
    if (!number) await sleep(1000);
  }
  assert.ok(number, `${subject} im Eingang`);
  // Eingangsbestätigung abwarten, sonst zählt sie unten als Mail des Imports
  await waitForMail(ANNA, (m) => m.subject.includes(subject), `Eingangsbestätigung ${subject}`);
  return number;
}

/** Import starten (nur geschlossene oder auch offene Tickets) und auf sein Ende warten */
async function importNow(includeOpen = false) {
  await api('POST', '/admin/helpspot/import', { includeOpen }, { expect: [202] });
  for (let i = 0; i < 120; i++) {
    const run = (await api('GET', '/admin/helpspot')).runs[0];
    if (run.status !== 'running') return run;
    await sleep(1000);
  }
  throw new Error('Import aus HelpSpot nicht fertig geworden');
}

try {
  await step('HelpSpot-Import: Verbindung, Übersicht und vorgeschlagene Zuordnungen', async () => {
    await api('PUT', '/admin/helpspot', { url: URL_HS, apiKey: 'falsch', types: {}, statuses: {}, channels: {} });
    const wrong = await api('POST', '/admin/helpspot/analysis', undefined, { expect: [400] });
    assert.match(wrong.message, /API-Schlüssel/);
    const saved = await api('PUT', '/admin/helpspot', { url: `${URL_HS}/`, apiKey: KEY, types: {}, statuses: {}, channels: {} });
    assert.equal(saved.url, URL_HS, 'ohne Schrägstrich am Ende');
    assert.equal(saved.hasApiKey, true);
    assert.ok(!JSON.stringify(saved).includes(KEY), 'Schlüssel nicht in der Antwort');
    const view = await api('POST', '/admin/helpspot/analysis');
    assert.equal(view.analysis.total, 4, 'ohne Spam und Papierkorb');
    assert.deepEqual(view.mappings.types, { Incident: 'incident', Changes: 'task' });
    assert.equal(view.mappings.channels.Phone, channel('Telefon').id);
    assert.ok(view.mappings.channels.Email, 'Mail → Meldeweg der Mails');
    assert.ok(view.mappings.statuses['incident|Problem Solved|closed']);
    assert.ok(view.mappings.statuses['task|Active|open']);
    // Ohne neuen Schlüssel bleibt der gespeicherte
    assert.equal((await api('PUT', '/admin/helpspot', { url: URL_HS, types: {}, statuses: {}, channels: {} })).hasApiKey, true);
    // Nur Admins
    await loginAs(IVAN, 'geheim-geheim');
    await api('GET', '/admin/helpspot', undefined, { expect: [403] });
    await loginAs('ada@test.local', 'geheim-geheim');
  });

  let copyNumber, taskCopy, noteCopy;
  await step('HelpSpot-Import: geschlossene, dann offene Tickets mit Verlauf und Anhängen, ohne Spam, Papierkorb und Zusammengeführte, ohne Mails', async () => {
    // Kopien aus der Parallelphase: dieselbe erste Mail kam auch in Patchwork an. Eine bleibt im Eingang, eine wird in
    // Patchwork zur Aufgabe, eine erhält eine Notiz der IT
    copyNumber = await mailCopy(`Kopie aus der Parallelphase ${RUN}`, FIRST_MAIL);
    taskCopy = await mailCopy(`Zugang Kopie ${RUN}`, TASK_MAIL);
    noteCopy = await mailCopy(`Laufwerk Kopie ${RUN}`, NOTE_MAIL);
    await api('POST', `/items/${taskCopy}/type`, { type: 'task', statusId: status('task', 'in_progress').id });
    await reply(`/items/${noteCopy}/entries`, `Geprüft ${RUN}`, 'note');
    const mailsBefore = (await inbox(ANNA)).length;

    // Probeimport: nur geschlossene Tickets, das offene 12402 kommt erst am Stichtag
    const run = await importNow();
    assert.equal(run.status, 'done', run.error ?? '');
    assert.equal(run.includeOpen, false);
    assert.deepEqual([run.total, run.created, run.updated, run.skipped, run.skippedOpen, run.failed], [7, 3, 0, 3, 1, 0], JSON.stringify(run));
    await api('GET', '/items/HS-12402', undefined, { expect: [404] });

    const hs = await api('GET', '/items/HS-12401');
    assert.equal(hs.prefix, 'HS');
    assert.equal(hs.type, 'incident');
    assert.equal(hs.status.closed, true);
    assert.equal(hs.reporter.email, ANNA);
    assert.equal(hs.assignee.email, IVAN);
    assert.equal(hs.createdAt, '2024-01-15T08:30:00.000Z', 'Zeit aus HelpSpot (Zürich)');
    assert.deepEqual(hs.helpspot, { status: 'Problem Solved', reporterName: 'Anna Muster' });
    assert.equal(hs.description, 'Der Drucker druckt nicht.');
    assert.match(hs.descriptionHtml, /\/api\/attachments\/[0-9a-f-]+\/inline/, 'eingebettetes Bild');
    const kinds = hs.entries.map((e) => [e.kind, e.author?.email ?? e.meta?.authorName ?? null]);
    assert.deepEqual(kinds, [
      ['reply', IVAN],
      ['note', IVAN],
      ['change', IVAN],
      ['reply', ANNA],
    ]);
    assert.ok(hs.entries.every((e) => e.meta?.source === 'helpspot'));
    assert.match(hs.entries[0].bodyHtml, /Bitte neu starten/);
    assert.equal(hs.entries[1].attachments[0].filename, 'Protokoll.txt');
    assert.equal(hs.entries[2].meta.field, 'helpspot');

    // Stichtag: mit offenen Tickets, auch wenn sie sich seit dem letzten Lauf nicht geändert haben
    const withOpen = await importNow(true);
    assert.deepEqual(
      [withOpen.status, withOpen.includeOpen, withOpen.total, withOpen.created, withOpen.skippedOpen, withOpen.failed],
      ['done', true, 1, 1, 0, 0],
      JSON.stringify(withOpen),
    );
    const task = await api('GET', '/items/HS-12402');
    assert.equal(task.type, 'task');
    assert.equal(task.status.closed, false);
    assert.equal(task.priority, 'high');
    assert.equal(task.assignee, null, 'ehemalige Mitarbeitende ohne Konto');
    assert.equal(task.channel.id, channel('Telefon').id);
    assert.equal(task.reporter.email, 'ohne-email@helpspot.invalid');
    assert.equal(task.helpspot.reporterName, 'Max Telefon');
    assert.equal(task.description, 'Anruf: braucht einen zweiten Bildschirm');

    for (const skipped of ['HS-12403', 'HS-12404', 'HS-12405']) await api('GET', `/items/${skipped}`, undefined, { expect: [404] });
    const found = (await api('GET', `/items?view=search&q=${encodeURIComponent('HS-12401')}`)).items;
    assert.deepEqual(found.map((x) => `${x.prefix}-${x.number}`), ['HS-12401']);
    await sleep(1500);
    const mails = await inbox(ANNA);
    const imported = new RegExp(`HS-1240\\d|(Drucker|Zugang|Laufwerk) aus HelpSpot ${RUN}|Neuer Bildschirm ${RUN}`);
    assert.ok(!mails.some((m) => imported.test(m.subject)), mails.map((m) => m.subject).join(' | '));
    assert.equal(mails.length, mailsBefore, 'keine Mails beim Import');
  });

  await step('HelpSpot-Import: Portal zeigt übernommene Vorgänge nicht', async () => {
    await loginAs(ANNA, 'anna-passwort-1');
    for (const state of ['open', 'closed']) {
      assert.ok((await api('GET', `/portal/items?state=${state}`)).every((x) => x.prefix !== 'HS'));
    }
    await api('GET', '/portal/items/HS-12401', undefined, { expect: [404] });
    await loginAs('ada@test.local', 'geheim-geheim');
  });

  await step('HelpSpot-Import: Wiederholung holt nur Geänderte und legt nichts doppelt an', async () => {
    tickets[12401].request_history.item[5006] = entry(5006, {
      xPerson: 'Ivan IT',
      person_type: 'staff',
      dtGMTChange: '17. Jan 2024, 07:00 Uhr',
      fPublic: 0,
      tNote: `Nachtrag ${RUN}`,
    });
    changed.set(12401, Math.floor(Date.now() / 1000));
    // Das offene 12402 ändert sich auch: ein Lauf nur mit geschlossenen lässt es auf dem Stand des letzten Imports
    tickets[12402].request_history.item[6002] = entry(6002, { xPerson: 'Ivan IT', person_type: 'staff', dtGMTChange: '4. Mar 2025, 09:00 Uhr', fPublic: 0, tNote: `Offen geändert ${RUN}` });
    changed.set(12402, Math.floor(Date.now() / 1000));
    const run = await importNow();
    assert.deepEqual([run.status, run.total, run.created, run.updated, run.skippedOpen, run.failed], ['done', 2, 0, 1, 1, 0], JSON.stringify(run));
    assert.ok(!(await api('GET', '/items/HS-12402')).entries.some((e) => e.body === `Offen geändert ${RUN}`), 'offenes Ticket unverändert');
    const hs = await api('GET', '/items/HS-12401');
    assert.equal(hs.entries.length, 5);
    assert.equal(hs.entries.filter((e) => e.body === `Nachtrag ${RUN}`).length, 1);
    assert.equal(hs.attachments.length, 1, 'Anhänge nicht doppelt');
  });

  await step('HelpSpot-Import: Kopien aus der Parallelphase je Paar bereinigen, ohne Mails; Antworten gehen zum bleibenden', async () => {
    const copies = await api('GET', '/admin/helpspot/copies');
    const pair = (n) => copies.find((c) => c.copy.number === n);
    // Vorschlag: Aufgaben und Kopien mit Notizen der IT bleiben in Patchwork, sonst bleibt der HS-Vorgang
    assert.deepEqual(
      [copyNumber, taskCopy, noteCopy].map((n) => [pair(n)?.original.number, pair(n)?.suggestion.keep, pair(n)?.suggestion.reason]),
      [
        [12401, 'original', null],
        [12406, 'copy', 'task'],
        [12407, 'copy', 'staffEntries'],
      ],
      JSON.stringify(copies),
    );
    const mailsBefore = (await inbox(ANNA)).length;
    // Drucker bleibt in HelpSpot, Zugang in Patchwork; Laufwerk wird nicht bereinigt
    const result = await api('POST', '/admin/helpspot/copies/resolve', {
      choices: [
        { copyId: pair(copyNumber).copy.id, keep: 'original' },
        { copyId: pair(taskCopy).copy.id, keep: 'copy' },
      ],
    });
    assert.deepEqual(result, { resolved: 2, keptCopies: 1 });
    const copy = await detail(copyNumber);
    assert.equal(copy.discarded, true, 'im Eingang verworfen');
    assert.ok(copy.links.some((l) => l.role === 'duplicateOf' && l.other.prefix === 'HS' && l.other.number === 12401));
    const kept = await detail(taskCopy);
    assert.equal(kept.status.closed, false, 'Aufgabe in Patchwork bleibt offen');
    assert.ok(kept.links.some((l) => l.role === 'hasDuplicate' && l.other.prefix === 'HS' && l.other.number === 12406));
    const hsDuplicate = await api('GET', '/items/HS-12406');
    assert.equal(hsDuplicate.status.closed, true);
    assert.ok(hsDuplicate.links.some((l) => l.role === 'duplicateOf' && l.other.prefix === 'PW' && l.other.number === taskCopy));
    assert.deepEqual((await api('GET', '/admin/helpspot/copies')).map((c) => c.copy.number), [noteCopy], 'nur das übersprungene Paar bleibt');
    await sleep(1500);
    assert.equal((await inbox(ANNA)).length, mailsBefore, 'keine Mails');
    // Antwort auf das alte HelpSpot-Ticket landet beim Vorgang, der bleibt
    await sendMail({ from: ANNA, to: MAILBOX, subject: 'AW: Zugang - Ticket:{12406}', text: `Antwort auf HelpSpot ${RUN}` });
    await sleep(500);
    await poll();
    assert.ok((await detail(taskCopy)).entries.some((e) => e.body.includes(`Antwort auf HelpSpot ${RUN}`)), 'Antwort beim bleibenden Vorgang');
  });
} finally {
  server.close();
}
