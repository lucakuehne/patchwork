// Smoke-Test, Bereich «Kennung aus Präfix und Nummer (PW-…, HS-…)» (läuft über test/smoke.mjs)
import { ANNA, api, assert, detail, MAILBOX, poll, reply, RUN, sendMail, sleep, state, status, step, waitForMail } from './lib.mjs';

const { itemNo, anna, mailboxId } = state;

await step('Kennung: Routen mit Präfix, ohne Präfix gilt PW, ungültige abgelehnt', async () => {
  const byRef = await api('GET', `/items/PW-${itemNo}`);
  assert.equal(byRef.prefix, 'PW');
  assert.equal(byRef.number, itemNo);
  assert.equal((await api('GET', `/items/${itemNo}`)).id, byRef.id, 'ohne Präfix gilt PW');
  assert.equal((await api('GET', `/items/pw-${itemNo}`)).id, byRef.id, 'Gross-/Kleinschreibung egal');
  await api('GET', `/items/XY-${itemNo}`, undefined, { expect: [400] });
  await api('GET', '/items/HS-999999', undefined, { expect: [404] });
  assert.ok((await api('GET', '/items?view=incidents')).items.every((i) => i.prefix === 'PW'), 'Listen liefern den Präfix');
});

await step('Vorgang aus HelpSpot (HS) neben PW mit derselben Nummer: Detail, Suche, Antworten, Verknüpfung', async () => {
  if (!process.env.SMOKE_DATABASE_URL) {
    process.stdout.write('(übersprungen, SMOKE_DATABASE_URL fehlt) ');
    return;
  }
  // Bis zum Import aus HelpSpot (Schritt 2) entsteht ein HS-Vorgang nur direkt in der Datenbank
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.SMOKE_DATABASE_URL });
  await db.connect();
  const ada = (await api('GET', '/users/staff')).find((u) => u.email === 'ada@test.local');
  const title = `Alt aus HelpSpot ${RUN}`;
  try {
    await db.query(
      `insert into items (prefix, number, type, status_id, title, creator_id, reporter_id, source, mailbox_id)
       values ('HS', $1, 'incident', $2, $3, $4, $5, 'mail', $6)`,
      [itemNo, status('incident', 'new').id, title, ada.id, anna.id, mailboxId],
    );
  } finally {
    await db.end();
  }
  const hs = await api('GET', `/items/HS-${itemNo}`);
  assert.equal(hs.prefix, 'HS');
  assert.equal(hs.title, title);
  assert.notEqual(hs.id, (await detail(itemNo)).id, 'PW und HS mit derselben Nummer sind verschiedene Vorgänge');

  // Suche: mit Präfix genau dieser, die Zahl allein findet beide
  const search = async (q) => (await api('GET', `/items?view=search&q=${encodeURIComponent(q)}`)).items.map((i) => `${i.prefix}-${i.number}`);
  assert.deepEqual(await search(`HS-${itemNo}`), [`HS-${itemNo}`]);
  assert.ok(!(await search(`PW-${itemNo}`)).includes(`HS-${itemNo}`));
  const both = await search(String(itemNo));
  assert.ok(both.includes(`HS-${itemNo}`) && both.includes(`PW-${itemNo}`), both.join(', '));

  // Antworten per Mail: «Ticket:{n}» aus Mails von HelpSpot und [HS-n] landen im HS-Vorgang
  const fromHelpSpot = `Antwort auf eine Mail von HelpSpot ${RUN}`;
  const fromPatchwork = `Antwort auf eine Mail von Patchwork ${RUN}`;
  await sendMail({ from: ANNA, to: MAILBOX, subject: `AW: ${title} - Ticket:{${itemNo}}`, text: fromHelpSpot });
  await sendMail({ from: ANNA, to: MAILBOX, subject: `AW: [HS-${itemNo}] ${title}`, text: fromPatchwork });
  let bodies = [];
  for (let i = 0; i < 20 && bodies.length < 2; i++) {
    await poll();
    bodies = (await api('GET', `/items/HS-${itemNo}`)).entries.filter((e) => e.kind === 'reply').map((e) => e.body);
    if (bodies.length < 2) await sleep(1000);
  }
  assert.ok(bodies.some((b) => b.includes(fromHelpSpot)), 'Antwort mit «Ticket:{n}»');
  assert.ok(bodies.some((b) => b.includes(fromPatchwork)), 'Antwort mit [HS-n]');
  assert.ok(!(await detail(itemNo)).entries.some((e) => e.body.includes(fromHelpSpot)), 'nicht im PW-Vorgang mit derselben Nummer');

  // Öffentliche Antwort: Betreff mit [HS-n]
  const text = `Antwort zum HS-Vorgang ${RUN}`;
  await reply(`/items/HS-${itemNo}/entries`, text, 'reply');
  const mail = await waitForMail(ANNA, (m) => m.text.includes(text), 'Antwort zum HS-Vorgang');
  assert.ok(mail.subject.startsWith(`[HS-${itemNo}] `), mail.subject);

  // Verknüpfung PW ↔ HS: im Verlauf beider mit Präfix
  await api('POST', `/items/PW-${itemNo}/links`, { role: 'relates', other: `HS-${itemNo}` });
  const link = (await detail(itemNo)).links.find((l) => l.other.prefix === 'HS');
  assert.equal(link?.other.number, itemNo);
  const logged = (await api('GET', `/items/HS-${itemNo}`)).entries.find((e) => e.meta?.field === 'linkAdded');
  assert.deepEqual([logged.meta.otherPrefix, logged.meta.otherNumber], ['PW', itemNo]);
  await api('POST', `/items/HS-${itemNo}/links`, { role: 'relates', other: `PW-${itemNo}` }, { expect: [409] });
  await api('POST', `/items/HS-${itemNo}/links`, { role: 'relates', other: `HS-${itemNo}` }, { expect: [400] });
  await api('DELETE', `/items/PW-${itemNo}/links/${link.id}`);
});
