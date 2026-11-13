import { describe, expect, it } from 'vitest';
import { errorText, explainMailError } from './mail-errors';

const mailbox = { address: 'helpdesk@firma.ch', oauthAccount: 'admin@firma.onmicrosoft.com' };

describe('explainMailError', () => {
  it('erklärt abgeschaltetes IMAP und den nötigen Vollzugriff eines anderen Kontos', () => {
    const text = explainMailError('User is authenticated but not connected.', mailbox);
    expect(text).toContain('keine IMAP-Verbindung zu helpdesk@firma.ch');
    expect(text).toContain('E-Mail-Apps verwalten → IMAP');
    expect(text).toContain('admin@firma.onmicrosoft.com nicht das Konto dieses Postfachs, braucht es zudem Vollzugriff');
    const own = explainMailError('User is authenticated but not connected.', { ...mailbox, oauthAccount: 'helpdesk@firma.ch' });
    expect(own).toContain('IMAP für das Postfach abgeschaltet');
    expect(own).not.toContain('Vollzugriff');
  });

  it('erklärt gesperrtes SMTP AUTH', () => {
    const text = explainMailError(
      'Invalid login: 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.',
      mailbox,
    );
    expect(text).toContain('«Authentifiziertes SMTP» für dieses Postfach erlauben');
  });

  it('lässt andere Meldungen unverändert', () => {
    expect(explainMailError('Connection timed out', mailbox)).toBe('Connection timed out');
  });
});

describe('Fehlermeldung', () => {
  it('nie leer: Sammelfehler von IPv4 und IPv6 mit den einzelnen Meldungen', () => {
    const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}:1`), { code: 'ECONNREFUSED' });
    const aggregate = Object.assign(new AggregateError([refused('::1'), refused('127.0.0.1')], ''), { code: 'ECONNREFUSED' });
    expect(errorText(aggregate)).toBe('connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127.0.0.1:1');
    expect(errorText(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
    expect(errorText(new Error('Anmeldung fehlgeschlagen'))).toBe('Anmeldung fehlgeschlagen');
    expect(errorText(undefined)).toBe('Unbekannter Fehler');
  });
});
