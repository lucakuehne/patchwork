import { describe, expect, it } from 'vitest';
import {
  AD_USER_FILTER,
  directoryNames,
  escapeFilterValue,
  loginAttributes,
  mailFilter,
  parseLdapUrl,
  peopleFilter,
} from './ldap.service';

describe('parseLdapUrl', () => {
  it('liest Host, Port und TLS', () => {
    expect(parseLdapUrl('ldaps://dc01.firma.local')).toEqual({ host: 'dc01.firma.local', port: 636, tls: true });
    expect(parseLdapUrl('ldap://dc01.firma.local')).toEqual({ host: 'dc01.firma.local', port: 389, tls: false });
    expect(parseLdapUrl(' ldap://10.0.0.5:3389 ')).toEqual({ host: '10.0.0.5', port: 3389, tls: false });
  });

  it('lehnt andere Protokolle und Unsinn ab', () => {
    expect(() => parseLdapUrl('http://x')).toThrow(/ldap:\/\//);
    expect(() => parseLdapUrl('dc01')).toThrow(/Ungültige/);
  });
});

describe('escapeFilterValue', () => {
  it('maskiert Sonderzeichen gemäss RFC 4515', () => {
    expect(escapeFilterValue('a*b(c)d\\e')).toBe('a\\2ab\\28c\\29d\\5ce');
    expect(escapeFilterValue('lena')).toBe('lena');
  });
});

describe('Personensuche im Verzeichnis', () => {
  const ad = { userFilter: AD_USER_FILTER, nameAttribute: 'displayName', mailAttribute: 'mail' };
  const openLdap = {
    userFilter: '(&(objectClass=inetOrgPerson)(|(uid={{username}})(mail={{username}})))',
    nameAttribute: 'displayName',
    mailAttribute: 'mail',
  };

  it('liest die Anmelde-Attribute aus dem Benutzerfilter', () => {
    expect(loginAttributes(AD_USER_FILTER)).toEqual(['sAMAccountName', 'userPrincipalName', 'mail']);
    expect(loginAttributes(openLdap.userFilter)).toEqual(['uid', 'mail']);
  });

  it('sucht jedes Wort in Name, E-Mail und Anmeldename, nur Konten mit E-Mail', () => {
    expect(peopleFilter(openLdap, ['lena', 'li*'], false)).toBe(
      '(&(&(objectClass=inetOrgPerson)(|(uid=*)(mail=*)))(mail=*)' +
        '(|(displayName=*lena*)(mail=*lena*)(uid=*lena*))' +
        '(|(displayName=*li\\2a*)(mail=*li\\2a*)(uid=*li\\2a*)))',
    );
  });

  it('lässt bei Active Directory deaktivierte Konten weg', () => {
    const filter = peopleFilter(ad, ['kühne'], true);
    expect(filter).toContain('(!(userAccountControl:1.2.840.113556.1.4.803:=2))');
    expect(filter).toContain('(sAMAccountName=*kühne*)');
    expect(filter).toContain('(sAMAccountName=*)');
  });
});

describe('Konto zu einer E-Mail-Adresse', () => {
  it('sucht die Adresse unter allen Konten des Benutzerfilters, maskiert', () => {
    const openLdap = { userFilter: '(&(objectClass=inetOrgPerson)(uid={{username}}))', mailAttribute: 'mail' };
    expect(mailFilter(openLdap, ' lena*@test.local ', false)).toBe(
      '(&(&(objectClass=inetOrgPerson)(uid=*))(mail=lena\\2a@test.local))',
    );
  });

  it('nimmt bei Active Directory nur aktive Konten', () => {
    expect(mailFilter({ userFilter: AD_USER_FILTER, mailAttribute: 'mail' }, 'lena@test.local', true)).toMatch(
      /\(mail=lena@test\.local\)\(!\(userAccountControl:1\.2\.840\.113556\.1\.4\.803:=2\)\)\)$/,
    );
  });
});

describe('Vor- und Nachname aus dem Verzeichnis', () => {
  const email = 'lena.lind@test.local';

  it('nimmt givenName und sn', () => {
    expect(directoryNames({ givenName: ' Lena ', sn: 'Lind', name: 'Lind, Lena (IT)', email })).toEqual({
      firstName: 'Lena',
      lastName: 'Lind',
    });
  });

  it('übernimmt auch nur einen der beiden Werte', () => {
    expect(directoryNames({ givenName: '', sn: 'Helpdesk', name: 'IT Helpdesk', email })).toEqual({
      firstName: '',
      lastName: 'Helpdesk',
    });
  });

  it('schätzt ohne givenName und sn aus dem Namen', () => {
    expect(directoryNames({ givenName: '', sn: ' ', name: 'Muster, Anna', email })).toEqual({
      firstName: 'Anna',
      lastName: 'Muster',
    });
  });

  it('schätzt ohne Namen aus der E-Mail-Adresse', () => {
    expect(directoryNames({ givenName: '', sn: '', name: ' ', email })).toEqual({ firstName: 'Lena', lastName: 'Lind' });
  });
});
