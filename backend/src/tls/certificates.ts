// @peculiar/x509 braucht Reflect-Metadaten (tsyringe); im Server lädt sie main.ts schon
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { createPrivateKey, webcrypto, X509Certificate } from 'node:crypto';

x509.cryptoProvider.set(webcrypto as never);

/** Fehler mit einer Meldung für die Verwaltung. */
export class CertificateError extends Error {}

/** Angaben zu einem Zertifikat für die Anzeige. */
export interface CertificateInfo {
  /** DNS-Namen (SAN), sonst der CN */
  names: string[];
  issuer: string;
  validFrom: string;
  validTo: string;
}

/** Hostname wie patchwork.firma.local, ohne Wildcard und ohne Port. */
export const DNS_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** RSA 2048 mit SHA-256: nehmen auch Vorlagen für ältere Kryptografieanbieter an (z.B. «Webserver» der AD CS). */
const RSA: webcrypto.RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const ANY_USAGE = '2.5.29.37.0';

function toPem(der: Buffer, label: string): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** Neuer Schlüssel und Zertifikatsanforderung (PKCS#10). Der erste Name wird der CN, alle stehen im SAN. */
export async function createRequest(names: string[]): Promise<{ keyPem: string; csrPem: string }> {
  const keys = (await webcrypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${names[0]}`,
    keys,
    signingAlgorithm: RSA,
    extensions: [new x509.SubjectAlternativeNameExtension(names.map((value) => ({ type: 'dns' as const, value })))],
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  return { keyPem: toPem(pkcs8, 'PRIVATE KEY'), csrPem: `${csr.toString('pem')}\n` };
}

/** Ein DER-Block: einzelnes Zertifikat oder PKCS#7 mit Zertifikaten (z.B. .p7b oder Antwort der CA). */
function fromDer(der: Buffer): X509Certificate[] {
  try {
    return [new X509Certificate(der)];
  } catch {
    // kein einzelnes Zertifikat
  }
  try {
    return Array.from(new x509.X509Certificates(der), (cert) => new X509Certificate(Buffer.from(cert.rawData)));
  } catch {
    return [];
  }
}

/**
 * Zertifikate aus einer hochgeladenen Datei: PEM (auch mehrere hintereinander), DER oder PKCS#7.
 * Die Webseite der Microsoft-CA liefert Ketten (.p7b) auch mit «BEGIN CERTIFICATE»; auch das geht.
 */
export function parseCertificates(data: Buffer): X509Certificate[] {
  const text = data.toString('latin1');
  const blocks = [...text.matchAll(/-----BEGIN [A-Z0-9 ]+-----([\s\S]+?)-----END [A-Z0-9 ]+-----/g)].map((m) =>
    Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64'),
  );
  const base64Only = /^[A-Za-z0-9+/=\s]+$/.test(text) && text.trim().length > 0;
  const ders = blocks.length > 0 ? blocks : [base64Only ? Buffer.from(text.replace(/\s+/g, ''), 'base64') : data];
  const certs = ders.flatMap(fromDer);
  if (certs.length === 0) {
    throw new CertificateError(
      'Die Datei enthält kein lesbares Zertifikat. Erwartet wird ein Zertifikat (.cer, .crt, .pem; Base64 oder DER) oder eine Kette (.p7b).',
    );
  }
  return certs;
}

const commonName = (dn: string) => dn.match(/CN=([^\n,]+)/)?.[1] ?? dn.replace(/\n/g, ', ');

export function describeCertificate(cert: X509Certificate): CertificateInfo {
  const dns = (cert.subjectAltName ?? '')
    .split(/,\s*/)
    .filter((name) => name.startsWith('DNS:'))
    .map((name) => name.slice(4));
  return {
    names: dns.length > 0 ? dns : [commonName(cert.subject)],
    issuer: commonName(cert.issuer),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
  };
}

/** Ganze Tage bis zum Ablauf, negativ wenn abgelaufen. */
export function daysLeft(validTo: string, now = new Date()): number {
  return Math.floor((new Date(validTo).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function matchesKey(cert: X509Certificate, keyPem: string): boolean {
  try {
    return cert.checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

/**
 * Das zum Schlüssel passende Zertifikat samt Zwischenzertifikaten aus der Datei, als PEM für den Webserver.
 * Die Wurzel (selbst signiert) kennen die Clients bereits, sie wird nicht mitgeschickt. null = passt nicht.
 */
export function certificateForKey(certs: X509Certificate[], keyPem: string): { leaf: X509Certificate; pem: string } | null {
  const leaf = certs.find((cert) => matchesKey(cert, keyPem));
  if (!leaf) return null;
  const chain = [leaf];
  for (let current = leaf; ; ) {
    const issuer = certs.find((c) => !chain.includes(c) && current.checkIssued(c) && !c.checkIssued(c));
    if (!issuer) break;
    chain.push(issuer);
    current = issuer;
  }
  return { leaf, pem: chain.map((c) => c.toString().trim()).join('\n') + '\n' };
}

/** Prüft, ob das Zertifikat jetzt gültig und für einen Webserver ausgestellt ist. */
export function assertUsable(cert: X509Certificate, now = new Date()): void {
  const info = describeCertificate(cert);
  const date = (iso: string) => new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
  if (new Date(info.validTo) <= now) throw new CertificateError(`Das Zertifikat ist abgelaufen (gültig bis ${date(info.validTo)}).`);
  if (new Date(info.validFrom) > now) throw new CertificateError(`Das Zertifikat ist erst ab ${date(info.validFrom)} gültig.`);
  const usages = cert.keyUsage;
  if (usages && !usages.includes(SERVER_AUTH) && !usages.includes(ANY_USAGE)) {
    throw new CertificateError(
      'Das Zertifikat ist nicht für Webserver ausgestellt (ohne Serverauthentifizierung). Bitte eine Vorlage für Webserver verwenden.',
    );
  }
}
