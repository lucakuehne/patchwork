// Smoke-Test, Bereich «Titel höchstens 90 Zeichen» (läuft über test/smoke.mjs, Entscheid vom 05.11.2026): beim Erfassen,
// Bearbeiten, im Portal und bei wiederkehrenden Aufgaben; Titel aus Mail-Betreffen dürfen länger sein
import { ANNA, api, assert, channel, createItem, detail, inboxNumber, loginAs, poll, RUN, sendMail, sleep, step } from './lib.mjs';

const ADA = 'ada@test.local';
/** Titel mit genau «length» Zeichen */
const titleOf = (length) => `Titel ${RUN} `.padEnd(length, 'x');
const TOO_LONG = 'Der Titel darf höchstens 90 Zeichen lang sein.';
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

await step('Titel: höchstens 90 Zeichen beim Erfassen und im Portal', async () => {
  await loginAs(ADA, 'geheim-geheim');
  const refused = await api('POST', '/items', form({ type: 'incident', title: titleOf(91), channelId: channel('Telefon').id }), { expect: [400] });
  assert.ok(refused.message.endsWith(TOO_LONG), refused.message);
  const n = await createItem({ type: 'incident', title: titleOf(90) });
  assert.equal((await detail(n)).title.length, 90);

  await loginAs(ANNA, 'anna-passwort-1');
  const portal = await api('POST', '/portal/items', form({ type: 'incident', title: titleOf(91) }), { expect: [400] });
  assert.ok(portal.message.endsWith(TOO_LONG), portal.message);
  await api('POST', '/portal/items', form({ type: 'incident', title: titleOf(90) }));
  await loginAs(ADA, 'geheim-geheim');
});

await step('Titel: aus dem Mail-Betreff länger, beim Bearbeiten wieder höchstens 90 Zeichen', async () => {
  const subject = `Langer Betreff ${RUN} `.padEnd(110, 'y');
  await sendMail({ from: `Anna Muster <${ANNA}>`, subject, text: 'Text' });
  await sleep(500);
  await poll();
  const n = await inboxNumber(subject);
  assert.equal((await detail(n)).title, subject, 'Titel aus der Mail vollständig');
  // Andere Felder ändern geht, auch derselbe lange Titel
  await api('PATCH', `/items/${n}`, { description: 'Anders beschrieben', title: subject });
  // Geändert: höchstens 90 Zeichen
  assert.equal((await api('PATCH', `/items/${n}`, { title: subject.slice(0, 95) }, { expect: [400] })).message, TOO_LONG);
  await api('PATCH', `/items/${n}`, { title: subject.slice(0, 90) });
  assert.equal((await detail(n)).title, subject.slice(0, 90));
  // Verwerfen: Die Browserprüfung nimmt die neueste Mail im Eingang und erwartet den Betreff als Titel
  await api('POST', `/items/${n}/discard`, { discarded: true });
});

await step('Titel: wiederkehrende Aufgaben mit dem längsten Wert der Platzhalter', async () => {
  const fields = {
    schedule: { kind: 'monthlyDay', interval: 1, day: 1 },
    startDate: '2027-01-01',
    endDate: null,
    weekend: 'keep',
    leadDays: 0,
  };
  // 81 Zeichen plus « {{Monat}}»: mit «September» 91 Zeichen
  const tooLong = `${titleOf(81)} {{Monat}}`;
  const refused = await api('POST', '/recurring-tasks/preview', { ...fields, title: tooLong }, { expect: [400] });
  assert.match(refused.message, /höchstens 90 Zeichen.*September/);
  const preview = await api('POST', '/recurring-tasks/preview', { ...fields, title: `${titleOf(80)} {{Monat}}` });
  assert.ok(preview.every((o) => o.title.length <= 90));
});
