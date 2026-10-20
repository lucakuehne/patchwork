import { itemRef } from './format';
import type { Entry } from './types';

/** Änderungen derselben Person, die höchstens so weit auseinanderliegen, erscheinen als eine Zeile. */
export const GROUP_GAP_MS = 2 * 60_000;

/** So lange nach dem Erfassen lässt sich eine eigene interne Notiz bearbeiten (wie im Backend). */
export const NOTE_EDIT_MINUTES = 5;

export type TimelineBlock = { kind: 'message'; entry: Entry } | { kind: 'events'; entries: Entry[] };

export interface EventPart {
  /** Satzteil ohne «hat», z.B. «den Status von «Neu» auf «In Arbeit» geändert» */
  text: string;
  link: { to: string; text: string } | null;
}

const isMessage = (e: Entry) => e.kind === 'reply' || e.kind === 'note';

/** Ablehnungen (mit Begründung), automatische Statuswechsel und Regeln stehen immer für sich. */
function groupable(e: Entry): boolean {
  if (isMessage(e)) return false;
  const m = e.meta ?? {};
  if (m.field === 'rule') return false;
  return !(e.kind === 'status' && (m.rejected || m.reason));
}

/**
 * Teilt die Einträge (neueste zuerst) in Nachrichten und Ereigniszeilen. Aufeinanderfolgende
 * Änderungen derselben Person kurz hintereinander (z.B. Status und Priorität) werden zusammengefasst.
 */
export function groupTimeline(newestFirst: Entry[]): TimelineBlock[] {
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
      (previous.author?.id ?? null) === (entry.author?.id ?? null) &&
      new Date(previous.createdAt).getTime() - new Date(entry.createdAt).getTime() <= GROUP_GAP_MS
    ) {
      (last as { entries: Entry[] }).entries.push(entry);
    } else {
      blocks.push({ kind: 'events', entries: [entry] });
    }
  }
  return blocks;
}

const q = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : `«${String(v)}»`);

/** Verweis auf einen anderen Vorgang (Verknüpfungen, Duplikat) */
function otherLink(e: Entry): EventPart['link'] {
  const m = e.meta ?? {};
  if (typeof m.otherNumber === 'number') {
    return { to: `/v/${m.otherNumber}`, text: `${itemRef(m.otherNumber)} «${String(m.otherTitle ?? '')}»` };
  }
  if (e.kind === 'status' && typeof m.duplicateOf === 'number') {
    return { to: `/v/${m.duplicateOf}`, text: `Original ${itemRef(m.duplicateOf)}` };
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

/** Beschreibung einer Status-, Typ- oder Feldänderung als Satzteil nach «hat». */
export function eventPart(e: Entry): EventPart {
  const m = e.meta ?? {};
  return { text: eventText(e, m), link: otherLink(e) };
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
      const checklists =
        m.checklists === 'hidden'
          ? ' – Checklisten ausgeblendet, sie bleiben gespeichert'
          : m.checklists === 'shown'
            ? ' – Checklisten wieder eingeblendet'
            : '';
      if (!m.from) return `den Typ ${q(m.to)} zugewiesen (Status ${q(m.toStatus)})${checklists}`;
      return `den Typ von ${q(m.from)} auf ${q(m.to)} geändert (Status ${q(m.fromStatus)} → ${q(m.toStatus)})${checklists}`;
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
            ? `${q(m.to)} als beteiligt hinzugefügt (aus Duplikat ${itemRef(Number(m.viaDuplicate))})`
            : `${q(m.to)} als beteiligt hinzugefügt`;
        case 'participantRemoved':
          return `${q(m.from)} als beteiligt entfernt`;
        case 'discarded':
          return 'den Vorgang verworfen';
        case 'restored':
          return 'den Vorgang wiederhergestellt';
        case 'waitingReminder':
          return `den Melder erinnert (wartet seit ${String(m.days)} Tagen)`;
      }
      return 'den Vorgang geändert';
  }
  return '';
}
