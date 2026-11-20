// Smoke-Test, Bereich «Pläne» (läuft über test/smoke.mjs, Entscheid vom 20.11.2026): Standorte, Gebäude, Stockwerke und
// Räume; ansehen für Admins und die IT mit dem Bereich «Pläne», ändern nur Admins
import { api, assert, BASE, cookie, IVAN, loginAs, PNG, RUN, step } from './lib.mjs';

const ADA = 'ada@test.local';
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const uuid = () => crypto.randomUUID();
let siteId = '';
let buildingId = '';
let floorIds = {};

/** Inhalt eines Stockwerks speichern (multipart: «content» als JSON, dazu optional das Bild «plan») */
async function saveContent(floorId, content, { image, expect } = {}) {
  const form = new FormData();
  form.append('content', JSON.stringify(content));
  if (image) form.append('plan', new Blob([image], { type: 'image/png' }), 'plan.png');
  return api('PUT', `/plans/floors/${floorId}/content`, form, expect ? { expect } : undefined);
}

await step('Pläne: ansehen mit «Pläne ansehen», ändern mit «Pläne bearbeiten»; Admins immer', async () => {
  await loginAs(ADA, 'geheim-geheim');
  const before = await api('GET', '/settings/permissions');
  const base = before.it.filter((p) => p !== 'plansView' && p !== 'plansEdit');
  await api('PUT', '/settings/permissions', { it: base });
  await loginAs(IVAN, 'geheim-geheim');
  assert.ok(!(await api('GET', '/areas')).areas.includes('plans'), 'IT ohne «Pläne»');
  assert.match((await api('GET', '/plans', undefined, { expect: [403] })).message, /Pläne ansehen/);
  await loginAs(ADA, 'geheim-geheim');
  assert.ok((await api('GET', '/areas')).areas.includes('plans'), 'Admins immer');
  await api('PUT', '/settings/permissions', { it: [...base, 'plansView'] });
  await loginAs(IVAN, 'geheim-geheim');
  assert.ok((await api('GET', '/areas')).areas.includes('plans'));
  assert.ok(Array.isArray(await api('GET', '/plans')), 'IT sieht die Pläne');
  assert.match((await api('POST', '/plans/sites', { name: `Darf nicht ${RUN}` }, { expect: [403] })).message, /Pläne bearbeiten/);
  await loginAs(ADA, 'geheim-geheim');
  await api('PUT', '/settings/permissions', before);
});

await step('Pläne: Standort, Gebäude, Stockwerke anlegen, umbenennen, umordnen; Namen eindeutig', async () => {
  siteId = (await api('POST', '/plans/sites', { name: `Hauptsitz ${RUN}` })).id;
  await api('POST', '/plans/sites', { name: `HAUPTSITZ ${RUN}` }, { expect: [409] });
  await api('POST', '/plans/sites', { name: '  ' }, { expect: [400] });
  buildingId = (await api('POST', `/plans/sites/${siteId}/buildings`, { name: 'Gebäude A' })).id;
  await api('POST', `/plans/sites/${siteId}/buildings`, { name: 'gebäude a' }, { expect: [409] });
  // Neue Stockwerke kommen zuoberst
  const eg = (await api('POST', `/plans/buildings/${buildingId}/floors`, { name: 'EG' })).id;
  const og = (await api('POST', `/plans/buildings/${buildingId}/floors`, { name: '1. OG' })).id;
  floorIds = { eg, og };
  await api('POST', `/plans/buildings/${buildingId}/floors`, { name: 'eg' }, { expect: [409] });
  const floors = () => api('GET', '/plans').then((t) => t.find((s) => s.id === siteId).buildings[0].floors.map((f) => f.name));
  assert.deepEqual(await floors(), ['1. OG', 'EG'], 'oberstes zuoberst');
  await api('PUT', `/plans/buildings/${buildingId}/floor-order`, { ids: [eg, og] });
  assert.deepEqual(await floors(), ['EG', '1. OG']);
  await api('PUT', `/plans/buildings/${buildingId}/floor-order`, { ids: [og] }, { expect: [400] });
  await api('PUT', `/plans/buildings/${buildingId}/floor-order`, { ids: [og, eg] });
  await api('PUT', `/plans/floors/${og}`, { name: '1. Obergeschoss' });
  await api('PUT', `/plans/floors/${og}`, { name: 'EG' }, { expect: [409] });
  await api('PUT', `/plans/floors/${og}`, { name: '1. OG' });
  await api('PUT', `/plans/buildings/${buildingId}`, { name: 'Gebäude Nord' });
  const floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual([floor.name, floor.building.name, floor.site.name], ['1. OG', 'Gebäude Nord', `Hauptsitz ${RUN}`]);
  assert.deepEqual([floor.rooms, floor.labels, floor.plan], [[], [], null], 'neues Stockwerk leer');
});

await step('Pläne: Inhalt speichern, Namen eindeutig im Stockwerk, gleichzeitiges Bearbeiten erkannt', async () => {
  const og = floorIds.og;
  let floor = await api('GET', `/plans/floors/${og}`);
  const saentis = uuid();
  const content = {
    rooms: [
      { id: saentis, name: `Säntis ${RUN}`, description: 'Beamer, 12 Plätze', points: rect(0, 0, 9, 7) },
      { id: uuid(), name: 'Kaffeeecke', description: '', points: [[5, 13], [12, 13], [12, 20], [9, 20], [9, 16.5], [5, 16.5]] },
    ],
    labels: [{ id: uuid(), text: 'Treppenhaus', x: 16, y: 15.5 }],
    plan: null,
    contentUpdatedAt: floor.contentUpdatedAt,
  };
  // Doppelte Namen (Gross-/Kleinschreibung egal), leerer Name, Raum ohne Fläche
  const dup = { ...content, rooms: [...content.rooms, { id: uuid(), name: `SÄNTIS ${RUN}`, description: '', points: rect(20, 0, 3, 3) }] };
  assert.match((await saveContent(og, dup, { expect: [400] })).message, /doppelt/);
  await saveContent(og, { ...content, rooms: [{ ...content.rooms[0], name: ' ' }] }, { expect: [400] });
  assert.match((await saveContent(og, { ...content, rooms: [{ ...content.rooms[0], points: [[0, 0], [5, 0], [9, 0]] }] }, { expect: [400] })).message, /keine Fläche/);
  // Derselbe Name in einem anderen Stockwerk ist erlaubt
  const eg = await api('GET', `/plans/floors/${floorIds.eg}`);
  await saveContent(floorIds.eg, { rooms: [{ id: uuid(), name: `Säntis ${RUN}`, description: '', points: rect(0, 0, 4, 4) }], labels: [], plan: null, contentUpdatedAt: eg.contentUpdatedAt });

  const saved = await saveContent(og, content);
  assert.ok(saved.contentUpdatedAt);
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual(floor.rooms.map((r) => r.name), ['Kaffeeecke', `Säntis ${RUN}`], 'nach Namen');
  assert.deepEqual(floor.rooms.find((r) => r.id === saentis).points, rect(0, 0, 9, 7));
  assert.equal(floor.labels[0].text, 'Treppenhaus');
  // Mit dem alten Stand speichern: jemand anderes hat inzwischen gespeichert
  assert.match((await saveContent(og, content, { expect: [409] })).message, /inzwischen gespeichert/);
  const tree = await api('GET', '/plans');
  assert.equal(tree.find((s) => s.id === siteId).buildings[0].floors.find((f) => f.id === og).roomCount, 2, 'Räume im Baum');
});

await step('Pläne: Plan als Bild hochladen, Massstab setzen, entfernen', async () => {
  const og = floorIds.og;
  let floor = await api('GET', `/plans/floors/${og}`);
  const base = { rooms: floor.rooms, labels: floor.labels };
  const plan = { replace: true, widthPx: 1, heightPx: 1, metersPerPx: 36, x: 0, y: 0, calibrated: false };
  // Ohne Bild geht «replace» nicht, falsche Art auch nicht
  await saveContent(og, { ...base, plan, contentUpdatedAt: floor.contentUpdatedAt }, { expect: [400] });
  await saveContent(og, { ...base, plan, contentUpdatedAt: floor.contentUpdatedAt }, { image: PNG });
  floor = await api('GET', `/plans/floors/${og}`);
  assert.ok(floor.plan.url.startsWith(`/api/plans/floors/${og}/image?v=`));
  assert.deepEqual([floor.plan.widthPx, floor.plan.metersPerPx, floor.plan.calibrated], [1, 36, false]);
  const res = await fetch(`${BASE}/plans/floors/${og}/image`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  // Massstab gesetzt: nur die Lage, das Bild bleibt
  await saveContent(og, { ...base, plan: { ...plan, replace: false, metersPerPx: 40, calibrated: true }, contentUpdatedAt: floor.contentUpdatedAt });
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual([floor.plan.metersPerPx, floor.plan.calibrated], [40, true]);
  // Plan entfernen
  await saveContent(og, { ...base, plan: null, contentUpdatedAt: floor.contentUpdatedAt });
  assert.equal((await api('GET', `/plans/floors/${og}`)).plan, null);
  await api('GET', `/plans/floors/${og}/image`, undefined, { expect: [404] });
});

await step('Pläne: Suche nach Name und Beschreibung, mit Standort, Gebäude und Stockwerk', async () => {
  const byName = await api('GET', `/plans/search?q=${encodeURIComponent(`säntis ${RUN}`)}`);
  assert.equal(byName.length, 2, 'in beiden Stockwerken');
  const hit = byName.find((h) => h.floorId === floorIds.og);
  assert.deepEqual([hit.site, hit.building, hit.floor], [`Hauptsitz ${RUN}`, 'Gebäude Nord', '1. OG']);
  assert.ok((await api('GET', '/plans/search?q=Beamer%2C%2012')).some((h) => h.floorId === floorIds.og), 'Beschreibung');
  await api('GET', '/plans/search?q=', undefined, { expect: [400] });
});

await step('Pläne: Aktionsprotokoll mit dem Weg, Löschen mit allem darunter', async () => {
  const { entries } = await api('GET', '/admin/audit-log?area=plans&limit=100');
  assert.ok(entries.some((e) => e.action === 'Standort angelegt' && e.target === `Hauptsitz ${RUN}`), 'Standort angelegt');
  assert.ok(entries.some((e) => e.action === 'Stockwerk gespeichert' && e.target === `Hauptsitz ${RUN} · Gebäude Nord · 1. OG`), 'gespeichert mit Weg');
  assert.ok(entries.some((e) => e.action === 'Reihenfolge der Stockwerke geändert'));
  await api('DELETE', `/plans/floors/${floorIds.eg}`);
  await api('GET', `/plans/floors/${floorIds.eg}`, undefined, { expect: [404] });
  await api('DELETE', `/plans/buildings/${buildingId}`);
  await api('GET', `/plans/floors/${floorIds.og}`, undefined, { expect: [404] });
  assert.deepEqual((await api('GET', '/plans')).find((s) => s.id === siteId).buildings, []);
  await api('DELETE', `/plans/sites/${siteId}`);
  assert.ok(!(await api('GET', '/plans')).some((s) => s.id === siteId));
  assert.equal((await api('GET', `/plans/search?q=${encodeURIComponent(`säntis ${RUN}`)}`)).length, 0, 'Räume mit gelöscht');
});
