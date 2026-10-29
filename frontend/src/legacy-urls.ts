import type { LocationQuery } from 'vue-router';
import { itemRef, parseItemRef } from './item-ref';

/**
 * Frühere deutsche Adressen der Oberfläche (bis 28.10.2026). Lesezeichen und Links in bereits versendeten Mails führen
 * auf die englischen Adressen weiter (Entscheid vom 28.10.2026).
 */
const PATHS: Record<string, string> = {
  '/eingang': '/inbox',
  '/stoerungen': '/incidents',
  '/stoerungen/geloest': '/incidents/resolved',
  '/aufgaben': '/tasks',
  '/aufgaben/erledigt': '/tasks/done',
  '/aufgaben/abgelehnt': '/tasks/rejected',
  '/suche': '/search',
  '/einstellungen': '/settings',
  '/einrichtung': '/setup',
  '/auswertungen': '/reports',
  '/portal/neu': '/portal/new',
  '/admin/allgemein': '/admin/general',
  '/admin/benutzer': '/admin/users',
  '/admin/postfaecher': '/admin/mailboxes',
  '/admin/ausgehende-mails': '/admin/outgoing-mails',
  '/admin/eingehende-mails': '/admin/incoming-mails',
  '/admin/e-mail-vorlagen': '/admin/mail-templates',
  '/admin/status': '/admin/statuses',
  '/admin/meldewege': '/admin/channels',
  '/admin/checklisten': '/admin/checklist-templates',
  '/admin/textbausteine': '/admin/snippets',
  '/admin/regeln': '/admin/rules',
};

/**
 * Vorgang als Seite: früher «/v/123» bzw. im Portal «/portal/v/123», bis 29.10.2026 «/items/123» ohne Präfix. Neu
 * steht immer die volle Kennung in der Adresse («/items/PW-123»).
 */
const ITEM_PATHS: [RegExp, string][] = [
  [/^\/v\/([^/]+)$/, '/items/'],
  [/^\/portal\/v\/([^/]+)$/, '/portal/items/'],
  [/^\/items\/([^/]+)$/, '/items/'],
  [/^\/portal\/items\/([^/]+)$/, '/portal/items/'],
];

/** Kennung in der Schreibweise der Adresse («PW-123»), sonst der Wert unverändert */
const canonicalRef = (value: string) => {
  const key = parseItemRef(value);
  return key ? itemRef(key) : value;
};

const KEYS: Record<string, string> = { vorgang: 'item', weiter: 'next', ergebnis: 'result', herkunft: 'origin' };

/** Werte der Filter je (englischem) Parameter */
const VALUES: Record<string, Record<string, string>> = {
  status: { alle: 'all', 'nicht-versendet': 'withheld', fehler: 'failed', versendet: 'sent' },
  result: { alle: 'all', neu: 'created', antworten: 'replies', ignoriert: 'ignored', fehler: 'failed' },
  origin: { alle: 'all', echt: 'real', simuliert: 'simulated' },
  microsoft: { fehler: 'failed' },
};

function translatePath(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (PATHS[trimmed]) return PATHS[trimmed];
  for (const [pattern, prefix] of ITEM_PATHS) {
    const ref = trimmed.match(pattern)?.[1];
    if (ref) return `${prefix}${canonicalRef(decodeURIComponent(ref))}`;
  }
  return path;
}

function translateQuery(query: LocationQuery): LocationQuery {
  const result: LocationQuery = {};
  for (const [key, value] of Object.entries(query)) {
    const name = KEYS[key] ?? key;
    const values = VALUES[name];
    if (name === 'item' && typeof value === 'string') result[name] = canonicalRef(value);
    else result[name] = values && typeof value === 'string' ? (values[value] ?? value) : value;
  }
  return result;
}

/**
 * Neue Adresse zu einer früheren deutschen (Pfad, Parameter oder Werte der Filter), null wenn nichts zu ändern ist.
 * Die frühere Seite «/admin/nicht-versendet» zeigt die nicht versendeten Mails.
 */
export function legacyLocation(path: string, query: LocationQuery): { path: string; query: LocationQuery } | null {
  if (path.replace(/\/+$/, '') === '/admin/nicht-versendet') {
    return { path: '/admin/outgoing-mails', query: { ...translateQuery(query), status: 'withheld' } };
  }
  const newPath = translatePath(path);
  const newQuery = translateQuery(query);
  if (newPath === path && JSON.stringify(newQuery) === JSON.stringify(query)) return null;
  return { path: newPath, query: newQuery };
}
