import { parseHelpSpotDate } from './helpspot-dates';
import { htmlToText } from './helpspot-text';

/** Anhang eines Eintrags in HelpSpot */
export interface HsFile {
  documentId: string;
  filename: string;
  mimeType: string;
  /** Content-ID eingebetteter Bilder («cid:…» im HTML), sonst null */
  cid: string | null;
}

/** Eintrag im Verlauf eines Tickets */
export interface HsHistoryItem {
  id: number;
  /** Name der Person (Melder, Mitarbeitende), leer bei HelpSpot selbst */
  person: string;
  /** «customer», «staff» oder «system» */
  personType: string;
  at: Date | null;
  public: boolean;
  html: boolean;
  /** Erste Nachricht (die Meldung selbst) */
  initial: boolean;
  /** Änderung am Ticket («Request Changed»), der Text beschreibt sie */
  change: boolean;
  note: string;
  files: HsFile[];
  /** Message-ID der eingegangenen Mail, falls der Eintrag aus einer Mail stammt */
  messageId: string | null;
}

export interface HsTicket {
  number: number;
  title: string;
  open: boolean;
  /** Name des Status, z.B. «Problem Solved» */
  status: string;
  urgent: boolean;
  /** «Eröffnet über», z.B. «Email» oder «Phone» */
  openedVia: string;
  /** Wert des Felds «Type» (Custom1), leer wenn nicht gesetzt */
  type: string;
  reporter: { email: string; firstName: string; lastName: string; phone: string };
  /** Name der zuständigen Person, leer ohne Zuweisung */
  assignedTo: string;
  trash: boolean;
  spam: boolean;
  /** Geschlossen am (laut HelpSpot nur das Datum) */
  closedAt: Date | null;
  history: HsHistoryItem[];
}

type Raw = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const flag = (value: unknown) => String(value) === '1' || value === true;

/** Werte eines Objekts oder Arrays aus dem JSON von HelpSpot (Listen kommen teils als Objekt mit IDs als Schlüssel) */
function valuesOf(value: unknown): Raw[] {
  if (Array.isArray(value)) return value.filter((v): v is Raw => !!v && typeof v === 'object');
  if (value && typeof value === 'object') return Object.values(value).flatMap((v) => (Array.isArray(v) ? valuesOf(v) : v && typeof v === 'object' ? [v as Raw] : []));
  return [];
}

function filesOf(value: unknown): HsFile[] {
  const files: HsFile[] = [];
  const visit = (node: unknown) => {
    for (const item of valuesOf(node)) {
      if (item.xDocumentId !== undefined) {
        files.push({
          documentId: text(item.xDocumentId),
          filename: text(item.sFilename) || 'Anhang',
          mimeType: text(item.sFileMimeType) || 'application/octet-stream',
          cid: text(item.sCID).replace(/^<|>$/g, '') || null,
        });
      } else visit(item);
    }
  };
  visit(value);
  return files;
}

/** Message-ID aus den gespeicherten Kopfzeilen (serialisiertes PHP-Array) einer eingegangenen Mail */
export function messageIdFromHeaders(headers: unknown): string | null {
  const match = /"message-id";s:\d+:"([^"]*)"/i.exec(text(headers));
  const id = match?.[1]?.trim();
  return id ? (id.startsWith('<') ? id : `<${id}>`) : null;
}

/**
 * HTML ohne Kennzeichen: Die Protokolle von HelpSpot («Request Changed») kommen als HTML mit fNoteIsHTML = 0, z.B.
 * «<div class="note-stream-item-logtext">Request Changed:</div>…», Fehlermeldungen mit «&quot;» oder «<br />».
 * Erkennbar an einem Tag ganz am Anfang, an «<br>» oder an Entitäten; Adressen wie «<anna@firma.ch>» zählen nicht.
 */
export const unflaggedHtml = (value: string) =>
  /^\s*<(div|p|span|br|table|ul|ol|font|html|body)\b/i.test(value) || /<br\s*\/?>/i.test(value) || /&(quot|amp|lt|gt|nbsp|#\d+);/.test(value);

const withoutTags = (value: string) => value.replace(/<[^>]*>/g, '').trim();

/** Ticket aus der Antwort von private.request.get, Verlauf nach Reihenfolge der Einträge */
export function normalizeTicket(raw: Raw, timeZone = 'Europe/Zurich'): HsTicket {
  const history = valuesOf((raw.request_history as Raw | undefined)?.item ?? raw.request_history)
    .map((item): HsHistoryItem => {
      const log = text(item.tLog);
      const note = text(item.tNote);
      const change = withoutTags(log).startsWith('Request Changed') || withoutTags(note).startsWith('Request Changed');
      const html = flag(item.fNoteIsHTML);
      return {
        id: Number(item.xRequestHistory),
        person: text(item.xPerson),
        personType: text(item.person_type) || 'system',
        at: parseHelpSpotDate(item.dtGMTChange, timeZone),
        public: flag(item.fPublic),
        html,
        initial: flag(item.fInitial),
        change,
        // HTML ohne Kennzeichen gleich als Text; mit Kennzeichen bleibt es HTML (Ansicht wie die Mail)
        note: !html && unflaggedHtml(note) ? htmlToText(note) : note,
        files: filesOf(item.files),
        messageId: messageIdFromHeaders(item.tEmailHeaders),
      };
    })
    .filter((item) => Number.isInteger(item.id))
    .sort((a, b) => a.id - b.id);
  const status = text(raw.xStatus);
  return {
    number: Number(raw.xRequest),
    title: text(raw.sTitle).trim(),
    open: flag(raw.fOpen),
    status,
    urgent: flag(raw.fUrgent),
    openedVia: text(raw.fOpenedVia),
    type: text(raw.Custom1).trim(),
    reporter: {
      email: text(raw.sEmail).trim().toLowerCase(),
      firstName: text(raw.sFirstName).trim(),
      lastName: text(raw.sLastName).trim(),
      phone: text(raw.sPhone).trim(),
    },
    assignedTo: text(raw.xPersonAssignedTo).trim(),
    trash: flag(raw.fTrash),
    spam: /^spam$/i.test(status),
    closedAt: parseHelpSpotDate(raw.dtGMTClosed, timeZone),
    history,
  };
}

/** Schlüssel der Zuordnung eines Status: Typ in Patchwork, Status in HelpSpot und offen/geschlossen */
export const statusKey = (type: string, status: string, open: boolean) => `${type}|${status}|${open ? 'open' : 'closed'}`;
