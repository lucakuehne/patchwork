// Gemeinsame Teile des Smoke-Tests: Importe, Konstanten, Hilfsfunktionen und Zustand. test/smoke.mjs lädt die Bereiche
// (test/smoke/NN-*.mjs) der Reihe nach; was spätere Bereiche brauchen (z.B. die Nummer des ersten Vorgangs), steht in
// «state».
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import https from 'node:https';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

export { assert, https, ImapFlow, simpleParser, webcrypto, x509 };


export const BASE = (process.argv[2] ?? 'http://localhost:8080') + '/api';
// HTTPS der Instanz (HTTPS_PORT, Standard 8443)
export const HTTPS_PORT = Number(process.env.SMOKE_HTTPS_PORT ?? 8443);
// Eindeutige Adressen pro Lauf: Andere Instanzen, die denselben GreenMail-Server abfragen, stören so nicht
export const RUN = Date.now().toString(36);
export const MAILBOX = `helpdesk-${RUN}@test.local`;
export const ANNA = `anna-${RUN}@test.local`;
export const BOB = `bob-${RUN}@test.local`;
export const IVAN = `ivan-${RUN}@test.local`;
export const CARLA = `carla-${RUN}@test.local`;
export const BERTA = `berta-${RUN}@test.local`;
export const FREMD = `fremd-${RUN}@test.local`;
export const NEWS = `news-${RUN}@shop.test`;


/** Sitzungs-Cookie der aktuellen Anmeldung (live, für fetch mit Anmeldung in den Bereichen) */
export let cookie = '';
/** Sitzung wechseln, z.B. zwischen zwei angemeldeten Benutzern ('' = ohne Anmeldung) */
export const setSessionCookie = (value) => {
  cookie = value;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, path, body, { expect = [200, 201, 204], raw = false } = {}) {
  const headers = { 'x-patchwork': '1' };
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  const data = text && !raw ? JSON.parse(text) : text;
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return data;
}

export const smtp = nodemailer.createTransport({ host: 'localhost', port: 13025, secure: false, ignoreTLS: true });

export async function sendMail(opts) {
  const info = await smtp.sendMail({ to: MAILBOX, ...opts });
  return info.messageId;
}

/** Liest alle Mails eines GreenMail-Kontos. */
export async function inbox(user) {
  const client = new ImapFlow({ host: 'localhost', port: 13143, secure: false, auth: { user, pass: 'x' }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const mails = [];
  try {
    if (client.mailbox.exists > 0) {
      for await (const msg of client.fetch('1:*', { envelope: true, source: true, headers: ['auto-submitted', 'in-reply-to'] })) {
        mails.push({
          subject: msg.envelope.subject,
          to: msg.envelope.to?.map((a) => a.address) ?? [],
          cc: msg.envelope.cc?.map((a) => a.address) ?? [],
          messageId: msg.envelope.messageId,
          headers: msg.headers?.toString() ?? '',
          source: msg.source?.toString() ?? '',
          // dekodierter Text (Quoted-Printable kann Wörter umbrechen)
          text: msg.source ? ((await simpleParser(msg.source)).text ?? '') : '',
        });
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return mails;
}

export async function waitForMail(user, predicate, label) {
  for (let i = 0; i < 30; i++) {
    const found = (await inbox(user)).find(predicate);
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(`Mail nicht erhalten: ${label} (${user})`);
}


/** Fehlgeschlagene Schritte; die übrigen laufen weiter, am Ende steht die Zusammenfassung (Entscheid vom 26.10.2026) */
const failures = [];

export async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    console.log('ok');
  } catch (err) {
    failures.push(name);
    const detail = (err instanceof Error ? (err.stack ?? err.message) : String(err)).split('\n').slice(0, 8);
    console.log(`FEHLER\n  ${detail.join('\n  ')}`);
  }
}

/** Zusammenfassung am Ende: Exit-Code 1, wenn ein Schritt fehlgeschlagen ist */
export function finish() {
  smtp.close();
  if (failures.length === 0) {
    console.log('\nAlle Prüfungen bestanden.');
    return;
  }
  console.log(`\n${failures.length} Schritte fehlgeschlagen:\n${failures.map((name) => `- ${name}`).join('\n')}`);
  process.exitCode = 1;
}

/** Zustand für spätere Bereiche: mailboxId, ivan, itemNo, statuses, channels usw. */
export const state = {};
export const status = (type, key) => state.statuses.find((s) => s.type === type && s.key === key);
export const channel = (label) => state.channels.find((c) => c.label === label);
export const poll = () => api('POST', `/admin/mailboxes/${state.mailboxId}/poll`);
export const detail = (n) => api('GET', `/items/${n}`);
export const loginAs = async (username, password) => {
  await api('POST', '/auth/logout');
  return api('POST', '/auth/login', { username, password });
};
export const createItem = async (fields, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ channelId: channel('Telefon').id, ...fields })) f.append(k, v);
  for (const [name, content] of files) f.append('files', new Blob([content]), name);
  return (await api('POST', '/items', f)).number;
};

export const inboxNumber = async (title) => (await api('GET', '/items?view=inbox')).items.find((i) => i.title === title).number;
export const LIEFERANT = `verkauf@lieferant-${RUN}.test`;
export const STUMM = `stumm-${RUN}@test.local`;
export const GEWINN = `gewinn-${RUN}@test.local`;
export const cond = (field, operator, value) => ({ kind: 'condition', field, operator, value });
export const group = (op, ...children) => ({ kind: 'group', op, children });
export const byTitle = async (title) => {
  const lists = await Promise.all(['inbox', 'incidents', 'board'].map((v) => api('GET', `/items?view=${v}`)));
  return lists.flatMap((l) => l.items).find((i) => i.title === title);
};
export const EXTERN = `extern-${RUN}@test.local`;
export const ARCHIV = `archiv-${RUN}@test.local`;
export const archivMailbox = (fetchFrom) => ({
  name: 'Archiv',
  address: ARCHIV,
  active: true,
  isDefault: false,
  imapHost: 'localhost',
  imapPort: 13143,
  imapSecure: false,
  imapFolder: 'INBOX',
  smtpHost: 'localhost',
  smtpPort: 13025,
  smtpSecurity: 'none',
  authType: 'password',
  username: ARCHIV,
  password: 'x',
  ...(fetchFrom ? { fetchFrom } : {}),
});
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
export const uploadImage = (name, data = PNG) => {
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'image/png' }), name);
  return api('POST', '/uploads/images', form, { expect: [201, 400] });
};
export const reply = async (path, body, kind) => {
  const form = new FormData();
  if (kind) form.append('kind', kind);
  form.append('body', body);
  await api('POST', path, form);
};
export const entryStartingWith = async (n, start) => (await detail(n)).entries.find((e) => e.body.startsWith(start));
export const simulation = (fields, files = []) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [name, content] of files) form.append('files', new Blob([content]), name);
  return form;
};
