import { describe, expect, it } from 'vitest';
import { messageIdFromHeaders, normalizeTicket, statusKey } from './helpspot-ticket';

// Aufbau wie die Antwort von private.request.get (Beispieldaten)
const raw = {
  xRequest: 18200,
  fOpenedVia: 'Email',
  xPersonAssignedTo: 'Ivan Informatik',
  fOpen: 0,
  xStatus: 'Problem Solved',
  fUrgent: 1,
  dtGMTOpened: '22. Oct 2026',
  dtGMTClosed: '22. Oct 2026',
  fTrash: 0,
  sTitle: ' Drucker druckt nicht ',
  sFirstName: 'Anna',
  sLastName: 'Muster',
  sEmail: 'Anna.Muster@Firma.ch',
  sPhone: '',
  Custom1: 'Incident',
  request_history: {
    item: {
      '35792': { xRequestHistory: 35792, xPerson: 'Ivan Informatik', person_type: 'staff', dtGMTChange: '22. Oct 2026, 08:33 Uhr', fPublic: 1, fNoteIsHTML: 1, fInitial: 0, tLog: '', tNote: '<p>Bitte neu starten</p>' },
      '35790': {
        xRequestHistory: 35790,
        xPerson: 'Anna Muster',
        person_type: 'customer',
        dtGMTChange: '22. Oct 2026, 08:14 Uhr',
        fPublic: 1,
        fNoteIsHTML: 1,
        fInitial: 1,
        tLog: '',
        tNote: '<p>Drucker im 2. OG</p>',
        tEmailHeaders: 'a:2:{s:7:"subject";s:3:"abc";s:10:"message-id";s:21:"<abc@mail.example.ch>";}',
        files: { file: [{ sCID: '', sFilename: 'Fehler.png', xDocumentId: 9001, sFileMimeType: 'image/png', public_url: '', private_url: '' }] },
      },
      '35793': { xRequestHistory: 35793, xPerson: 'Ivan Informatik', person_type: 'staff', dtGMTChange: '22. Oct 2026, 08:33 Uhr', fPublic: 0, fNoteIsHTML: 0, fInitial: 0, tLog: 'Request Changed:', tNote: 'Status von Active zu Problem Solved' },
    },
  },
};

describe('Ticket aus HelpSpot', () => {
  it('übernimmt die Angaben des Tickets', () => {
    const t = normalizeTicket(raw);
    expect(t).toMatchObject({
      number: 18200,
      title: 'Drucker druckt nicht',
      open: false,
      status: 'Problem Solved',
      urgent: true,
      openedVia: 'Email',
      type: 'Incident',
      reporter: { email: 'anna.muster@firma.ch', firstName: 'Anna', lastName: 'Muster', phone: '' },
      assignedTo: 'Ivan Informatik',
      trash: false,
      spam: false,
    });
    expect(t.closedAt?.toISOString()).toBe('2026-10-21T22:00:00.000Z');
  });

  it('Verlauf nach Reihenfolge, mit Art, Zeit, Anhängen und Message-ID der ersten Mail', () => {
    const [first, reply, change] = normalizeTicket(raw).history;
    expect(first).toMatchObject({ id: 35790, initial: true, public: true, html: true, personType: 'customer', messageId: '<abc@mail.example.ch>' });
    expect(first!.at?.toISOString()).toBe('2026-10-22T06:14:00.000Z');
    expect(first!.files).toEqual([{ documentId: '9001', filename: 'Fehler.png', mimeType: 'image/png', cid: null }]);
    expect(reply).toMatchObject({ id: 35792, public: true, change: false, person: 'Ivan Informatik', personType: 'staff' });
    expect(change).toMatchObject({ id: 35793, change: true, public: false, note: 'Status von Active zu Problem Solved' });
  });

  it('HTML ohne Kennzeichen (Protokolle, Fehlermeldungen) gleich als Text', () => {
    const logHtml =
      '<div class="note-stream-item-logtext">Request Changed:</div><div class="note-stream-item-logtext">Request changed from &quot;CLOSED&quot; to &quot;OPEN&quot;</div>';
    const history = (tLog: string, tNote: string, fNoteIsHTML = 0) =>
      normalizeTicket({
        ...raw,
        request_history: { item: { '1': { xRequestHistory: 1, person_type: 'staff', fPublic: 0, fNoteIsHTML, fInitial: 0, tLog, tNote } } },
      }).history[0];
    const asText = { change: true, html: false, note: 'Request Changed:\nRequest changed from "CLOSED" to "OPEN"' };
    expect(history('Request Changed:', logHtml)).toMatchObject(asText);
    expect(history(logHtml, logHtml)).toMatchObject(asText);
    expect(history('', logHtml)).toMatchObject(asText);
    expect(history('', 'EMAIL ERROR: got code &quot;503&quot;<br />Bitte prüfen')).toMatchObject({
      change: false,
      note: 'EMAIL ERROR: got code "503"\nBitte prüfen',
    });
    // Gewöhnlicher Text mit «<» mitten im Satz oder einer Adresse in spitzen Klammern bleibt, wie er ist
    expect(history('', 'Wert ist <5 und >2')).toMatchObject({ change: false, html: false, note: 'Wert ist <5 und >2' });
    expect(history('', 'Von: Anna <anna@firma.ch>')).toMatchObject({ note: 'Von: Anna <anna@firma.ch>' });
    // Mit Kennzeichen bleibt es HTML
    expect(history('', '<p>Hallo</p>', 1)).toMatchObject({ html: true, note: '<p>Hallo</p>' });
  });

  it('erkennt Spam und Papierkorb', () => {
    expect(normalizeTicket({ ...raw, xStatus: 'SPAM' }).spam).toBe(true);
    expect(normalizeTicket({ ...raw, fTrash: 1 }).trash).toBe(true);
  });

  it('Message-ID auch ohne spitze Klammern, sonst null', () => {
    expect(messageIdFromHeaders('s:10:"message-id";s:5:"a@b.c"')).toBe('<a@b.c>');
    expect(messageIdFromHeaders('')).toBeNull();
  });

  it('Schlüssel der Status-Zuordnung', () => {
    expect(statusKey('incident', 'Problem Solved', false)).toBe('incident|Problem Solved|closed');
  });
});
