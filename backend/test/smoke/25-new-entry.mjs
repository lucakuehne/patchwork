// Smoke-Test, Bereich «Neuer Eintrag» (läuft über test/smoke.mjs, Entscheid vom 10.11.2026): Mail an den Zuständigen,
// wenn jemand anderes eine interne Notiz oder öffentliche Antwort schreibt; nicht bei eigenen Einträgen, nicht bei einer
// Erwähnung des Zuständigen (dann «Erwähnt») und nicht, wenn er im selben Schritt zuständig wird (dann «Zugewiesen»)
import { api, assert, createItem, inbox, IVAN, loginAs, RUN, sleep, state, status, step, waitForMail } from './lib.mjs';

const { ivan, anna } = state;
const ADA = 'ada@test.local';
const send = (n, kind, body, extra = {}) => {
  const form = new FormData();
  form.append('kind', kind);
  form.append('body', body);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api('POST', `/items/${n}/entries`, form);
};
const newEntries = async (n, title) => (await inbox(IVAN)).filter((m) => m.subject === `[PW-${n}] Neuer Eintrag: ${title}`);

await step('Neuer Eintrag: Notiz und Antwort anderer an den Zuständigen, nicht bei Erwähnung und eigenen Einträgen', async () => {
  await loginAs(ADA, 'geheim-geheim');
  const title = `Eintrag ${RUN}`;
  const n = await createItem({ type: 'incident', title, reporterId: anna.id, assigneeId: ivan.id });
  await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Zugewiesen: ${title}`, 'Zugewiesen');

  // Interne Notiz von Ada: Mail an Ivan mit Verfasserin, Art und Text als Zitat
  await send(n, 'note', `Bitte bis Freitag ${RUN}`);
  const note = await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Neuer Eintrag: ${title}` && m.text.includes(`Bitte bis Freitag ${RUN}`), 'Notiz');
  assert.ok(note.text.startsWith(`**Ada Admin** hat in PW-${n} geschrieben (interne Notiz):\n\n> Bitte bis Freitag ${RUN}`), note.text);

  // Öffentliche Antwort von Ada: ebenfalls
  await send(n, 'reply', `Wir schauen es an ${RUN}`);
  const reply = await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Neuer Eintrag: ${title}` && m.text.includes(`Wir schauen es an ${RUN}`), 'Antwort');
  assert.ok(reply.text.includes('geschrieben (öffentliche Antwort):'), reply.text);

  // Erwähnung des Zuständigen: nur «Erwähnt»
  await send(n, 'note', `[@Ivan IT](mention:${ivan.id}) schau mal ${RUN}`);
  await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Erwähnt: ${title}`, 'Erwähnt');

  // Eigener Eintrag des Zuständigen: keine Mail an ihn selbst
  await loginAs(IVAN, 'geheim-geheim');
  await send(n, 'note', `Erledige ich ${RUN}`);
  await loginAs(ADA, 'geheim-geheim');
  await sleep(3000);
  const mails = await newEntries(n, title);
  assert.equal(mails.length, 2, mails.map((m) => m.text).join('\n---\n'));
});

await step('Neuer Eintrag: wer im selben Schritt zuständig wird, erhält nur «Zugewiesen»', async () => {
  const title = `Eintrag zuweisen ${RUN}`;
  const n = await createItem({ type: 'incident', title, reporterId: anna.id });
  // Zuständig beim Senden gibt es nur bei einem Status mit «Zuständig Pflicht» (im Smoke-Test sonst aus)
  const inProgress = status('incident', 'in_progress');
  await api('PATCH', `/statuses/${inProgress.id}`, { assigneeRequired: true });
  try {
    await send(n, 'note', `Übernimmst du? ${RUN}`, { statusId: inProgress.id, assigneeId: ivan.id });
  } finally {
    await api('PATCH', `/statuses/${inProgress.id}`, { assigneeRequired: false });
  }
  await waitForMail(IVAN, (m) => m.subject === `[PW-${n}] Zugewiesen: ${title}`, 'Zugewiesen');
  await sleep(2500);
  assert.equal((await newEntries(n, title)).length, 0, 'kein «Neuer Eintrag» zusätzlich zu «Zugewiesen»');
  // Ohne Zuständigen keine Mail (hier: Ivan wieder entfernt)
  await api('PATCH', `/items/${n}`, { assigneeId: null });
  await send(n, 'note', `Niemand zuständig ${RUN}`);
  await sleep(2500);
  assert.equal((await newEntries(n, title)).length, 0, 'ohne Zuständigen keine Mail');
});
