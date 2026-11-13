import { describe, expect, it } from 'vitest';
import { GraphError } from './graph-mail.service';
import { isPermanentSendError } from './send-errors';

/** Fehler, wie nodemailer ihn meldet */
const smtp = (fields: { responseCode?: number; command?: string; code?: string }) => Object.assign(new Error('SMTP'), fields);

describe('Fehler beim Versand: dauerhaft oder vorübergehend', () => {
  it('dauerhaft: Server lehnt genau diese Mail ab (Empfänger, Inhalt)', () => {
    expect(isPermanentSendError(smtp({ responseCode: 550, command: 'RCPT TO', code: 'EENVELOPE' }))).toBe(true);
    expect(isPermanentSendError(smtp({ responseCode: 552, command: 'DATA', code: 'EMESSAGE' }))).toBe(true);
    expect(isPermanentSendError(new GraphError(400, 'ErrorInvalidRecipients', 'Ungültiger Empfänger', 'it@firma.ch'))).toBe(true);
    expect(isPermanentSendError(new GraphError(413, 'ErrorMessageSizeExceeded', 'Zu gross', 'it@firma.ch'))).toBe(true);
  });

  it('vorübergehend: Verbindung, Anmeldung, Absender, 4xx, Graph-Rechte und Serverfehler', () => {
    expect(isPermanentSendError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:25'), { code: 'ESOCKET' }))).toBe(false);
    expect(isPermanentSendError(smtp({ code: 'ETIMEDOUT', command: 'CONN' }))).toBe(false);
    expect(isPermanentSendError(smtp({ responseCode: 535, command: 'AUTH LOGIN', code: 'EAUTH' }))).toBe(false);
    expect(isPermanentSendError(smtp({ responseCode: 550, command: 'MAIL FROM', code: 'EENVELOPE' }))).toBe(false);
    expect(isPermanentSendError(smtp({ responseCode: 451, command: 'RCPT TO', code: 'EENVELOPE' }))).toBe(false);
    for (const status of [401, 403, 404, 429, 500, 503]) {
      expect(isPermanentSendError(new GraphError(status, 'Fehler', '', 'it@firma.ch'))).toBe(false);
    }
  });
});
