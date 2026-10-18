import { describe, expect, it } from 'vitest';
import {
  adDataCode,
  domainFromDn,
  explainBindError,
  explainSearchError,
  explainTlsError,
  isWithin,
  windowsServerVersion,
} from './ldap-errors';

// Fehlerobjekte wie von ldapts (code = LDAP-Ergebniscode, message = Meldung des Servers + Zusatz)
const ldapError = (code: number, message: string) => Object.assign(new Error(`${message}  Code: 0x${code.toString(16)}`), { code });

describe('explainBindError', () => {
  it('erklärt die Signierungs-Pflicht von Active Directory (Code 8)', () => {
    const err = ldapError(
      8,
      '00002028: LdapErr: DSID-0C09035A, comment: The server requires binds to turn on integrity checking if SSL\\TLS are not already active on the connection, data 0, v65f4',
    );
    const result = explainBindError(err, { isAd: true, encrypted: false });
    expect(result.message).toMatch(/signierte oder verschlüsselte Verbindung/);
    expect(result.message).toMatch(/STARTTLS/);
    expect(result.detail).toMatch(/^00002028: LdapErr/);
    expect(result.detail).not.toMatch(/Code: 0x8/);
  });

  it.each([
    ['52e', /Passwort ist falsch/],
    ['525', /nicht gefunden/],
    ['532', /Passwort ist abgelaufen/],
    ['533', /deaktiviert/],
    ['701', /Konto ist abgelaufen/],
    ['773', /geändert werden/],
    ['775', /gesperrt/],
  ])('übersetzt AD-Code %s', (code, expected) => {
    const err = ldapError(49, `80090308: LdapErr: DSID-0C090559, comment: AcceptSecurityContext error, data ${code}, v65f4`);
    expect(explainBindError(err, { isAd: true, encrypted: true }).message).toMatch(expected);
  });

  it('nennt bei falschen Anmeldedaten im AD die möglichen Schreibweisen', () => {
    const err = ldapError(49, '80090308: LdapErr: DSID-0C090559, comment: AcceptSecurityContext error, data 52e, v65f4');
    expect(explainBindError(err, { isAd: true, encrypted: true }).message).toMatch(/benutzer@domäne/);
    expect(explainBindError(err, { isAd: false, encrypted: true }).message).not.toMatch(/benutzer@domäne/);
  });

  it('erklärt Netzwerkfehler', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND dc'), { code: 'ENOTFOUND' });
    expect(explainBindError(err, { isAd: false, encrypted: false }).message).toMatch(/DNS/);
  });
});

describe('explainTlsError', () => {
  it('erkennt einen Domain Controller ohne Zertifikat (STARTTLS)', () => {
    const err = ldapError(52, '00000000: LdapErr: DSID-0C0916CA, comment: Error initializing SSL/TLS, data 0, v65f4');
    expect(explainTlsError(err).message).toMatch(/kein Zertifikat/);
  });

  it('erkennt einen Domain Controller ohne Zertifikat (LDAPS)', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(explainTlsError(err).message).toMatch(/kein Zertifikat/);
  });

  it('erklärt nicht vertrauenswürdige Zertifikate mit Hinweis auf das CA-Zertifikat', () => {
    const err = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(explainTlsError(err).message).toMatch(/CA-Zertifikat/);
  });
});

describe('explainSearchError', () => {
  it('erkennt die in AD verbotene anonyme Suche', () => {
    const err = ldapError(
      1,
      '000004DC: LdapErr: DSID-0C090D10, comment: In order to perform this operation a successful bind must be completed on the connection., data 0, v65f4',
    );
    expect(explainSearchError(err, { isAd: true }).message).toMatch(/anonyme Suche/);
  });

  it('meldet fehlende Einträge', () => {
    expect(explainSearchError(ldapError(32, '0000208D: NameErr'), { isAd: true }).message).toMatch(/existiert nicht/);
  });
});

describe('Hilfsfunktionen', () => {
  it('liest AD-Codes, Windows-Version, Domäne und DN-Beziehungen', () => {
    expect(adDataCode('AcceptSecurityContext error, data 52e, v65f4')).toBe('52e');
    expect(adDataCode('ohne Code')).toBeNull();
    expect(windowsServerVersion('10')).toBe('Windows Server 2025');
    expect(windowsServerVersion('7')).toBe('Windows Server 2016–2022');
    expect(domainFromDn('DC=iwssolar,DC=local')).toBe('iwssolar.local');
    expect(isWithin('OU=Benutzer, DC=iwssolar,DC=local', 'dc=iwssolar,dc=local')).toBe(true);
    expect(isWithin('dc=test,dc=local', 'DC=iwssolar,DC=local')).toBe(false);
  });
});
