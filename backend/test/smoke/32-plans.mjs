// Smoke-Test, Bereich «Pläne» (läuft über test/smoke.mjs, Entscheide vom 20.11.2026): Standorte, Gebäude, Stockwerke;
// je Stockwerk Umriss, Flächen (Räume, Gänge …), Bauteile und Beschriftungen; ansehen mit «Pläne ansehen», ändern mit
// «Pläne bearbeiten»
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
/** Gespeicherter Inhalt eines Stockwerks, wie er wieder gespeichert wird */
const editable = (floor) => ({
  outline: floor.outline,
  areas: floor.areas,
  walls: floor.walls,
  pillars: floor.pillars,
  openings: floor.openings,
  labels: floor.labels,
  plan: null,
  contentUpdatedAt: floor.contentUpdatedAt,
});

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
  assert.deepEqual(
    [floor.outline, floor.areas, floor.walls, floor.pillars, floor.openings, floor.labels, floor.plan],
    [null, [], [], [], [], [], null],
    'neues Stockwerk leer, ohne Umriss',
  );
});

await step('Pläne: Inhalt speichern, Namen eindeutig im Stockwerk, gleichzeitiges Bearbeiten erkannt', async () => {
  const og = floorIds.og;
  let floor = await api('GET', `/plans/floors/${og}`);
  const saentis = uuid();
  const content = {
    outline: rect(0, 0, 20, 20),
    areas: [
      { id: saentis, kind: 'room', name: `Säntis ${RUN}`, description: 'Beamer, 12 Plätze', points: rect(0, 0, 9, 7) },
      { id: uuid(), kind: 'room', name: 'Kaffeeecke', description: '', points: [[5, 13], [12, 13], [12, 20], [9, 20], [9, 16.5], [5, 16.5]] },
    ],
    labels: [{ id: uuid(), text: 'Notausgang', x: 16, y: 15.5 }],
    plan: null,
    contentUpdatedAt: floor.contentUpdatedAt,
  };
  // Doppelte Namen (Gross-/Kleinschreibung egal), Raum ohne Namen, Raum ohne Fläche
  const dup = { ...content, areas: [...content.areas, { id: uuid(), kind: 'room', name: `SÄNTIS ${RUN}`, description: '', points: rect(14, 0, 3, 3) }] };
  assert.match((await saveContent(og, dup, { expect: [400] })).message, /doppelt/);
  await saveContent(og, { ...content, areas: [{ ...content.areas[0], name: ' ' }] }, { expect: [400] });
  assert.match((await saveContent(og, { ...content, areas: [{ ...content.areas[0], points: [[0, 0], [5, 0], [9, 0]] }] }, { expect: [400] })).message, /keine Fläche/);
  // Derselbe Name in einem anderen Stockwerk ist erlaubt
  const eg = await api('GET', `/plans/floors/${floorIds.eg}`);
  await saveContent(floorIds.eg, {
    outline: rect(0, 0, 4, 4),
    areas: [{ id: uuid(), kind: 'room', name: `Säntis ${RUN}`, description: '', points: rect(0, 0, 4, 4) }],
    labels: [],
    plan: null,
    contentUpdatedAt: eg.contentUpdatedAt,
  });

  const saved = await saveContent(og, content);
  assert.ok(saved.contentUpdatedAt);
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual(floor.areas.map((a) => a.name), ['Kaffeeecke', `Säntis ${RUN}`], 'nach Namen');
  assert.deepEqual(floor.areas.find((a) => a.id === saentis).points, rect(0, 0, 9, 7));
  assert.equal(floor.areas[0].kind, 'room');
  assert.deepEqual(floor.outline, rect(0, 0, 20, 20));
  assert.equal(floor.labels[0].text, 'Notausgang');
  // Mit dem alten Stand speichern: jemand anderes hat inzwischen gespeichert
  assert.match((await saveContent(og, content, { expect: [409] })).message, /inzwischen gespeichert/);
  const tree = await api('GET', '/plans');
  assert.equal(tree.find((s) => s.id === siteId).buildings[0].floors.find((f) => f.id === og).roomCount, 2, 'Räume im Baum');
});

await step('Pläne: Umriss umschliesst alles, Flächen nach Art, Wände, Säulen, Türen und Fenster', async () => {
  const og = floorIds.og;
  let floor = await api('GET', `/plans/floors/${og}`);
  const base = editable(floor);
  // Ohne Umriss geht es nur leer; was ausserhalb liegt, nennt die Meldung
  assert.match((await saveContent(og, { ...base, outline: null }, { expect: [400] })).message, /braucht einen Umriss/);
  const outsideArea = { id: uuid(), kind: 'corridor', name: 'Laubengang', description: '', points: rect(20, 0, 2, 10) };
  assert.match((await saveContent(og, { ...base, areas: [...base.areas, outsideArea] }, { expect: [400] })).message, /umschliessen.*«Laubengang»/);
  // Gang ohne Namen, Treppenhaus mit Namen, Aussenwände (je Kante eine, bündig innen) mit Tür und Fenster, Innenwand, Säule
  const corners = rect(0, 0, 20, 20);
  const outer = corners.map((a, i) => ({ id: uuid(), a, b: corners[(i + 1) % 4], thickness: 0.3, align: 'left' }));
  const inner = { id: uuid(), a: [9, 0.3], b: [9, 7], thickness: 0.1 };
  const content = {
    ...base,
    areas: [
      ...base.areas,
      { id: uuid(), kind: 'corridor', name: '', description: '', points: rect(0, 8, 20, 3) },
      { id: uuid(), kind: 'stairs', name: `Treppe Ost ${RUN}`, description: 'bis ins 3. OG', points: rect(16, 0, 4, 7) },
    ],
    walls: [...outer, inner],
    pillars: [{ id: uuid(), shape: 'round', x: 10, y: 9.5, width: 0.4, depth: 0.4, rotation: 0 }],
    openings: [
      { id: uuid(), wallId: outer[0].id, offset: 12, width: 1.6, kind: 'double', hinge: 'start', side: 'right' },
      { id: uuid(), wallId: outer[1].id, offset: 4, width: 1.2, kind: 'window' },
      // Zweiflüglig mit ungleichen Flügeln: 90 + 40 cm
      { id: uuid(), wallId: outer[2].id, offset: 6, width: 1.3, kind: 'double', hinge: 'start', side: 'left', leaf: 0.9 },
    ],
  };
  assert.match(
    (await saveContent(og, { ...content, openings: [{ ...content.openings[2], leaf: 1.25 }] }, { expect: [400] })).message,
    /schmaler als 10 cm/,
  );
  // Tür in einer unbekannten Wand oder breiter als ihre Wand
  assert.match((await saveContent(og, { ...content, openings: [{ ...content.openings[0], wallId: uuid() }] }, { expect: [400] })).message, /keiner Wand/);
  assert.match((await saveContent(og, { ...content, openings: [{ ...content.openings[0], offset: 19.5 }] }, { expect: [400] })).message, /breiter als ihre Wand/);
  // Wand ausserhalb, Wand ohne Länge, unbekannte Lage
  const outsideWall = { id: uuid(), a: [5, 5], b: [25, 5], thickness: 0.1 };
  assert.match((await saveContent(og, { ...content, walls: [...content.walls, { ...inner, id: uuid(), b: inner.a }] }, { expect: [400] })).message, /keine Länge/);
  await saveContent(og, { ...content, walls: [{ ...inner, align: 'oben' }] }, { expect: [400] });
  assert.match((await saveContent(og, { ...content, walls: [...content.walls, outsideWall] }, { expect: [400] })).message, /eine Wand/);
  await saveContent(og, content);
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual(floor.areas.map((a) => [a.kind, a.name]), [
    ['room', 'Kaffeeecke'],
    ['room', `Säntis ${RUN}`],
    ['stairs', `Treppe Ost ${RUN}`],
    ['corridor', ''],
  ], 'Flächen ohne Namen zuletzt');
  assert.deepEqual(floor.walls, [...outer, { ...inner, align: 'center' }], 'Wände als gerade Stücke, Lage mittig als Vorgabe');
  assert.deepEqual(floor.pillars, content.pillars);
  assert.deepEqual(floor.openings[1], { ...content.openings[1], hinge: 'start', side: 'left' }, 'Vorgaben für Fenster');
  assert.equal(floor.openings[2].leaf, 0.9, 'Breite des ersten Flügels');
  // Ebenen: Vorgabe alle sichtbar, gespeichert für alle
  assert.deepEqual(floor.layers, { plan: true, areas: true, structure: true, labels: true }, 'Ebenen: Vorgabe');
  const layers = { plan: false, areas: true, structure: false, labels: true };
  await saveContent(og, { ...editable(floor), layers });
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual(floor.layers, layers, 'Ebenen gespeichert');
  await saveContent(og, { ...editable(floor), layers: { ...layers, plan: 'ja' } }, { expect: [400] });
  // Suche: Flächen mit Namen, mit Art; der Baum zählt nur Räume
  const hit = (await api('GET', `/plans/search?q=${encodeURIComponent(`treppe ost ${RUN}`)}`))[0];
  assert.deepEqual([hit.kind, hit.floorId, hit.description], ['stairs', og, 'bis ins 3. OG']);
  const tree = await api('GET', '/plans');
  assert.equal(tree.find((s) => s.id === siteId).buildings[0].floors.find((f) => f.id === og).roomCount, 2, 'nur Räume im Baum');
  // Leeres Stockwerk ohne Umriss bleibt erlaubt
  const eg = await api('GET', `/plans/floors/${floorIds.eg}`);
  await saveContent(floorIds.eg, { ...editable(eg), outline: null, areas: [] });
  await saveContent(floorIds.eg, editable(await api('GET', `/plans/floors/${floorIds.eg}`)));
  // Zurück für die folgenden Schritte: Säntis im EG
  const eg2 = await api('GET', `/plans/floors/${floorIds.eg}`);
  await saveContent(floorIds.eg, {
    ...editable(eg2),
    outline: rect(0, 0, 4, 4),
    areas: [{ id: uuid(), kind: 'room', name: `Säntis ${RUN}`, description: '', points: rect(0, 0, 4, 4) }],
  });
});

await step('Pläne: Plan als Bild hochladen, Massstab setzen, entfernen', async () => {
  const og = floorIds.og;
  let floor = await api('GET', `/plans/floors/${og}`);
  const base = editable(floor);
  const plan = { replace: true, widthPx: 1, heightPx: 1, metersPerPx: 36, x: 0, y: 0, calibrated: false };
  // Ohne Bild geht «replace» nicht
  await saveContent(og, { ...base, plan, contentUpdatedAt: floor.contentUpdatedAt }, { expect: [400] });
  await saveContent(og, { ...base, plan, contentUpdatedAt: floor.contentUpdatedAt }, { image: PNG });
  floor = await api('GET', `/plans/floors/${og}`);
  assert.ok(floor.plan.url.startsWith(`/api/plans/floors/${og}/image?v=`));
  assert.deepEqual([floor.plan.widthPx, floor.plan.metersPerPx, floor.plan.calibrated], [1, 36, false]);
  assert.equal(floor.walls.length, 5, 'Bauteile bleiben beim Hochladen');
  const res = await fetch(`${BASE}/plans/floors/${og}/image`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  // Massstab gesetzt: nur die Lage, das Bild bleibt
  await saveContent(og, { ...editable(floor), plan: { ...plan, replace: false, metersPerPx: 40, calibrated: true } });
  floor = await api('GET', `/plans/floors/${og}`);
  assert.deepEqual([floor.plan.metersPerPx, floor.plan.calibrated], [40, true]);
  // Plan entfernen
  await saveContent(og, editable(floor));
  assert.equal((await api('GET', `/plans/floors/${og}`)).plan, null);
  await api('GET', `/plans/floors/${og}/image`, undefined, { expect: [404] });
});

await step('Pläne: Suche nach Name und Beschreibung, mit Standort, Gebäude und Stockwerk', async () => {
  const byName = await api('GET', `/plans/search?q=${encodeURIComponent(`säntis ${RUN}`)}`);
  assert.equal(byName.length, 2, 'in beiden Stockwerken');
  const hit = byName.find((h) => h.floorId === floorIds.og);
  assert.deepEqual([hit.site, hit.building, hit.floor, hit.kind], [`Hauptsitz ${RUN}`, 'Gebäude Nord', '1. OG', 'room']);
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
  assert.equal((await api('GET', `/plans/search?q=${encodeURIComponent(`säntis ${RUN}`)}`)).length, 0, 'Flächen mit gelöscht');
});
