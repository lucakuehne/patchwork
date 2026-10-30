import { itemRef } from './format';
import { DEFAULT_PREFIX } from './item-ref';
import type { Entry, ItemMail, ItemType } from './types';

/** Änderungen derselben Person, die höchstens so weit auseinanderliegen, erscheinen als eine Zeile. */
export const GROUP_GAP_MS = 2 * 60_000;

/** So lange nach dem Erfassen lässt sich eine eigene interne Notiz bearbeiten (wie im Backend). */
export const NOTE_EDIT_MINUTES = 3;

export type TimelineBlock =
  | { kind: 'message'; entry: Entry }
  | { kind: 'events'; entries: Entry[] }
  | { kind: 'mail'; mail: ItemMail };

export interface EventPart {
  /** Satzteil ohne «hat», z.B. «den Status von «Neu» auf «In Arbeit» geändert» */
  text: string;
  /**
   * Verweis auf einen anderen Vorgang. «type»: sein Typ für «als Seite oder Fenster öffnen» (undefined = unbekannt);
   * «hidden»: ausserhalb der eigenen Bereiche, nur die Nummer ohne Link.
   */
  link: { prefix: string; number: number; type?: ItemType | null; hidden: boolean; text: string } | null;
}

const isMessage = (e: Entry) => e.kind === 'reply' || e.kind === 'note';

/** Aus HelpSpot übernommener Eintrag; solche Änderungen stehen nie mit Änderungen in Patchwork in einer Karte */
export const fromHelpSpot = (e: Entry) => e.meta?.source === 'helpspot';

/** Ablehnungen (mit Begründung), automatische Statuswechsel und Regeln stehen immer für sich. */
function groupable(e: Entry): boolean {
  if (isMessage(e)) return false;
  const m = e.meta ?? {};
  if (m.field === 'rule') return false;
  return !(e.kind === 'status' && (m.rejected || m.reason));
}

/** Felder mit Von/Nach, die bei mehrfacher Änderung in einer Karte nur einmal erscheinen */
const MERGED_FIELDS = ['title', 'description', 'priority', 'channel', 'assignee', 'reporter', 'mailbox', 'dueDate'];

/**
 * Welches Feld ändert der Eintrag? null = wird nicht zusammengelegt (Beteiligte, Verknüpfungen, Duplikat …).
 * Checklisten-Punkte je Punkt: abgehakt und wieder zurückgenommen fällt weg.
 */
function mergeKey(e: Entry): string | null {
  const m = e.meta ?? {};
  if (e.kind === 'status') return m.duplicateOf ? null : 'status';
  if (e.kind === 'type') return 'type';
  if (e.kind === 'change' && m.field === 'checklistItem') return `checklistItem:${String(m.itemId)}`;
  if (e.kind === 'change' && typeof m.field === 'string' && MERGED_FIELDS.includes(m.field)) return m.field;
  return null;
}

/**
 * Status und Typ einer Karte als eine Kette (neueste zuerst; der Typwechsel ändert auch den Status): eine Zeile vom
 * ersten zum letzten Typ samt Status, bei gleichem Typ eine Statuszeile, ohne Änderung keine.
 */
function mergeStatusChain(chain: Entry[]): Entry | null {
  const newest = chain[0]!;
  const oldest = chain.at(-1)!;
  const types = chain.filter((e) => e.kind === 'type');
  const m = (e: Entry) => e.meta ?? {};
  const firstStatus = oldest.kind === 'type' ? m(oldest).fromStatus : m(oldest).from;
  const lastStatus = newest.kind === 'type' ? m(newest).toStatus : m(newest).to;
  const firstType = m(types.at(-1)!).from;
  const lastType = m(types[0]!).to;
  if (firstType !== lastType) {
    return { ...newest, kind: 'type', meta: { ...m(types[0]!), from: firstType, to: lastType, fromStatus: firstStatus, toStatus: lastStatus } };
  }
  return firstStatus !== lastStatus ? { ...newest, kind: 'status', meta: { from: firstStatus, to: lastStatus } } : null;
}

/**
 * Mehrfache Änderungen desselben Feldes in einer Karte (neueste zuerst) erscheinen einmal: vom ersten zum letzten Wert,
 * mit der Zeit der letzten Änderung. Steht am Ende wieder der Ausgangswert, entfällt die Zeile. Mit einem Typwechsel
 * in der Karte bilden Status und Typ eine Kette (siehe mergeStatusChain).
 */
export function mergeRepeats(newestFirst: Entry[]): Entry[] {
  const withType = newestFirst.some((e) => mergeKey(e) === 'type');
  const keyOf = (e: Entry) => {
    const key = mergeKey(e);
    return withType && (key === 'status' || key === 'type') ? 'chain' : key;
  };
  const result: Entry[] = [];
  const seen = new Set<string>();
  for (const entry of newestFirst) {
    const key = keyOf(entry);
    if (!key) {
      result.push(entry);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const same = newestFirst.filter((e) => keyOf(e) === key);
    if (same.length === 1) {
      result.push(entry);
      continue;
    }
    if (key === 'chain') {
      const merged = mergeStatusChain(same);
      if (merged) result.push(merged);
      continue;
    }
    const meta: Record<string, unknown> = { ...entry.meta, from: (same.at(-1)!.meta ?? {}).from };
    // «Beschreibung geändert» hat keine Werte: einmal zeigen
    if (key === 'description' || meta.from !== meta.to) result.push({ ...entry, meta });
  }
  return result;
}

/**
 * Teilt die Einträge (neueste zuerst) in Nachrichten und Ereigniszeilen. Aufeinanderfolgende
 * Änderungen derselben Person kurz hintereinander (z.B. Status und Priorität) werden zusammengefasst,
 * mehrfache Änderungen desselben Feldes darin zu einer (siehe mergeRepeats). Automatische Mails stehen als eigene
 * Zeilen nach ihrer Zeit dazwischen, ohne zusammengefasste Änderungen zu trennen.
 */
export function groupTimeline(newestFirst: Entry[], mails: ItemMail[] = []): TimelineBlock[] {
  return withMails(groupEntries(newestFirst), mails);
}

/** Zeitpunkt eines Blocks: der neueste Eintrag */
function blockTime(block: TimelineBlock): number {
  if (block.kind === 'mail') return new Date(block.mail.createdAt).getTime();
  return new Date(block.kind === 'message' ? block.entry.createdAt : block.entries[0]!.createdAt).getTime();
}

/** Mails nach ihrer Zeit zwischen die Blöcke (neueste zuerst) einreihen; bei gleicher Zeit die Mail zuerst. */
function withMails(blocks: TimelineBlock[], mails: ItemMail[]): TimelineBlock[] {
  const pending: TimelineBlock[] = [...mails]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((mail) => ({ kind: 'mail', mail }));
  const result: TimelineBlock[] = [];
  for (const block of blocks) {
    while (pending.length && blockTime(pending[0]!) >= blockTime(block)) result.push(pending.shift()!);
    result.push(block);
  }
  return [...result, ...pending];
}

/** Empfänger einer Mail im Verlauf, z.B. «an Anna Muster, CC Carla Rossi»; ohne Benutzer die Adresse. */
export function mailRecipientsText(mail: Pick<ItemMail, 'to' | 'cc'>): string {
  const name = (r: ItemMail['to'][number]) => r.name || r.email;
  const parts = [...mail.to.map(name), ...mail.cc.map((r) => `CC ${name(r)}`)];
  return parts.length ? `an ${parts.join(', ')}` : '';
}

function groupEntries(newestFirst: Entry[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const entry of newestFirst) {
    if (isMessage(entry)) {
      blocks.push({ kind: 'message', entry });
      continue;
    }
    const last = blocks.at(-1);
    const previous = last?.kind === 'events' ? last.entries.at(-1) : undefined;
    if (
      previous &&
      groupable(previous) &&
      groupable(entry) &&
      authorKey(previous) === authorKey(entry) &&
      fromHelpSpot(previous) === fromHelpSpot(entry) &&
      new Date(previous.createdAt).getTime() - new Date(entry.createdAt).getTime() <= GROUP_GAP_MS
    ) {
      (last as { entries: Entry[] }).entries.push(entry);
    } else {
      blocks.push({ kind: 'events', entries: [entry] });
    }
  }
  return blocks.flatMap((block) => {
    if (block.kind !== 'events' || block.entries.length < 2) return [block];
    const entries = mergeRepeats(block.entries);
    return entries.length ? [{ kind: 'events' as const, entries }] : [];
  });
}

const q = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : `«${String(v)}»`);

/** Typ des verwiesenen Vorgangs laut Server («refType», null = Eingang); fehlt er, ist er unbekannt */
const refType = (value: unknown): ItemType | null | undefined =>
  value === null || value === 'incident' || value === 'task' ? value : undefined;

/**
 * Name des Autors: Benutzer in Patchwork oder, bei aus HelpSpot übernommenen Einträgen ohne Konto, der Name aus HelpSpot;
 * null = System
 */
export function authorName(e: Entry): string | null {
  return e.author?.name ?? (typeof e.meta?.authorName === 'string' ? e.meta.authorName : null);
}

const authorKey = (e: Entry) => e.author?.id ?? (typeof e.meta?.authorName === 'string' ? `name:${e.meta.authorName}` : null);

/** Präfix eines gespeicherten Verweises; ältere Einträge ohne Präfix verweisen auf PW */
const prefixOf = (value: unknown) => (typeof value === 'string' && value ? value : DEFAULT_PREFIX);

/** Verweis auf einen anderen Vorgang (Verknüpfungen, Duplikat); gesperrte («refHidden») nur mit Kennung, ohne Link */
function otherLink(e: Entry): EventPart['link'] {
  const m = e.meta ?? {};
  const hidden = m.refHidden === true;
  const type = refType(m.refType);
  if (typeof m.otherNumber === 'number') {
    const key = { prefix: prefixOf(m.otherPrefix), number: m.otherNumber };
    const text = hidden ? itemRef(key) : `${itemRef(key)} «${String(m.otherTitle ?? '')}»`;
    return { ...key, type, hidden, text };
  }
  if (e.kind === 'status' && typeof m.duplicateOf === 'number') {
    const key = { prefix: prefixOf(m.duplicateOfPrefix), number: m.duplicateOf };
    return { ...key, type, hidden, text: `Original ${itemRef(key)}` };
  }
  return null;
}

/** Automatischer Statuswechsel (nach einer Antwort bzw. ohne Rückmeldung): ganzer Satz ohne handelnde Person. */
export function automaticStatusText(e: Entry): string | null {
  const m = e.meta ?? {};
  if (e.kind !== 'status') return null;
  if (m.reason === 'reply') {
    return `Status automatisch von ${q(m.from)} auf ${q(m.to)} gesetzt (Antwort ${m.via === 'portal' ? 'im Portal' : 'per Mail'})`;
  }
  if (m.reason === 'waitingTimeout') {
    return `Status automatisch von ${q(m.from)} auf ${q(m.to)} gesetzt (keine Rückmeldung seit ${String(m.days)} Tagen)`;
  }
  return null;
}

/** Satzteil als Listenpunkt: ohne einleitenden Artikel und gross geschrieben, z.B. «Status von «Neu» auf «In Arbeit» geändert». */
export function asListItem(text: string): string {
  const stripped = text.replace(/^(den|die|das|dem|der|eine|einen|ein)\s+/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Was es nur bei Aufgaben gibt und beim Typwechsel aus- bzw. wieder eingeblendet wurde */
function typeOnlyParts(m: Record<string, unknown>, state: 'hidden' | 'shown'): string[] {
  return [m.checklists === state && 'Checklisten', m.dueDate === state && 'Fälligkeitsdatum'].filter((p): p is string => !!p);
}

/** Beschreibung einer Status-, Typ- oder Feldänderung als Satzteil nach «hat». */
export function eventPart(e: Entry): EventPart {
  const m = e.meta ?? {};
  return { text: eventText(e, m), link: otherLink(e) };
}

/**
 * Zeilen eines Eintrags in der Liste einer Karte. Eine aus HelpSpot übernommene Änderung hat je Änderung eine Zeile im
 * Wortlaut von HelpSpot; dass sie aus HelpSpot kommt, steht im Kopf der Karte (Entscheid vom 30.10.2026).
 */
export function eventParts(e: Entry): EventPart[] {
  const m = e.meta ?? {};
  if (e.kind !== 'change' || m.field !== 'helpspot') return [eventPart(e)];
  const lines = String(m.text ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.length ? lines : ['in HelpSpot geändert']).map((text) => ({ text, link: null }));
}

function eventText(e: Entry, m: Record<string, unknown>): string {
  switch (e.kind) {
    case 'status':
      if (m.rejected) return `abgelehnt${m.notified ? ' (Melder informiert)' : ''}`;
      if (m.duplicateOf) {
        return `als Duplikat geschlossen (Status ${q(m.to)}, ${m.merged ? 'Meldung ins Original übernommen' : 'Melder als Beteiligter umgeleitet'}):`;
      }
      return `den Status von ${q(m.from)} auf ${q(m.to)} geändert`;
    case 'type': {
      const hidden = typeOnlyParts(m, 'hidden');
      const shown = typeOnlyParts(m, 'shown');
      const note = hidden.length
        ? ` – ${hidden.join(' und ')} ausgeblendet, ${hidden.length > 1 || hidden[0] === 'Checklisten' ? 'sie bleiben' : 'es bleibt'} gespeichert`
        : shown.length
          ? ` – ${shown.join(' und ')} wieder eingeblendet`
          : '';
      if (!m.from) return `den Typ ${q(m.to)} zugewiesen (Status ${q(m.toStatus)})${note}`;
      return `den Typ von ${q(m.from)} auf ${q(m.to)} geändert (Status ${q(m.fromStatus)} → ${q(m.toStatus)})${note}`;
    }
    case 'change':
      switch (m.field) {
        case 'linkAdded':
          return `verknüpft: ${m.roleLabel}`;
        case 'linkRemoved':
          return `eine Verknüpfung entfernt: ${m.roleLabel}`;
        case 'fixCompleted':
          return 'den behebenden Vorgang erledigt:';
        case 'title':
          return `den Titel von ${q(m.from)} auf ${q(m.to)} geändert`;
        case 'description':
          return 'die Beschreibung geändert';
        case 'priority':
          return `die Priorität von ${q(m.from)} auf ${q(m.to)} geändert`;
        case 'channel':
          return m.from ? `den Meldeweg von ${q(m.from)} auf ${q(m.to)} geändert` : `den Meldeweg ${q(m.to)} eingetragen`;
        case 'assignee':
          return m.to ? `${q(m.to)} als zuständig gesetzt` : `die Zuständigkeit von ${q(m.from)} entfernt`;
        case 'reporter':
          return `den Melder von ${q(m.from)} auf ${q(m.to)} geändert`;
        case 'mailbox':
          return `das Antwort-Postfach von ${q(m.from)} auf ${q(m.to)} geändert`;
        case 'participantAdded':
          return m.viaDuplicate
            ? `${q(m.to)} als beteiligt hinzugefügt (aus Duplikat ${itemRef({ prefix: prefixOf(m.viaDuplicatePrefix), number: Number(m.viaDuplicate) })})`
            : `${q(m.to)} als beteiligt hinzugefügt`;
        case 'participantRemoved':
          return `${q(m.from)} als beteiligt entfernt`;
        case 'discarded':
          return 'den Vorgang verworfen';
        case 'restored':
          return 'den Vorgang wiederhergestellt';
        case 'waitingReminder':
          return `den Melder erinnert (wartet seit ${String(m.days)} Tagen)`;
        case 'dueDate':
          if (!m.to) return `das Fälligkeitsdatum ${q(m.from)} entfernt`;
          return m.from ? `das Fälligkeitsdatum von ${q(m.from)} auf ${q(m.to)} geändert` : `das Fälligkeitsdatum ${q(m.to)} gesetzt`;
        case 'checklistItem':
          return m.to ? `den Punkt ${q(m.text)} abgehakt` : `den Haken bei ${q(m.text)} entfernt`;
        case 'helpspot':
          // Aus HelpSpot übernommene Änderung: der Text von HelpSpot, mehrere Zeilen in einer
          return `in HelpSpot geändert: ${String(m.text ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean).join('; ')}`;
      }
      return 'den Vorgang geändert';
  }
  return '';
}
