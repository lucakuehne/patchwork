// Prüfung im Browser gegen die Test-Instanz nach dem Smoke-Test: Bildschirmfotos und Fehler der Konsole.
//   node ui-check.mjs http://net:8080
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

const shot = async (name, full = false) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`Bild ${name}`);
};
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

async function login(username, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('#login-user', username);
  await page.fill('#login-pass', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    problems.push(`${name}: ${err.message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/fehler-${name}.png` }).catch(() => undefined);
  }
}

await login('ada@test.local', 'geheim-geheim');

await step('eingang', async () => {
  await page.goto(`${BASE}/inbox`);
  await page.getByRole('button', { name: '+ Neu' }).waitFor();
  await shot('01-eingang');
  await page.getByRole('button', { name: '+ Neu' }).click();
  await page.locator('#new-channel').waitFor();
  await shot('02-neuer-vorgang');
  await page.keyboard.press('Escape');
});

await step('vorgang', async () => {
  await page.goto(`${BASE}/items/PW-1`);
  await page.locator('.timeline').waitFor();
  await shot('03-vorgang', true);
  // «?» beim Typ erklärt Störung und Aufgabe (Darüberfahren und Tastatur)
  const tip = page.locator('.side .type-label .help-text');
  if (await tip.isVisible()) throw new Error('Erklärung zum Typ ohne Darüberfahren sichtbar');
  await page.locator('.side .type-label .help-icon').hover();
  await tip.waitFor({ state: 'visible' });
  const text = await tip.innerText();
  if (!text.includes('Störung: Etwas funktioniert nicht mehr') || !text.includes('Aufgabe: Etwas Neues')) throw new Error(`Erklärung zum Typ: ${text}`);
  await page.locator('.side').screenshot({ path: `${OUT}/83-typ-erklaerung.png` });
  console.log('Bild 83-typ-erklaerung');
  await page.mouse.move(0, 0);
  await tip.waitFor({ state: 'hidden' });
  await page.locator('.side .type-label .help-icon').focus();
  await tip.waitFor({ state: 'visible' });
  await page.locator('.side .type-label .help-icon').blur();
});

await step('bild-einfuegen', async () => {
  await page.getByRole('button', { name: 'Intern', exact: true }).click();
  // Screenshot aus der Zwischenablage einfügen
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 260;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(0, 0, 900, 260);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = '34px sans-serif';
    ctx.fillText('Testbild aus der Zwischenablage (900 × 260)', 30, 140);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const editor = document.querySelector('.composer .ProseMirror');
    editor.focus();
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.locator('.composer .ProseMirror img[data-ref^="upload:"]').waitFor();
  await page.locator('.composer .ProseMirror').press('End');
  await page.keyboard.type('Notiz mit eingefügtem Bild');
  await page.locator('.composer').screenshot({ path: `${OUT}/04-antwortfeld-mit-bild.png` });
  console.log('Bild 04-antwortfeld-mit-bild');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await page.locator('.timeline .message.note img.text-image').first().waitFor();
  await page.locator('.timeline .message.note').first().screenshot({ path: `${OUT}/05-notiz-mit-bild.png` });
  console.log('Bild 05-notiz-mit-bild');
});

await step('originalmail', async () => {
  await page.locator('section.original').getByRole('button', { name: 'Originalmail' }).click();
  await page.locator('.dialog .headers').waitFor();
  await shot('06-originalmail');
  await page.keyboard.press('Escape');
});

await step('mails-im-verlauf', async () => {
  await page.goto(`${BASE}/items/PW-1`);
  const line = page.locator('.timeline .mail-line').filter({ hasText: 'Eingangsbestätigung' }).first();
  await line.waitFor();
  const text = (await line.innerText()).replace(/\s+/g, ' ');
  if (!/Mail «Eingangsbestätigung» an \S/.test(text)) throw new Error(`Mail-Zeile: ${text}`);
  if (!(await page.locator('.timeline .mail-line').filter({ hasText: 'Mail «Abgeschlossen»' }).count())) throw new Error('Mail «Abgeschlossen» fehlt im Verlauf');
  await line.screenshot({ path: `${OUT}/30-mail-zeile.png` });
  console.log('Bild 30-mail-zeile');
  await line.getByRole('button', { name: 'ansehen' }).click();
  await page.locator('.dialog .headers').waitFor();
  const footer = page.locator('.dialog .mail-html div[style*="border-top"]').last();
  await footer.waitFor();
  const footerSize = await footer.evaluate((el) => getComputedStyle(el).fontSize);
  if (footerSize !== '12px') throw new Error(`Fusszeile im Modal ${footerSize} statt 12px`);
  for (const label of ['Status', 'An', 'Betreff']) {
    if (!(await page.locator('.dialog .headers dt', { hasText: new RegExp(`^${label}$`) }).count())) throw new Error(`Kopf ohne ${label}`);
  }
  await page.locator('.dialog').screenshot({ path: `${OUT}/31-mail-modal.png` });
  console.log('Bild 31-mail-modal');
  // Dunkles Farbschema: die Mail bleibt hell wie versendet
  await page.emulateMedia({ colorScheme: 'dark' });
  const background = await page.locator('.dialog .own-mail').evaluate((el) => getComputedStyle(el).backgroundColor);
  if (background !== 'rgb(255, 255, 255)') throw new Error(`Mail im dunklen Farbschema mit Hintergrund ${background}`);
  await page.locator('.dialog').screenshot({ path: `${OUT}/34-mail-modal-dunkel.png` });
  console.log('Bild 34-mail-modal-dunkel');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.keyboard.press('Escape');
  await page.locator('.dialog').waitFor({ state: 'detached' });
  // Öffentliche Antwort: «Mail ansehen» in der Kopfzeile
  const reply = page.locator('.timeline .message.reply').filter({ has: page.getByRole('button', { name: 'Mail ansehen' }) }).first();
  await reply.getByRole('button', { name: 'Mail ansehen' }).click();
  await page.locator('.dialog .headers').waitFor();
  const title = await page.locator('.dialog').innerText();
  if (!title.includes('Mail «Öffentliche Antwort»')) throw new Error('Modal der Antwort ohne Titel «Öffentliche Antwort»');
  await page.locator('.dialog').screenshot({ path: `${OUT}/32-antwort-mail.png` });
  console.log('Bild 32-antwort-mail');
  await page.keyboard.press('Escape');
  await shot('33-verlauf-mit-mails', true);
});

await step('notiz-zeit', async () => {
  // Admin setzt eine interne Notiz auf gestern 09:30; sie zeigt «Zeit angepasst» mit der ursprünglichen Zeit
  await page.goto(`${BASE}/items/PW-1`);
  await page.locator('.timeline').waitFor();
  await page.getByRole('button', { name: 'Intern', exact: true }).click();
  await page.locator('.composer .ProseMirror').click();
  await page.keyboard.type('Telefonat von gestern nachgetragen');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  const note = page.locator('.timeline .message.note', { hasText: 'Telefonat von gestern nachgetragen' });
  await note.waitFor();
  await note.getByRole('button', { name: 'Zeit anpassen' }).click();
  const input = page.locator('#note-time');
  await input.waitFor();
  const yesterday = await page.evaluate(() => {
    const d = new Date(Date.now() - 86_400_000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:30`;
  });
  await input.fill(yesterday);
  await page.locator('.dialog').screenshot({ path: `${OUT}/65-notiz-zeit-dialog.png` });
  console.log('Bild 65-notiz-zeit-dialog');
  await page.locator('.dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.locator('.toast', { hasText: 'Zeit der Notiz angepasst' }).waitFor();
  const marker = note.locator('.time-changed');
  await marker.waitFor();
  const title = (await marker.getAttribute('title')) ?? '';
  if (!title.startsWith('Ursprünglich') || !title.includes('Ada Admin')) throw new Error(`Hinweis «Zeit angepasst»: ${title}`);
  const time = (await note.locator('.time').first().innerText()).trim();
  if (!time.endsWith('09:30')) throw new Error(`Zeit der Notiz nach dem Anpassen: ${time}`);
  await note.screenshot({ path: `${OUT}/66-notiz-zeit-angepasst.png` });
  console.log('Bild 66-notiz-zeit-angepasst');
});

await step('im-namen', async () => {
  // Admin schreibt eine interne Notiz im Namen von Ivan: Autor Ivan, beim Darüberfahren «erfasst von Ada Admin»
  await page.goto(`${BASE}/items/PW-1`);
  await page.locator('.timeline').waitFor();
  await page.getByRole('button', { name: 'Intern', exact: true }).click();
  const as = page.locator('.composer select[aria-label="Im Namen von"]');
  if ((await as.inputValue()) !== '') throw new Error('«Als» steht nicht auf mir selbst');
  await as.selectOption({ label: 'Ivan IT' });
  await page.locator('.composer .ProseMirror').click();
  await page.keyboard.type('Im Namen von Ivan nachgetragen');
  await page.locator('.composer').screenshot({ path: `${OUT}/85-im-namen.png` });
  console.log('Bild 85-im-namen');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  const note = page.locator('.timeline .message.note', { hasText: 'Im Namen von Ivan nachgetragen' });
  await note.waitFor();
  const name = note.locator('.entry-head .name');
  if ((await name.innerText()).trim() !== 'Ivan IT') throw new Error(`Autor der Notiz: ${await name.innerText()}`);
  if ((await name.getAttribute('title')) !== 'erfasst von Ada Admin') throw new Error(`Vermerk: ${await name.getAttribute('title')}`);
  if (!(await note.getByRole('button', { name: 'Bearbeiten' }).count())) throw new Error('Erfassender Admin kann die Notiz nicht bearbeiten');
  if ((await as.inputValue()) !== '') throw new Error('«Als» nach dem Senden nicht zurück auf mir selbst');
  await note.screenshot({ path: `${OUT}/86-im-namen-verlauf.png` });
  console.log('Bild 86-im-namen-verlauf');
});

await step('kennung-im-text', async () => {
  // «PW-1» im Text wird zum Link; ein Klick öffnet den Vorgang in der App, ohne die Seite neu zu laden
  const other = (await api('GET', '/items?view=incidents')).data.items.find((i) => i.number !== 1);
  await page.goto(`${BASE}/items/${other.prefix}-${other.number}`);
  await page.locator('.timeline').waitFor();
  await page.getByRole('button', { name: 'Intern', exact: true }).click();
  await page.locator('.composer .ProseMirror').click();
  await page.keyboard.type('Gleiche Ursache wie PW-1');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  const note = page.locator('.timeline .message.note', { hasText: 'Gleiche Ursache wie PW-1' }).first();
  const link = note.locator('a.item-ref', { hasText: 'PW-1' });
  await link.waitFor();
  if ((await link.getAttribute('target')) !== null) throw new Error('Link auf einen Vorgang öffnet einen neuen Tab');
  await note.screenshot({ path: `${OUT}/88-kennung-im-text.png` });
  console.log('Bild 88-kennung-im-text');
  await page.evaluate(() => (window.__sameDocument = true));
  await link.click();
  await page.waitForURL((url) => url.pathname === '/items/PW-1');
  if (!(await page.evaluate(() => window.__sameDocument === true))) throw new Error('Klick auf den Link lädt die Seite neu');
  await page.locator('.timeline').waitFor();
});

await step('vorschau', async () => {
  // Anhänge der Antwort «Mit Anhängen …» aus dem Smoke-Test öffnen sich im Fenster statt als Download
  await page.goto(`${BASE}/items/PW-1`);
  const message = page.locator('.timeline .message.reply', { hasText: 'Mit Anhängen' }).first();
  await message.waitFor();
  await message.screenshot({ path: `${OUT}/44-anhaenge.png` });
  console.log('Bild 44-anhaenge');
  const downloads = [];
  const onDownload = (d) => downloads.push(d.suggestedFilename());
  page.on('download', onDownload);
  const dialog = page.locator('.dialog');
  const close = async () => {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  };

  await message.locator('a.attachment', { hasText: 'setup.log' }).click();
  await dialog.locator('pre.text-preview', { hasText: 'mit Grüssen' }).waitFor();
  if (!(await dialog.getByRole('link', { name: 'Herunterladen' }).count())) throw new Error('«Herunterladen» fehlt');
  await dialog.screenshot({ path: `${OUT}/45-vorschau-text.png` });
  console.log('Bild 45-vorschau-text');
  await close();

  await message.locator('a.attachment', { hasText: 'bild.png' }).click();
  const image = dialog.locator('img.preview-image');
  await image.waitFor();
  await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await image.elementHandle());
  await close();

  await message.locator('a.attachment', { hasText: 'Weitergeleitet.eml' }).click();
  await dialog.locator('.headers', { hasText: 'Weitergeleitete Mail' }).waitFor();
  await dialog.locator('.mail-body', { hasText: 'Inhalt der weitergeleiteten Mail' }).waitFor();
  await dialog.getByRole('link', { name: /innen\.txt/ }).waitFor();
  await dialog.screenshot({ path: `${OUT}/46-vorschau-mail.png` });
  console.log('Bild 46-vorschau-mail');
  await close();
  page.off('download', onDownload);
  if (downloads.length) throw new Error(`Heruntergeladen statt Vorschau: ${downloads.join(', ')}`);

  // PDF im Betrachter des Browsers (im Browser ohne Oberfläche gibt es keinen, deshalb nur der Rahmen)
  await message.locator('a.attachment', { hasText: 'Rechnung.pdf' }).click();
  await dialog.locator('iframe.pdf').waitFor();
  await close();

  // Anhang der Originalmail im zweiten Fenster
  await page.locator('section.original').getByRole('button', { name: 'Originalmail' }).click();
  await dialog.locator('.headers').waitFor();
  await dialog.getByRole('link', { name: /Fehlermeldung/ }).click();
  await page.locator('.dialog pre.text-preview', { hasText: 'Timeout' }).waitFor();
  await shot('47-vorschau-aus-originalmail');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Eingebettetes Bild einer Outlook-Mail in der Meldung, in der Antwort an seiner Stelle; nicht noch einmal als Anhang
  const inbox = (await api('GET', '/items?view=inbox')).data.items;
  const withImage = inbox.find((i) => i.title.startsWith('Bild im Span'));
  if (!withImage) throw new Error('Vorgang «Bild im Span» fehlt');
  await page.goto(`${BASE}/items/${withImage.prefix}-${withImage.number}`);
  const shown = page.locator('section.original .prose img');
  await shown.waitFor();
  await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await shown.elementHandle());
  if (await page.locator('section.original a.attachment').count()) throw new Error('Eingebettetes Bild zusätzlich als Anhang');
  const reply = page.locator('.timeline .message.reply', { hasText: 'Hier das neue Bild' });
  await reply.locator('.prose img').waitFor();
  const listed = (await reply.locator('a.attachment .name').allInnerTexts()).join(', ');
  if (listed !== 'Protokoll.log') throw new Error(`Anhänge der Antwort: ${listed}`);
  await shot('48-eingebettete-bilder', true);
});

await step('listen', async () => {
  await page.goto(`${BASE}/incidents`);
  await page.locator('table.table').waitFor();
  await shot('07-liste-stoerungen');
  await page.goto(`${BASE}/tasks/done`).catch(() => undefined);
});

await step('filter', async () => {
  // Störungen nach Priorität filtern; die Auswahl bleibt nach dem Neuladen
  await page.goto(`${BASE}/incidents`);
  const bar = page.locator('.list-filters');
  await bar.waitFor();
  await bar.locator('select[aria-label="Priorität"]').selectOption('high');
  await page.waitForTimeout(600);
  const rows = await page.locator('table.table tbody tr').allInnerTexts();
  if (!rows.length || rows.some((r) => !r.includes('Hoch'))) throw new Error(`Filter Priorität: ${rows.length} Zeilen, nicht alle «Hoch»`);
  await page.reload();
  await bar.waitFor();
  if ((await bar.locator('select[aria-label="Priorität"]').inputValue()) !== 'high') throw new Error('Filter nach dem Neuladen nicht mehr gesetzt');
  await shot('56-filter');
  await bar.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await page.waitForTimeout(400);
  if ((await page.locator('table.table tbody tr').count()) <= rows.length - 1) throw new Error('Zurücksetzen zeigt nicht wieder alle');
  // Sortieren per Spaltenkopf: aufsteigend, absteigend, dann wieder die Reihenfolge der Ansicht
  const title = page.locator('th.sort', { hasText: 'Titel' });
  await title.click();
  await page.locator('th[aria-sort="ascending"]', { hasText: 'Titel' }).waitFor();
  await shot('57-sortiert');
  await title.click();
  await page.locator('th[aria-sort="descending"]', { hasText: 'Titel' }).waitFor();
  await title.click();
  await page.waitForTimeout(300);
  if (await page.locator('th[aria-sort]').count()) throw new Error('Sortierung nach dem dritten Klick nicht aufgehoben');
  // Board und abgeschlossene Aufgaben haben die Filterleiste ebenso
  for (const path of ['/tasks', '/tasks/done', '/inbox', '/incidents/resolved']) {
    await page.goto(`${BASE}${path}`);
    await page.locator('.list-filters select[aria-label="Zuständig"]').waitFor();
  }
});

await step('alte-adressen', async () => {
  // Frühere deutsche Adressen (Lesezeichen, Links in versendeten Mails) führen auf die englischen
  const cases = [
    ['/eingang', '/inbox', ''],
    ['/aufgaben?vorgang=1', '/tasks', '?item=PW-1'],
    ['/tasks?item=1', '/tasks', '?item=PW-1'],
    ['/v/1', '/items/PW-1', ''],
    ['/items/1', '/items/PW-1', ''],
    ['/portal/v/1', '/items/PW-1', ''],
    ['/admin/ausgehende-mails?status=nicht-versendet', '/admin/outgoing-mails', '?status=withheld'],
    ['/admin/eingehende-mails?ergebnis=fehler&herkunft=simuliert', '/admin/incoming-mails', '?result=failed&origin=simulated'],
    ['/admin/status', '/admin/statuses', ''],
  ];
  for (const [old, path, search] of cases) {
    await page.goto(`${BASE}${old}`);
    await page.waitForURL((url) => url.pathname === path && url.search === search, { timeout: 5000 }).catch(() => {
      throw new Error(`${old} führt auf ${new URL(page.url()).pathname}${new URL(page.url()).search} statt ${path}${search}`);
    });
  }
  await page.keyboard.press('Escape');
});

await step('verwaltung', async () => {
  await page.goto(`${BASE}/admin/channels`);
  await page.locator('.channel-row').first().waitFor();
  await shot('08-meldewege');
  await page.locator('.channel-row .icon-picker button').first().click();
  await shot('09-symbolauswahl');
  await page.goto(`${BASE}/admin/general`);
  await page.locator('#portal-access').waitFor();
  await page.selectOption('#portal-access', 'selected');
  await shot('10-portal-einstellung', true);
  await page.goto(`${BASE}/admin/incoming-mails`);
  await page.locator('tbody tr.clickable').first().waitFor();
  await shot('11-eingehende-mails');
  await page.locator('tbody tr.clickable').first().click();
  await page.locator('.dialog .headers').waitFor();
  await shot('12-eingehende-mail-detail');
  await page.keyboard.press('Escape');
});

await step('logo', async () => {
  // Ohne eigenes Logo: Patchwork-Logo (Signet und Schriftzug), unabhängig vom eingestellten Namen
  const loaded = (selector) => page.locator(selector).evaluate((img) => img.complete && img.naturalWidth > 0);
  await page.goto(`${BASE}/inbox`);
  await page.locator('.header .brand [role="img"][aria-label="Patchwork"]').waitFor();
  if (!(await loaded('.header .brand img[src="/logo.svg"]'))) throw new Error('Logo nicht geladen');
  await page.locator('header.header').screenshot({ path: `${OUT}/67-logo-kopfzeile.png` });
  console.log('Bild 67-logo-kopfzeile');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('header.header').screenshot({ path: `${OUT}/68-logo-dunkel.png` });
  console.log('Bild 68-logo-dunkel');
  await page.emulateMedia({ colorScheme: 'light' });
  // Schmaler Bildschirm: nur das Signet
  await page.setViewportSize({ width: 500, height: 900 });
  if (await page.locator('.header .brand img[src="/logo.svg"]').isVisible()) throw new Error('Schmal: Schriftzug noch sichtbar');
  if (!(await page.locator('.header .brand img[src="/favicon.svg"]').isVisible())) throw new Error('Schmal: Signet fehlt');
  await page.locator('header.header').screenshot({ path: `${OUT}/69-logo-schmal.png` });
  console.log('Bild 69-logo-schmal');
  await page.setViewportSize({ width: 1400, height: 950 });
  // Eigenes Logo ersetzt Signet und Schriftzug
  const status = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('Firma AG', 40, 40);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const form = new FormData();
    form.append('file', new File([blob], 'logo.png', { type: 'image/png' }));
    return (await fetch('/api/settings/logo', { method: 'POST', headers: { 'x-patchwork': '1' }, body: form })).status;
  });
  if (status !== 204) throw new Error(`Logo hochladen: HTTP ${status}`);
  await page.reload();
  await page.locator('.header .brand img.custom[alt]').waitFor();
  if (await page.locator('.header .brand img[src="/logo.svg"]').count()) throw new Error('Eigenes Logo: Patchwork-Logo noch da');
  if (!(await loaded('.header .brand img.custom'))) throw new Error('Eigenes Logo nicht geladen');
  await page.locator('header.header').screenshot({ path: `${OUT}/70-eigenes-logo.png` });
  console.log('Bild 70-eigenes-logo');
  await api('DELETE', '/settings/logo');
  await page.reload();
  await page.locator('.header .brand img[src="/logo.svg"]').waitFor();
});

await step('status', async () => {
  await page.goto(`${BASE}/admin/statuses`);
  await page.locator('.vue-flow__node').first().waitFor();
  await shot('16-status', true);
  // Pfeil ziehen: in der Karte «Aufgabe» von «Backlog» nach «Geplant»
  const statuses = (await api('GET', '/statuses')).data;
  const id = (key) => statuses.find((s) => s.type === 'task' && s.key === key).id;
  const source = page.locator(`.vue-flow__node[data-id="${id('backlog')}"] .vue-flow__handle.source:not(.start-handle)`);
  // Ablegen irgendwo auf dem Ziel, hier im rechten Teil des Kästchens
  const target = page.locator(`.vue-flow__node[data-id="${id('planned')}"]`);
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const flow = (await api('GET', '/statuses/flow')).data;
  if (!flow.transitions.some((t) => t.fromId === id('backlog') && t.toId === id('planned'))) {
    throw new Error('Pfeil wurde nicht gespeichert');
  }
  // Eingeschränkter Ablauf mit Pfeilen: Darstellung der Karte «Aufgabe»
  await api('PUT', '/statuses/flow', {
    type: 'task',
    restrict: true,
    transitions: [
      { fromId: id('backlog'), toId: id('planned') },
      { fromId: id('planned'), toId: id('in_progress') },
      { fromId: id('in_progress'), toId: id('done') },
      { fromId: id('done'), toId: id('in_progress') },
    ],
  });
  await page.reload();
  await page.locator('.vue-flow__edge').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  const drawn = await page.locator('.type-card').nth(1).locator('.vue-flow__edge').count();
  if (drawn !== 4) throw new Error(`${drawn} statt 4 Pfeile gezeichnet`);
  const curved = await page.locator('.type-card').nth(1).locator('.vue-flow__edge-path[d*=" Q "]').count();
  if (curved !== 2) throw new Error(`${curved} statt 2 gebogene Pfeile (Hin- und Rückweg)`);
  await page.locator('.type-card').nth(1).screenshot({ path: `${OUT}/18-status-mit-pfeilen.png` });
  console.log('Bild 18-status-mit-pfeilen');
  // Störung: typische Hin- und Rückwege
  const INCIDENT_KEYS = { new: 'new', in_progress: 'in_progress', waiting: 'waiting', done: 'resolved' };
  const inc = (role) => statuses.find((s) => s.type === 'incident' && s.key === INCIDENT_KEYS[role]).id;
  const pair = (x, y) => [{ fromId: inc(x), toId: inc(y) }, { fromId: inc(y), toId: inc(x) }];
  await api('PUT', '/statuses/flow', {
    type: 'incident',
    restrict: false,
    transitions: [{ fromId: inc('new'), toId: inc('in_progress') }, ...pair('in_progress', 'waiting'), ...pair('in_progress', 'done'), { fromId: inc('waiting'), toId: inc('done') }],
  });
  await page.reload();
  await page.locator('.vue-flow__edge').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  await page.locator('.type-card').nth(0).screenshot({ path: `${OUT}/17-status-stoerung.png` });
  console.log('Bild 17-status-stoerung');
  // aufräumen
  await api('PUT', '/statuses/flow', { type: 'task', restrict: false, transitions: [] });
  await api('PUT', '/statuses/flow', { type: 'incident', restrict: false, transitions: [] });
  // Lösch-Dialog eines Ziel-Status: «Gelöst» ist «Automatisch schliessen in»
  await page.reload();
  await page.locator('.vue-flow__node').first().waitFor();
  const resolved = statuses.find((s) => s.type === 'incident' && s.key === 'resolved');
  await page.getByRole('button', { name: `${resolved.label} löschen` }).click();
  await page.locator('#remove-target-close').waitFor();
  await page.locator('.dialog').screenshot({ path: `${OUT}/20-loeschen-ziel.png` });
  console.log('Bild 20-loeschen-ziel');
  const blockedDelete = await page.locator('.dialog').getByRole('button', { name: 'Löschen' }).isDisabled();
  if (!blockedDelete) throw new Error('«Löschen» ohne Ersatz für das Ziel nicht gesperrt');
  await page.keyboard.press('Escape');
  // Klick auf ein Schild springt zum Feld
  await page.locator('.type-card').nth(1).locator('.target-badge', { hasText: 'nach Antwort' }).click();
  await page.waitForTimeout(400);
  const focused = await page.evaluate(() => document.activeElement?.id ?? '');
  if (!focused.includes('reply')) throw new Error(`Schild springt nicht zum Feld (Fokus: ${focused})`);
  // Startpfeil ziehen: auf «Erledigt» (abgeschlossen) wirkungslos, auf «Geplant» setzt er «Neuer Vorgang erhält»
  const dragStart = async (toKey) => {
    const handle = page.locator('.type-card').nth(1).locator('.vue-flow__handle.start-handle');
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await page.locator(`.vue-flow__node[data-id="${id(toKey)}"]`).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    return (await api('GET', '/statuses/targets')).data.task.start;
  };
  // Start der Aufgaben ist (wieder, seit 23.10.2026) «Backlog»
  if ((await dragStart('done')) !== id('backlog')) throw new Error('Startpfeil auf abgeschlossenem Status angenommen');
  if ((await dragStart('planned')) !== id('planned')) throw new Error('Startpfeil auf «Geplant» nicht übernommen');
  await page.locator('.type-card').nth(1).screenshot({ path: `${OUT}/24-startpfeil-geplant.png` });
  console.log('Bild 24-startpfeil-geplant');
  if ((await dragStart('backlog')) !== id('backlog')) throw new Error('Startpfeil zurück auf «Backlog» nicht übernommen');
  await page.locator('.type-card').nth(1).screenshot({ path: `${OUT}/21-ziele-aufgabe.png` });
  console.log('Bild 21-ziele-aufgabe');
});

await step('typwechsel', async () => {
  const tasks = (await api('GET', '/items?view=board')).data.items;
  const task = tasks.find((t) => t.prefix === 'PW' && t.status) ?? tasks[0];
  await page.goto(`${BASE}/items/${task.prefix}-${task.number}`);
  await page.locator('.type-switch').waitFor();
  await page.locator('.type-switch').getByRole('button', { name: 'Störung' }).click();
  await page.locator('#type-change-status').waitFor();
  await page.locator('.dialog').screenshot({ path: `${OUT}/22-typwechsel.png` });
  console.log('Bild 22-typwechsel');
  await page.keyboard.press('Escape');
  await page.locator('.dialog').waitFor({ state: 'detached' });

  // Zur Aufgabe: Status-Dialog ohne Vorauswahl und ohne Ablehnen-Status, erst nach der Wahl wird der Typ gesetzt
  const statuses = (await api('GET', '/statuses')).data;
  const incident = (await api('GET', '/items?view=incidents')).data.items[0];
  await page.goto(`${BASE}/items/${incident.prefix}-${incident.number}`);
  await page.locator('.type-switch').getByRole('button', { name: 'Aufgabe' }).click();
  const select = page.locator('#type-change-status');
  await select.waitFor();
  if ((await select.inputValue()) !== '') throw new Error('Status beim Typ «Aufgabe» vorgewählt');
  const options = await select.locator('option').allInnerTexts();
  const rejectLabel = statuses.find((s) => s.type === 'task' && s.key === 'rejected').label;
  if (options.some((o) => o.startsWith(rejectLabel))) throw new Error('Ablehnen-Status zur Wahl');
  if (!(await page.locator('.dialog').getByRole('button', { name: 'Typ ändern' }).isDisabled())) throw new Error('«Typ ändern» ohne Status möglich');
  await page.locator('.dialog').screenshot({ path: `${OUT}/49-zur-aufgabe.png` });
  console.log('Bild 49-zur-aufgabe');
  await select.selectOption({ label: 'Geplant' });
  await page.locator('.dialog').getByRole('button', { name: 'Typ ändern' }).click();
  await page.locator('.dialog').waitFor({ state: 'detached' });
  await page.locator('.title-row', { hasText: 'Geplant' }).waitFor();

  // Aus dem Eingang ebenso
  await page.goto(`${BASE}/inbox`);
  await page.locator('tbody tr').first().getByRole('button', { name: 'Aufgabe' }).click();
  await page.locator('#type-change-status').waitFor();
  if ((await page.locator('#type-change-status').inputValue()) !== '') throw new Error('Status im Eingang vorgewählt');
  await page.locator('.dialog').screenshot({ path: `${OUT}/50-eingang-zur-aufgabe.png` });
  console.log('Bild 50-eingang-zur-aufgabe');
  await page.keyboard.press('Escape');
});

await step('regel-status', async () => {
  await page.goto(`${BASE}/admin/rules`);
  await page.getByRole('button', { name: '+ Regel' }).click();
  await page.selectOption('#rule-type', 'task');
  const select = page.locator('#rule-status');
  await select.waitFor();
  if ((await select.inputValue()) !== '') throw new Error('Status der Regel vorgewählt');
  await page.locator('.actions-grid').screenshot({ path: `${OUT}/51-regel-status.png` });
  console.log('Bild 51-regel-status');
  await page.keyboard.press('Escape');
});

await step('zeitregel', async () => {
  await page.goto(`${BASE}/admin/rules`);
  await page.getByRole('button', { name: '+ Regel' }).click();
  await page.getByRole('button', { name: 'nach Zeit' }).click();
  await page.waitForTimeout(300);
  if (await page.locator('.dialog').count()) await page.locator('.dialog').screenshot({ path: `${OUT}/23-zeitregel.png` });
  else await page.screenshot({ path: `${OUT}/23-zeitregel.png`, fullPage: true });
  console.log('Bild 23-zeitregel');
  await page.keyboard.press('Escape');
});

await step('vorlagen', async () => {
  await page.goto(`${BASE}/admin/mail-templates`);
  await page.locator('nav.list .entry', { hasText: 'Zugewiesen' }).click();
  const editor = page.locator('section.editor .ProseMirror');
  await editor.waitFor();
  // Platzhalter an der Cursorposition: ans Ende des Textes
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await page.locator('section.editor .placeholders').getByRole('button', { name: 'Zuständig Vorname', exact: true }).click();
  await page.waitForTimeout(400);
  const tokens = await page.locator('section.editor .placeholder-token').count();
  if (tokens < 3) throw new Error(`nur ${tokens} hervorgehobene Platzhalter`);
  const text = await editor.innerText();
  if (!text.includes('{{Zuständig Vorname}}')) throw new Error('Platzhalter nicht eingefügt');
  await page.locator('section.editor').screenshot({ path: `${OUT}/25-vorlage-zugewiesen.png` });
  console.log('Bild 25-vorlage-zugewiesen');
  await page.getByRole('button', { name: 'Änderungen verwerfen' }).click();
  // Link-Zeile: Link mit dem Ziel {{Link}} bleibt im Editor erhalten
  await page.locator('nav.list .entry', { hasText: 'Link-Zeile (Melder)' }).click();
  await page.locator('section.editor .ProseMirror a').waitFor();
  const href = await page.locator('section.editor .ProseMirror a').first().getAttribute('href');
  if (href !== '{{Link}}') throw new Error(`Link-Ziel im Editor: ${href}`);
});

await step('textbaustein', async () => {
  await page.goto(`${BASE}/admin/snippets`);
  await page.getByRole('button', { name: '+ Textbaustein' }).click();
  const editor = page.locator('.dialog .ProseMirror');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type('Guten Tag ');
  await page.locator('.dialog .placeholders').getByRole('button', { name: /Melder Vorname/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.dialog').screenshot({ path: `${OUT}/26-textbaustein.png` });
  console.log('Bild 26-textbaustein');
  await page.keyboard.press('Escape');
});

await step('benutzer-namen', async () => {
  await page.goto(`${BASE}/admin/users`);
  // Spalte «Zuletzt aktiv» neben der letzten Anmeldung; Ada ist gerade aktiv
  await page.locator('th', { hasText: 'Zuletzt aktiv' }).waitFor();
  const adaRow = page.locator('tbody tr', { hasText: 'ada@test.local' });
  const cells = await adaRow.locator('td').allInnerTexts();
  const headers = await page.locator('thead th').allInnerTexts();
  const active = cells[headers.findIndex((h) => h.trim() === 'Zuletzt aktiv')]?.trim();
  if (!active || active === '–') throw new Error(`«Zuletzt aktiv» bei Ada leer: ${active}`);
  await shot('64-benutzer-zuletzt-aktiv');
  await page.getByRole('button', { name: '+ Benutzer' }).click();
  await page.locator('#u-name').fill('Muster, Anna');
  await page.waitForTimeout(200);
  const first = await page.locator('#u-first').inputValue();
  const last = await page.locator('#u-last').inputValue();
  if (first !== 'Anna' || last !== 'Muster') throw new Error(`Vorbelegung: ${first} / ${last}`);
  await page.locator('.dialog').screenshot({ path: `${OUT}/27-benutzer-namen.png` });
  console.log('Bild 27-benutzer-namen');
  await page.keyboard.press('Escape');
});

await step('als-benutzer', async () => {
  const ivan = (await api('GET', '/admin/users')).data.find((u) => u.email.startsWith('ivan-'));
  // Ein zweiter Tab mit einem Vorgang: Er muss den Wechsel bemerken und neu laden
  const other = await context.newPage();
  await other.goto(`${BASE}/items/PW-1`);
  await other.locator('.timeline').waitFor();
  await page.goto(`${BASE}/admin/users`);
  await page.locator('tbody tr', { hasText: ivan.email }).click();
  // Ungespeicherte Änderung: Rückfrage; Escape schliesst nur die Rückfrage, der Dialog bleibt mit der Änderung
  await page.locator('#u-name').fill(`${ivan.name} geändert`);
  await page.getByRole('button', { name: 'Als dieser Benutzer arbeiten' }).click();
  await page.getByText('Ungespeicherte Änderungen').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await page.locator('#u-name').inputValue()) !== `${ivan.name} geändert`) throw new Error('Escape hat den Bearbeiten-Dialog geschlossen');
  await page.locator('#u-name').fill(ivan.name);
  await page.getByRole('button', { name: 'Als dieser Benutzer arbeiten' }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/inbox'));
  await page.locator('.impersonation').waitFor();
  await other.locator('.impersonation').waitFor({ timeout: 10000 });
  console.log('Zweiter Tab zeigt den Balken');
  await other.close();
  // Balken und Kopfzeile kleben beim Scrollen oben
  await page.goto(`${BASE}/items/PW-1`);
  await page.locator('.timeline').waitFor();
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(500);
  const top = await page.locator('.impersonation').boundingBox();
  if (!top || top.y > 1) throw new Error(`Balken klebt nicht oben (y = ${top?.y})`);
  await shot('28-als-benutzer');
  await page.getByRole('button', { name: /Zurück zu/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/admin/users'));
  if (await page.locator('.impersonation').count()) throw new Error('Balken nach der Rückkehr noch sichtbar');
});

await step('board', async () => {
  await page.goto(`${BASE}/tasks`);
  await page.locator('.column').first().waitFor();
  // Karten im Backlog (Start-Status) leicht ausgegraut wie die erledigten: Titel in derselben Farbe
  const backlog = page.locator('.board-card.backlog .card-title').first();
  await backlog.waitFor();
  const color = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
  const done = await color(page.locator('.board-card.done .card-title').first());
  const open = await color(page.locator('.board-card:not(.backlog):not(.done) .card-title').first());
  if ((await color(backlog)) !== done || done === open) throw new Error(`Backlog nicht ausgegraut (${await color(backlog)}, erledigt ${done}, offen ${open})`);
  if ((await page.locator('.column').first().locator('.board-card:not(.backlog)').count()) > 0) throw new Error('Nicht alle Karten im Backlog ausgegraut');
  await shot('19-board');
});

await step('aufgaben-neu', async () => {
  // Vorbelegung «Intern» für Aufgaben
  const channels = (await api('GET', '/channels')).data;
  const internalChannel = channels.find((c) => c.label === 'Intern');
  if (!internalChannel || internalChannel.icon !== 'alert') throw new Error('Meldeweg «Intern» mit Glocke fehlt');
  await api('PUT', '/channels/defaults', { incident: null, task: internalChannel.id });
  await page.goto(`${BASE}/admin/channels`);
  await page.getByRole('heading', { name: 'Vorbelegung beim Erfassen' }).waitFor();
  await shot('35-meldewege-vorbelegung', true);

  await page.goto(`${BASE}/tasks`);
  await page.locator('.column').first().waitFor();
  // Spalten leicht in der Farbe des Status, nicht einfach grau
  const backgrounds = await page.locator('.column').evaluateAll((cols) => cols.map((c) => getComputedStyle(c).backgroundColor));
  if (new Set(backgrounds).size < 2) throw new Error(`Spalten ohne Statusfarbe: ${backgrounds.join(', ')}`);
  // «+» nur in offenen Spalten; öffnet «Neue Aufgabe» mit dem Status der Spalte und «Intern» vorbelegt
  const openColumn = page.locator('.column').filter({ has: page.locator('button.add') }).nth(1);
  const statusLabel = (await openColumn.locator('.column-head .badge').innerText()).trim();
  if (await page.locator('.column').filter({ hasText: 'letzte 14 Tage' }).locator('button.add').count()) throw new Error('«+» in abgeschlossener Spalte');
  await openColumn.locator('button.add').click();
  await page.locator('#new-status').waitFor();
  const chosenStatus = await page.locator('#new-status').evaluate((s) => s.options[s.selectedIndex].text);
  if (chosenStatus !== statusLabel) throw new Error(`Status im Dialog «${chosenStatus}» statt «${statusLabel}»`);
  const chosenChannel = await page.locator('#new-channel').evaluate((s) => s.options[s.selectedIndex].text);
  if (chosenChannel !== 'Intern') throw new Error(`Meldeweg im Dialog «${chosenChannel}» statt «Intern»`);
  await page.fill('#new-title', 'Neue Aufgabe aus der Spalte');
  const yesterday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() - 86_400_000));
  await page.fill('#new-due', yesterday);
  await page.locator('.dialog').screenshot({ path: `${OUT}/36-neue-aufgabe-spalte.png` });
  console.log('Bild 36-neue-aufgabe-spalte');
  // Nach dem Erstellen bleibt man auf dem Board; die Meldung bietet «Öffnen»
  await page.getByRole('button', { name: 'Erfassen' }).click();
  const created = page.locator('.toast', { hasText: 'erstellt' });
  await created.waitFor();
  if (!page.url().endsWith('/tasks')) throw new Error(`Nach dem Erstellen auf ${page.url()} statt auf dem Board`);
  await page.locator('.board-card', { hasText: 'Neue Aufgabe aus der Spalte' }).waitFor();
  await page.screenshot({ path: `${OUT}/40-erstellt-meldung.png` });
  console.log('Bild 40-erstellt-meldung');
  // «Öffnen» zeigt die Aufgabe im Fenster (Standard); weiter geht es auf ihrer Seite
  await created.getByRole('link', { name: 'Öffnen' }).click();
  await page.waitForURL(/\/tasks\?item=PW-\d+$/);
  const number = Number(new URL(page.url()).searchParams.get('item').replace(/^PW-/, ''));
  await page.locator('.dialog.huge .composer').waitFor();
  await page.goto(`${BASE}/items/PW-${number}`);

  // Aufgabe: Antwortfeld standardmässig «Intern», Fälligkeit überfällig in der Seitenleiste
  await page.locator('.composer').waitFor();
  const active = (await page.locator('.composer .segmented button.active').innerText()).trim();
  if (!active.includes('Intern')) throw new Error(`Antwortfeld bei Aufgaben auf «${active}» statt «Intern»`);
  await page.locator('.due-hint.overdue').waitFor();
  // Abgrenzung zwischen Checklisten und Antworten
  await page.locator('.section-divider', { hasText: 'Verlauf' }).waitFor();
  // Checkliste: Abhaken erscheint im Verlauf
  await api('POST', `/items/${number}/checklists`, { title: 'Schritte' });
  const list = (await api('GET', `/items/${number}`)).data.checklists[0].id;
  await api('POST', `/checklists/${list}/items`, { text: 'Erster Schritt' });
  await api('POST', `/checklists/${list}/items`, { text: 'Zweiter Schritt' });
  await page.reload();
  await page.locator('.checklists input[type="checkbox"]').first().check();
  await page.locator('.timeline .events', { hasText: 'Punkt «Erster Schritt» abgehakt' }).waitFor();
  // Stummschalten ist ausgeblendet
  if (await page.getByText('Benachrichtigungen für mich stummschalten').count()) throw new Error('Stummschalten noch sichtbar');
  // Erwähnen: «@» öffnet die Auswahl der IT, die Notiz zeigt die Erwähnung hervorgehoben
  const editor = page.locator('.composer .ProseMirror');
  await editor.click();
  await page.keyboard.type('Bitte @Iv');
  const popup = page.locator('.mention-popup');
  await popup.waitFor();
  await page.screenshot({ path: `${OUT}/41-erwaehnen-auswahl.png` });
  console.log('Bild 41-erwaehnen-auswahl');
  await page.keyboard.press('Enter');
  await page.keyboard.type('übernehmen');
  if (!(await editor.locator('.mention').count())) throw new Error('Erwähnung im Editor fehlt');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  const mentioned = page.locator('.timeline .message.note .mention').first();
  await mentioned.waitFor();
  if (!(await mentioned.innerText()).startsWith('@Ivan')) throw new Error(`Erwähnung im Verlauf: ${await mentioned.innerText()}`);
  await shot('37-aufgabe-intern-faellig', true);

  // Board-Karte: Fortschrittsbalken mit Zahl und überfällige Fälligkeit
  await page.goto(`${BASE}/tasks`);
  const card = page.locator('.board-card', { hasText: 'Neue Aufgabe aus der Spalte' });
  await card.waitFor();
  if ((await card.locator('.checklist-progress .count').innerText()).trim() !== '1/2') throw new Error('Fortschritt nicht «1/2»');
  // Der Balken füllt die Breite der Karte
  const [barWidth, cardWidth] = await card.evaluate((el) => [el.querySelector('.checklist-progress').getBoundingClientRect().width, el.clientWidth]);
  if (barWidth < cardWidth - 40) throw new Error(`Fortschrittsbalken ${Math.round(barWidth)} px bei Karte ${cardWidth} px`);
  // Alter oben ganz rechts, Fälligkeit unter dem Titel, Symbole unten bei Melder und Zuständig, Zeilen ohne Umbruch
  if (!(await card.locator('.card-due .due.due-overdue').count())) throw new Error('Fälligkeit nicht unter dem Titel oder nicht als überfällig');
  const [titleBottom, dueTop] = await card.evaluate((el) => [el.querySelector('.card-title').getBoundingClientRect().bottom, el.querySelector('.card-due').getBoundingClientRect().top]);
  if (dueTop < titleBottom) throw new Error('Fälligkeit nicht unter dem Titel');
  if (!/^(gerade eben|\d+ (Min\.|Std\.|Tage?))$/.test((await card.locator('.card-top .age').innerText()).trim())) throw new Error('Alter nicht oben auf der Karte');
  const ageGap = await card.locator('.card-top').evaluate((el) => el.getBoundingClientRect().right - el.querySelector('.age').getBoundingClientRect().right);
  if (Math.abs(ageGap) > 1) throw new Error(`Alter nicht ganz rechts (${Math.round(ageGap)} px Abstand)`);
  if (/gerade eben|\d+ (Min\.|Std\.|Tag)/.test(await card.locator('.card-foot').innerText())) throw new Error('Alter noch unten auf der Karte');
  if (!(await card.locator('.card-top .age').getAttribute('title')).startsWith('Erstellt am ')) throw new Error('Alter ohne Datum beim Darüberfahren');
  for (const row of ['.card-top', '.card-foot']) {
    const height = await card.locator(row).evaluate((el) => el.getBoundingClientRect().height);
    if (height > 28) throw new Error(`Karte: Zeile ${row} bricht um (${Math.round(height)} px)`);
  }
  // Engster Fall: schmales Fenster (Spalten 260 px) mit «Niedrig»; Nummer, Priorität und Alter (ganz rechts) bleiben auf
  // einer Zeile
  const cardNumber = Number((await card.locator('.card-top .number').innerText()).replace(/\D/g, ''));
  await api('PATCH', `/items/${cardNumber}`, { priority: 'low' });
  await page.setViewportSize({ width: 700, height: 950 });
  await page.reload();
  await card.locator('.card-top .prio-low').waitFor();
  const columnWidth = await page.locator('.column').first().evaluate((el) => el.getBoundingClientRect().width);
  if (columnWidth > 261) throw new Error(`Spalte im schmalen Fenster ${Math.round(columnWidth)} px statt 260 px`);
  const top = await card.locator('.card-top').evaluate((el) => {
    const rect = (sel) => el.querySelector(sel).getBoundingClientRect();
    const middle = (r) => r.top + r.height / 2;
    const [row, number, age, prio] = [el.getBoundingClientRect(), rect('.number'), rect('.age'), rect('.prio')];
    return {
      numberHeight: number.height,
      ageOffset: Math.abs(middle(age) - middle(number)),
      prioOffset: Math.abs(middle(prio) - middle(number)),
      prioBeforeAge: prio.right <= age.left,
      overflow: age.right - row.right,
    };
  });
  if (top.numberHeight > 20 || top.ageOffset > 3 || top.prioOffset > 3 || !top.prioBeforeAge || Math.abs(top.overflow) > 1) {
    throw new Error(`Schmale Karte: Nummer, Priorität und Alter nicht auf einer Zeile (${JSON.stringify(top)})`);
  }
  await card.screenshot({ path: `${OUT}/84-karte-schmal.png` });
  console.log('Bild 84-karte-schmal');
  await page.setViewportSize({ width: 1400, height: 950 });
  await api('PATCH', `/items/${cardNumber}`, { priority: 'normal' });
  await page.reload();
  await card.waitFor();
  // Kommentare: die Notiz mit der Erwähnung
  const comments = card.locator('.card-foot .meta-icon[title$="Kommentar"], .card-foot .meta-icon[title$="Kommentare"]');
  if ((await comments.innerText()).trim() !== '1') throw new Error(`Kommentare auf der Karte: ${await comments.innerText()}`);
  await card.screenshot({ path: `${OUT}/38-karte.png` });
  console.log('Bild 38-karte');
  // Beschreibung: Symbol mit Vorschau als Text (Aufgabe aus dem Smoke-Test)
  const described = page.locator('.board-card', { hasText: 'Erwähnen' }).first();
  const preview = await described.locator('.card-foot .meta-icon[aria-label="Hat eine Beschreibung"]').getAttribute('title');
  if (preview !== 'Ablauf Zuerst sichern') throw new Error(`Vorschau der Beschreibung: ${preview}`);
  await described.screenshot({ path: `${OUT}/42-karte-beschreibung.png` });
  console.log('Bild 42-karte-beschreibung');
  await shot('39-board-farben');
  await api('PUT', '/channels/defaults', { incident: null, task: null });
});

await step('liste-board', async () => {
  // Offene Störungen: Liste (Standard) oder Board, pro Benutzer auf dem Server gespeichert
  await page.goto(`${BASE}/incidents`);
  await page.locator('table.table').waitFor();
  const toggle = page.getByRole('group', { name: 'Ansicht', exact: true });
  await toggle.getByRole('button', { name: 'Board' }).click();
  await page.locator('.column').first().waitFor();
  await page.locator('.column', { hasText: 'letzte 14 Tage' }).first().waitFor();
  if (await page.locator('.list-filters select[aria-label="Status"]').count()) throw new Error('Status-Filter im Board der Störungen');
  await page.reload();
  await page.locator('.column').first().waitFor();
  if ((await api('GET', '/me/preferences')).data.layout.incidents !== 'board') throw new Error('Board der Störungen nicht gespeichert');
  // Innerhalb einer Spalte nach Priorität: keine «Niedrig» vor einer «Hoch»
  const prios = await page.locator('.column').first().locator('.board-card .card-top').allInnerTexts();
  const rank = (t) => (t.includes('Hoch') ? 0 : t.includes('Niedrig') ? 2 : 1);
  if (prios.some((t, i) => i > 0 && rank(t) < rank(prios[i - 1]))) throw new Error(`Störungen im Board nicht nach Priorität: ${prios.join(' | ')}`);
  await shot('60-stoerungen-board');
  await toggle.getByRole('button', { name: 'Liste' }).click();
  await page.locator('table.table').waitFor();
  // Gelöste: immer eine Liste, ohne Umschalter
  await page.goto(`${BASE}/incidents/resolved`);
  await page.locator('table.table').waitFor();
  if (await page.getByRole('group', { name: 'Ansicht', exact: true }).count()) throw new Error('Umschalter bei den gelösten Störungen');

  // Aufgaben: Board (Standard) oder Liste nach Status; Navigation «Offen | Erledigt | Abgelehnt»
  await page.goto(`${BASE}/tasks`);
  await page.locator('.column').first().waitFor();
  const nav = await page.locator('.page-head .segmented').first().innerText();
  if (!nav.startsWith('Offen')) throw new Error(`Navigation der Aufgaben: ${nav}`);
  await toggle.getByRole('button', { name: 'Liste' }).click();
  await page.locator('table.table').waitFor();
  await page.locator('.list-filters select[aria-label="Status"]').waitFor();
  await shot('61-aufgaben-liste');
  await toggle.getByRole('button', { name: 'Board' }).click();
  await page.locator('.column').first().waitFor();
});

await step('fenster', async () => {
  // Einstellungen im Benutzermenü: Standard überall «Fenster»; Störungen auf «Seite» umstellen
  await page.goto(`${BASE}/tasks`);
  await page.locator('.user-btn').click();
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.waitForURL(/\/settings$/);
  await page.getByRole('heading', { name: 'Vorgang öffnen als' }).waitFor();
  for (const area of ['Vorgänge im Eingang', 'Störungen', 'Aufgaben']) {
    const active = await page.getByRole('group', { name: area, exact: true }).locator('button.active').innerText();
    if (active.trim() !== 'Fenster') throw new Error(`Standard für «${area}»: ${active.trim()} statt Fenster`);
  }
  await page.getByRole('group', { name: 'Störungen', exact: true }).getByRole('button', { name: 'Seite' }).click();
  await page.locator('.toast', { hasText: 'Gespeichert' }).waitFor();
  await shot('62-einstellungen');

  // Klick auf eine Karte öffnet das Fenster über dem Board, die Adresse trägt den Vorgang
  await page.goto(`${BASE}/tasks`);
  const card = page.locator('.board-card').first();
  await card.waitFor();
  const ref = (await card.locator('.card-top .mono').innerText()).trim();
  await card.click();
  await page.waitForURL(/\/tasks\?item=PW-\d+$/);
  const dialog = page.locator('.dialog.huge');
  await dialog.locator('.timeline').waitFor();
  if (!(await dialog.locator('.head h2').innerText()).includes(ref)) throw new Error('Fenster zeigt einen anderen Vorgang');
  if (!(await page.locator('.column').count())) throw new Error('Board unter dem Fenster fehlt');
  await shot('63-vorgang-fenster');
  // Die Seite dahinter scrollt nicht mit, weder über dem Fenster noch daneben
  for (const [x, y] of [[700, 500], [5, 500]]) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);
  }
  const behind = await page.evaluate(() => window.scrollY);
  if (behind !== 0) throw new Error(`Seite hinter dem Fenster gescrollt: ${behind} px`);
  // «Zurück» im Browser schliesst das Fenster, das Board bleibt
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/tasks' && !url.search);
  await dialog.waitFor({ state: 'detached' });
  // Escape im Antwortfeld schliesst nicht (Entwurf), ausserhalb schon; ein Klick daneben auch nicht
  await card.click();
  await dialog.locator('.composer .ProseMirror').click();
  await page.keyboard.type('Entwurf');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);
  await page.waitForTimeout(300);
  if (!(await dialog.count())) throw new Error('Fenster durch Escape im Antwortfeld oder Klick daneben geschlossen');
  await dialog.locator('.head h2').click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // Neuladen öffnet es wieder; «Als Seite öffnen» wechselt zur Seite
  await card.click();
  await page.waitForURL(/item=/);
  await page.reload();
  await dialog.locator('.timeline').waitFor();
  await dialog.getByRole('link', { name: 'Als Seite öffnen' }).click();
  await page.waitForURL(/\/items\/PW-\d+$/);
  await page.locator('.timeline').waitFor();
  if (await page.locator('.dialog.huge').count()) throw new Error('Fenster nach «Als Seite öffnen» noch offen');
  // Die Einstellung gilt je Typ: Störungen öffnen jetzt als Seite
  await page.goto(`${BASE}/incidents`);
  await page.locator('table.table tbody tr').first().click();
  await page.waitForURL(/\/items\/PW-\d+$/);
  // Nach dem Schliessen scrollt die Seite wieder
  await page.goto(`${BASE}/tasks`);
  await card.click();
  await dialog.locator('.timeline').waitFor();
  await page.goBack();
  await dialog.waitFor({ state: 'detached' });
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.scrollY)) === 0) throw new Error('Seite scrollt nach dem Schliessen des Fensters nicht mehr');
  await api('PUT', '/me/preferences', { open: { incident: 'modal' } });
});

await step('testbetrieb-je-typ', async () => {
  // Drei Blöcke: Generell keine Mails, Störungen nur an ausgewählte IT, Aufgaben alle
  const circles = (staff, others, staffEmails = []) => ({ staff, others, staffEmails, otherEmails: [] });
  await api('PUT', '/settings/mail', {
    general: circles('none', 'none'),
    incident: circles('selected', 'none', ['ada@test.local']),
    task: circles('all', 'all'),
  });
  await page.goto(`${BASE}/admin/outgoing-mails`);
  const blocks = page.locator('section.block h3');
  await blocks.first().waitFor();
  const labels = (await blocks.allInnerTexts()).map((t) => t.trim());
  if (labels.join('|') !== 'Generell|Störungen|Aufgaben') throw new Error(`Blöcke: ${labels.join(', ')}`);
  if ((await page.locator('#tm-incident-staff').inputValue()) !== 'selected') throw new Error('Störungen nicht «nur an ausgewählte»');
  // Hinweis oben immer allgemein, die Übersicht je Block steht neben «Speichern»
  const banner = (await page.locator('.test-mode[role="status"]').innerText()).trim();
  if (!banner.startsWith('Testbetrieb: Es werden nicht alle Mails versendet.')) throw new Error(`Hinweis oben: ${banner}`);
  const summary = (await page.locator('.card', { has: page.locator('section.block') }).locator('.row .faint').innerText()).trim();
  if (summary !== 'Generell: keine Mails. Störungen: nur an ausgewählte IT-Mitarbeitende. Aufgaben: alle Mails.') {
    throw new Error(`Übersicht neben «Speichern»: ${summary}`);
  }
  await page.locator('.card', { has: page.locator('section.block') }).screenshot({ path: `${OUT}/87-testbetrieb-je-typ.png` });
  console.log('Bild 87-testbetrieb-je-typ');
  // Ändern über die Oberfläche: Generell an alle IT-Mitarbeitenden
  await page.locator('#tm-general-staff').selectOption('all');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.locator('.toast', { hasText: 'Testbetrieb gespeichert' }).waitFor();
  if ((await api('GET', '/settings/mail')).data.general.staff !== 'all') throw new Error('Generell nicht gespeichert');
  // Antwortfeld: Vermerk nach dem Block des Vorgangs (Störung ja, Aufgabe nein)
  const incident = (await api('GET', '/items?view=incidents')).data.items[0];
  await page.goto(`${BASE}/items/${incident.prefix}-${incident.number}`);
  await page.getByRole('button', { name: 'Öffentlich', exact: true }).click();
  await page.locator('.composer .test-mode').waitFor();
  const task = (await api('GET', '/items?view=tasks')).data.items[0];
  await page.goto(`${BASE}/items/${task.prefix}-${task.number}`);
  await page.getByRole('button', { name: 'Öffentlich', exact: true }).click();
  await page.locator('.composer .faint.small').first().waitFor();
  if (await page.locator('.composer .test-mode').count()) throw new Error('Vermerk zum Testbetrieb bei einer Aufgabe, obwohl Aufgaben an alle gehen');
  await api('PUT', '/settings/mail', { general: circles('all', 'all'), incident: circles('all', 'all'), task: circles('all', 'all') });
});

await step('simulieren', async () => {
  const none = { staff: 'none', others: 'none', staffEmails: [], otherEmails: [] };
  await api('PUT', '/settings/mail', { general: none, incident: none, task: none });
  await page.goto(`${BASE}/admin/outgoing-mails`);
  await page.locator('tbody tr.clickable').first().waitFor();
  await page.locator('tbody tr.clickable').first().click();
  // Ansicht wie versendet: Fusszeile klein mit Trennlinie (Formatierung der Vorlage bleibt)
  const footer = page.locator('.mail-html div[style*="border-top"]').last();
  await footer.waitFor();
  const footerSize = await footer.evaluate((el) => getComputedStyle(el).fontSize);
  if (footerSize !== '12px') throw new Error(`Fusszeile in der Ansicht ${footerSize} statt 12px`);
  await page.locator('.dialog').screenshot({ path: `${OUT}/29-ausgehende-mail.png` });
  console.log('Bild 29-ausgehende-mail');
  await page.getByRole('button', { name: 'Antwort simulieren' }).click();
  await page.locator('#sim-sender').waitFor();
  await shot('13-antwort-simulieren');
  await page.keyboard.press('Escape');

  // Aus einer echten Mail im Eingang: Originalmail → «Als simulierte Mail …», vorbelegt, als Antwort auf einen Vorgang
  const inbox = (await api('GET', '/items?view=inbox')).data.items.filter((i) => i.source === 'mail' && !i.discarded);
  const real = inbox[0];
  if (!real) throw new Error('Keine echte Mail im Eingang');
  await page.goto(`${BASE}/items/${real.prefix}-${real.number}`);
  await page.locator('section.original').getByRole('button', { name: 'Originalmail' }).click();
  await page.getByRole('button', { name: 'Als simulierte Mail …' }).click();
  await page.locator('#sim-subject').waitFor();
  if ((await page.locator('#sim-subject').inputValue()) !== real.title) throw new Error('Betreff nicht aus der echten Mail vorbelegt');
  if (!(await page.locator('#sim-address').inputValue())) throw new Error('Absender nicht vorbelegt');
  await page.fill('#sim-item', 'VPN');
  await page.locator('.dialog .result').first().click();
  await page.locator('.dialog .chosen').waitFor();
  if (!(await page.getByLabel(/Original verwerfen/).isChecked())) throw new Error('«Original verwerfen» nicht vorgewählt');
  await page.locator('.dialog').screenshot({ path: `${OUT}/43-als-simulierte-mail.png` });
  console.log('Bild 43-als-simulierte-mail');
  await page.locator('.dialog').getByRole('button', { name: 'Simulieren' }).click();
  await page.locator('.toast', { hasText: 'Simulierte Mail' }).waitFor();
  await page.locator('.badge', { hasText: 'Verworfen' }).waitFor();
  const live = { staff: 'all', others: 'all', staffEmails: [], otherEmails: [] };
  await api('PUT', '/settings/mail', { general: live, incident: live, task: live });
});

await step('helpspot-import', async () => {
  // Seite «HelpSpot-Import» mit den Daten aus dem Smoke-Test (nachgebauter HelpSpot, zwei übernommene Tickets)
  await page.goto(`${BASE}/admin/helpspot`);
  await page.getByRole('heading', { name: 'HelpSpot-Import', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Zuordnungen' }).waitFor();
  if ((await page.locator('tr[data-hs-type="Changes"] select').inputValue()) !== 'task') throw new Error('Changes nicht als Aufgabe zugeordnet');
  if (!(await page.locator('table.runs tbody tr').count())) throw new Error('Verlauf der Importe fehlt');
  if ((await page.locator('#hs-key').inputValue()) !== '') throw new Error('Schlüssel im Feld sichtbar');
  await shot('89-helpspot-import', true);
  // Übernommener Vorgang: Hinweis auf HelpSpot, Einträge «aus HelpSpot»
  await page.goto(`${BASE}/items/HS-12401`);
  await page.locator('.helpspot-origin').waitFor();
  if (!(await page.locator('.helpspot-origin').innerText()).includes('Problem Solved')) throw new Error('Status aus HelpSpot fehlt');
  await page.locator('.timeline .message', { hasText: 'Öffentlich · aus HelpSpot' }).first().waitFor();
  await page.locator('.timeline .message', { hasText: 'Intern · aus HelpSpot' }).first().waitFor();
  if (await page.locator('.timeline .message.note').getByRole('button', { name: 'Bearbeiten' }).count()) {
    throw new Error('Übernommene Notiz lässt sich bearbeiten');
  }
  await shot('90-helpspot-vorgang', true);
});

await step('auswertung', async () => {
  await page.goto(`${BASE}/reports`);
  await page.locator('canvas').first().waitFor();
  await page.waitForTimeout(1200);
  await shot('14-auswertung', true);
  // Ansichten: Kennzahlen und Karten je Störungen und Aufgaben, Wahl bleibt nach dem Neuladen
  const view = async (label, facts, card) => {
    await page.locator('.page-head .segmented').getByRole('button', { name: label, exact: true }).click();
    await page.locator('.fact').filter({ hasText: facts }).first().waitFor();
    await page.locator('h2').filter({ hasText: card }).first().waitFor();
    await page.waitForTimeout(1200);
  };
  await view('Störungen', 'Erste Antwort', 'Dauer bis «Gelöst» je Priorität');
  if (await page.locator('h2').filter({ hasText: 'Überfällige Aufgaben' }).count()) throw new Error('Störungen: Karte der Aufgaben sichtbar');
  await shot('72-auswertung-stoerungen', true);
  await view('Aufgaben', 'Durchlaufzeit', 'Überfällige Aufgaben');
  if (!(await page.locator('h2').filter({ hasText: 'nach Zuständigem (ohne «Backlog»)' }).count())) throw new Error('Aufgaben: Zuständige ohne Backlog fehlt');
  await shot('73-auswertung-aufgaben', true);
  await page.reload();
  await page.locator('.fact').filter({ hasText: 'Durchlaufzeit' }).first().waitFor();
  await view('Alle', 'Zeit bis zur Zuordnung', 'Neue und abgeschlossene Vorgänge');
});

await step('willkommen', async () => {
  // Neues IT-Konto: nach dem Speichern die Frage nach der Willkommens-Mail
  await page.goto(`${BASE}/admin/users`);
  await page.getByRole('button', { name: '+ Benutzer' }).click();
  if (await page.getByRole('button', { name: 'Lokales Konto' }).count()) await page.getByRole('button', { name: 'Lokales Konto' }).click();
  const email = `neu-${Date.now()}@test.local`;
  await page.fill('#u-name', 'Nora Neuling');
  await page.fill('#u-email', email);
  await page.selectOption('#u-role', 'it');
  await page.fill('#u-pass', 'neuling-passwort-1');
  await page.locator('.dialog').getByRole('button', { name: 'Speichern' }).click();
  const question = page.locator('.dialog', { hasText: 'Willkommens-Mail mit Link und Anmeldung' });
  await question.waitFor();
  await question.screenshot({ path: `${OUT}/54-frage-willkommen.png` });
  console.log('Bild 54-frage-willkommen');
  await question.getByRole('button', { name: 'Nicht senden' }).click();
  await question.waitFor({ state: 'detached' });
  // Knopf im Dialog des Benutzers
  await page.locator('tbody tr', { hasText: email }).click();
  const send = page.locator('.dialog').getByRole('button', { name: 'Willkommens-Mail senden' });
  await send.waitFor();
  await page.locator('.dialog').screenshot({ path: `${OUT}/55-benutzer-willkommen.png` });
  console.log('Bild 55-benutzer-willkommen');
  await send.click();
  await page.locator('.toast', { hasText: 'Willkommens-Mail' }).waitFor();
  await page.keyboard.press('Escape');
  // Ausgehende Mails: Art «Willkommen», ohne Vorgang
  await page.goto(`${BASE}/admin/outgoing-mails`);
  const row = page.locator('tbody tr', { hasText: email }).first();
  await row.waitFor();
  if (!(await row.innerText()).includes('Willkommen')) throw new Error('Art «Willkommen» fehlt in den ausgehenden Mails');
});

await step('bereiche', async () => {
  // Verwaltung → Benutzer: Karte «Bereiche der IT»
  await page.goto(`${BASE}/admin/users`);
  const card = page.locator('.card', { hasText: 'Bereiche der IT' });
  await card.waitFor();
  await card.screenshot({ path: `${OUT}/52-bereiche-der-it.png` });
  console.log('Bild 52-bereiche-der-it');
  // IT nur mit Aufgaben: Navigation, Startseite, gesperrter Vorgang, Typwahl beim Erfassen
  await api('PUT', '/settings/areas', { it: ['task'] });
  const ivan = (await api('GET', '/admin/users')).data.find((u) => u.role === 'it' && u.email.startsWith('ivan-'));
  const incident = (await api('GET', '/items?view=incidents')).data.items[0];
  await api('POST', '/auth/logout');
  await login(ivan.email, 'geheim-geheim');
  await page.waitForURL(/\/tasks$/).catch(() => {
    throw new Error(`Nach dem Anmelden auf ${page.url()} statt auf den Aufgaben`);
  });
  await page.locator('nav.tabs .tab').first().waitFor();
  const tabs = (await page.locator('nav.tabs .tab').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '').trim());
  if (tabs.join(',') !== 'Aufgaben') throw new Error(`Navigation: ${tabs.join(', ')}`);
  await page.goto(`${BASE}/inbox`);
  await page.waitForURL(/\/tasks$/);
  const before = problems.length;
  await page.goto(`${BASE}/items/${incident.prefix}-${incident.number}`);
  await page.locator('.empty', { hasText: 'gesperrt' }).waitFor();
  await shot('53-gesperrt');
  // Die Antwort 403 des gesperrten Vorgangs meldet der Browser in der Konsole; sie ist hier erwartet
  for (let i = problems.length - 1; i >= before; i--) if (problems[i].includes('status of 403')) problems.splice(i, 1);
  await api('POST', '/auth/logout');
  await login('ada@test.local', 'geheim-geheim');
  await api('PUT', '/settings/areas', { it: ['inbox', 'incident', 'task'] });
});

// Wirksames Farbschema (data-theme am <html>)
const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
// Pixel im Logo nahe dem hellen (#2f5bea, auch das Signet) bzw. dem dunklen Schriftzug (#6d8dff)
const logoColors = async (selector) => {
  const png = (await page.locator(selector).screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const near = (r, g, b) => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - r) + Math.abs(px[i + 1] - g) + Math.abs(px[i + 2] - b) < 12) n++;
      return n;
    };
    return { light: near(0x2f, 0x5b, 0xea), dark: near(0x6d, 0x8d, 0xff) };
  }, png);
};

await step('farbschema', async () => {
  // Einstellungen → Darstellung: Standard «Automatisch»; «Dunkel» gilt auch bei hellem System, überall und nach dem
  // Neuladen; «Hell» auch bei dunklem System; «Automatisch» folgt einem Wechsel des Systems sofort
  const group = page.getByRole('group', { name: 'Farbschema' });
  const choose = async (label) => {
    const toasts = await page.locator('.toast', { hasText: 'Gespeichert' }).count();
    await group.getByRole('button', { name: label, exact: true }).click();
    await page.locator('.toast', { hasText: 'Gespeichert' }).nth(toasts).waitFor();
  };
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Darstellung' }).waitFor();
  const active = (await group.locator('button.active').innerText()).trim();
  if (active !== 'Automatisch') throw new Error(`Standard: ${active}`);
  if ((await theme()) !== 'light') throw new Error('Automatisch bei hellem System nicht hell');
  await choose('Dunkel');
  if ((await theme()) !== 'dark') throw new Error('Dunkel nicht wirksam');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (background !== 'rgb(18, 21, 27)') throw new Error(`Hintergrund im dunklen Schema: ${background}`);
  await shot('74-einstellungen-dunkel');
  // Der Schriftzug im Logo folgt dem gewählten Schema, nicht dem System
  const dark = await logoColors('.header .brand img.full');
  if (dark.dark < 150) throw new Error(`Logo: Schriftzug nicht hell genug (${JSON.stringify(dark)})`);
  await page.locator('header.header').screenshot({ path: `${OUT}/75-logo-dunkel-gewaehlt.png` });
  console.log('Bild 75-logo-dunkel-gewaehlt');

  // Rundgang im dunklen Schema
  const pages = [
    ['/inbox', 'nav.tabs', '76-dunkel-eingang', false],
    ['/tasks', '.column', '77-dunkel-board', false],
    ['/items/PW-1', '.timeline', '78-dunkel-vorgang', true],
    ['/reports', 'canvas', '79-dunkel-auswertung', true],
    ['/admin/statuses', '.vue-flow__node', '80-dunkel-status', true],
  ];
  for (const [path, ready, name, full] of pages) {
    await page.goto(`${BASE}${path}`);
    await page.locator(ready).first().waitFor();
    if (path === '/reports') await page.waitForTimeout(1200);
    if ((await theme()) !== 'dark') throw new Error(`${path}: nicht dunkel`);
    await shot(name, full);
  }

  // Schon vor dem Start des Programms dunkel (Skript in index.html): Programm blockiert, Schema trotzdem gesetzt
  const before = problems.length;
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto(`${BASE}/inbox`);
  const early = await theme();
  await page.unroute('**/assets/*.js');
  if (early !== 'dark') throw new Error(`Vor dem Start: ${early}`);
  // Die blockierten Dateien meldet der Browser in der Konsole; das ist hier erwartet
  for (let i = problems.length - 1; i >= before; i--) if (problems[i].includes('Failed to load resource')) problems.splice(i, 1);

  // «Hell» gilt auch bei dunklem System, «Automatisch» folgt dem System
  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Darstellung' }).waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await choose('Hell');
  if ((await theme()) !== 'light') throw new Error('Hell bei dunklem System nicht hell');
  const light = await logoColors('.header .brand img.full');
  if (light.dark > 10) throw new Error(`Logo: Schriftzug im hellen Schema hell (${JSON.stringify(light)})`);
  await choose('Automatisch');
  if ((await theme()) !== 'dark') throw new Error('Automatisch bei dunklem System nicht dunkel');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
});

await step('portal', async () => {
  const anna = (await api('GET', '/admin/users')).data.find((u) => u.email.startsWith('anna-'));
  await api('POST', '/auth/logout');
  await page.goto(`${BASE}/login`);
  await page.locator('h1.brand img[src="/logo.svg"]').waitFor();
  await shot('71-anmeldung');
  await login(anna.email, 'anna-passwort-1');
  await page.goto(`${BASE}/portal/items/PW-1`);
  await page.locator('.timeline').waitFor();
  if (!(await page.locator('.portal-header .brand img[src="/logo.svg"]').isVisible())) throw new Error('Portal: Logo fehlt');
  await shot('15-portal', true);
  // Benutzermenü im Portal: Darstellung und Abmelden; «Dunkel» gilt sofort, im Konto gespeichert und danach auch auf
  // der Anmeldeseite (in diesem Browser gemerkt)
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.portal-header .user-btn').click();
  const group = page.getByRole('group', { name: 'Darstellung' });
  if ((await group.locator('button.active').innerText()).trim() !== 'Automatisch') throw new Error('Portal: Standard nicht Automatisch');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/preferences') && r.request().method() === 'PUT');
  await group.getByRole('button', { name: 'Dunkel', exact: true }).click();
  if ((await saved).status() !== 200) throw new Error('Portal: Farbschema nicht gespeichert');
  if ((await theme()) !== 'dark') throw new Error('Portal: Dunkel nicht wirksam');
  await shot('81-portal-dunkel');
  await page.locator('.portal-header .menu').getByRole('button', { name: 'Abmelden' }).click();
  await page.waitForURL(/\/login/);
  await page.locator('h1.brand img').waitFor();
  if ((await theme()) !== 'dark') throw new Error('Anmeldeseite: nicht dunkel');
  await shot('82-anmeldung-dunkel');
});

await browser.close();
console.log(problems.length ? `PROBLEME:\n${problems.join('\n')}` : 'Keine Probleme');
