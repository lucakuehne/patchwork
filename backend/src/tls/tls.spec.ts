import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto, X509Certificate } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config';
import {
  assertUsable,
  certificateForKey,
  CertificateError,
  createRequest,
  daysLeft,
  describeCertificate,
  parseCertificates,
} from './certificates';
import { TlsService } from './tls.service';

// ---- Kleine Zertifizierungsstelle für die Tests: signiert wie eine AD CS mit der Vorlage «Webserver» ----

x509.cryptoProvider.set(webcrypto as never);
const ALG: webcrypto.RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};
const DAY = 24 * 60 * 60 * 1000;
let serial = 1;

interface TestCa {
  keys: webcrypto.CryptoKeyPair;
  cert: x509.X509Certificate;
}

async function issue(subject: string, publicKey: unknown, signer: webcrypto.CryptoKeyPair, issuer: string, extensions: x509.Extension[], from: number, to: number) {
  return x509.X509CertificateGenerator.create({
    serialNumber: (serial++).toString(16).padStart(2, '0'),
    subject,
    issuer,
    notBefore: new Date(Date.now() + from * DAY),
    notAfter: new Date(Date.now() + to * DAY),
    publicKey: publicKey as never,
    signingKey: signer.privateKey as never,
    signingAlgorithm: ALG,
    extensions,
  });
}

async function createCa(name: string, parent?: TestCa): Promise<TestCa> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const ca = new x509.BasicConstraintsExtension(true, undefined, true);
  const cert = await issue(`CN=${name}`, keys.publicKey, parent?.keys ?? keys, parent?.cert.subject ?? `CN=${name}`, [ca], -2, 3650);
  return { keys, cert };
}

async function sign(ca: TestCa, csrPem: string, options: { from?: number; to?: number; usages?: string[] | null } = {}) {
  const csr = new x509.Pkcs10CertificateRequest(csrPem);
  const san = csr.extensions.filter((e) => e instanceof x509.SubjectAlternativeNameExtension);
  const usages = options.usages === undefined ? [x509.ExtendedKeyUsage.serverAuth] : options.usages;
  const eku = usages ? [new x509.ExtendedKeyUsageExtension(usages)] : [];
  return issue(csr.subject, csr.publicKey, ca.keys, ca.cert.subject, [...san, ...eku], options.from ?? -1, options.to ?? 730);
}

const pem = (cert: x509.X509Certificate) => `${cert.toString('pem')}\n`;
const node = (cert: x509.X509Certificate) => new X509Certificate(Buffer.from(cert.rawData));

let root: TestCa;
beforeEach(async () => {
  root ??= await createCa('Test-Root');
});

describe('Zertifikatsanforderung', () => {
  it('erzeugt Schlüssel und CSR mit dem ersten Namen als CN und allen Namen im SAN', async () => {
    const { keyPem, csrPem } = await createRequest(['patchwork.firma.local', 'patchwork']);
    expect(keyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    const csr = new x509.Pkcs10CertificateRequest(csrPem);
    expect(csr.subject).toBe('CN=patchwork.firma.local');
    expect(await csr.verify()).toBe(true);
    const san = csr.extensions.find((e) => e instanceof x509.SubjectAlternativeNameExtension) as x509.SubjectAlternativeNameExtension;
    expect(san.names.toJSON()).toEqual([
      { type: 'dns', value: 'patchwork.firma.local' },
      { type: 'dns', value: 'patchwork' },
    ]);
    // Das von der CA signierte Zertifikat passt zum Schlüssel
    const cert = node(await sign(root, csrPem));
    expect(certificateForKey([cert], keyPem)?.leaf).toBe(cert);
    expect(describeCertificate(cert)).toMatchObject({ names: ['patchwork.firma.local', 'patchwork'], issuer: 'Test-Root' });
  });
});

describe('Zertifikat einlesen', () => {
  it('liest PEM, DER, PKCS#7 und die PKCS#7-Kette der Microsoft-CA mit «BEGIN CERTIFICATE»', async () => {
    const { csrPem } = await createRequest(['patchwork.firma.local']);
    const leaf = await sign(root, csrPem);
    const p7 = Buffer.from(new x509.X509Certificates([leaf, root.cert]).export('raw'));
    const microsoftP7 = `-----BEGIN CERTIFICATE-----\r\n${p7.toString('base64').match(/.{1,64}/g)!.join('\r\n')}\r\n-----END CERTIFICATE-----\r\n`;
    const subjects = (data: Buffer) => parseCertificates(data).map((c) => c.subject);

    expect(subjects(Buffer.from(pem(leaf)))).toEqual(['CN=patchwork.firma.local']);
    expect(subjects(Buffer.from(pem(leaf) + pem(root.cert)))).toEqual(['CN=patchwork.firma.local', 'CN=Test-Root']);
    expect(subjects(Buffer.from(leaf.rawData))).toEqual(['CN=patchwork.firma.local']);
    expect(subjects(p7).sort()).toEqual(['CN=Test-Root', 'CN=patchwork.firma.local']);
    expect(subjects(Buffer.from(microsoftP7)).sort()).toEqual(['CN=Test-Root', 'CN=patchwork.firma.local']);
    expect(subjects(Buffer.from(Buffer.from(leaf.rawData).toString('base64')))).toEqual(['CN=patchwork.firma.local']);
    expect(() => parseCertificates(Buffer.from('kein Zertifikat'))).toThrow(CertificateError);
  });

  it('schickt Zwischenzertifikate mit, die Wurzel nicht', async () => {
    const intermediate = await createCa('Test-Zwischen', root);
    const { keyPem, csrPem } = await createRequest(['patchwork.firma.local']);
    const leaf = await sign(intermediate, csrPem);
    const certs = [root.cert, leaf, intermediate.cert].map(node);
    const match = certificateForKey(certs, keyPem)!;
    expect(parseCertificates(Buffer.from(match.pem)).map((c) => c.subject)).toEqual(['CN=patchwork.firma.local', 'CN=Test-Zwischen']);
    expect(certificateForKey(certs, (await createRequest(['x'])).keyPem)).toBeNull();
  });

  it('nimmt nur gültige Zertifikate für Webserver', async () => {
    const { csrPem } = await createRequest(['patchwork.firma.local']);
    const check = async (options: Parameters<typeof sign>[2] = {}) => {
      const cert = node(await sign(root, csrPem, options));
      return () => assertUsable(cert);
    };
    expect(await check()).not.toThrow();
    expect(await check({ usages: null })).not.toThrow();
    expect(await check({ from: -10, to: -1 })).toThrow(/abgelaufen/);
    expect(await check({ from: 2, to: 10 })).toThrow(/erst ab/);
    expect(await check({ usages: [x509.ExtendedKeyUsage.clientAuth] })).toThrow(/nicht für Webserver/);
    expect(daysLeft('2026-11-20T12:00:00Z', new Date('2026-10-20T12:00:00Z'))).toBe(31);
    expect(daysLeft('2026-10-19T12:00:00Z', new Date('2026-10-20T12:00:00Z'))).toBe(-1);
  });
});

describe('HTTPS in Patchwork', () => {
  const saved = { dataDir: appConfig.dataDir, httpsPort: appConfig.httpsPort, publicUrl: appConfig.publicUrl };
  let dir: string;
  const services: TlsService[] = [];
  const handler = (_req: unknown, res: { end: (body: string) => void }) => res.end('hallo');
  const create = () => {
    const service = new TlsService({ httpAdapter: { getInstance: () => handler } } as never);
    services.push(service);
    return service;
  };
  const port = (service: TlsService) => ((service as unknown as { server: { address(): AddressInfo } }).server.address()).port;

  /** HTTPS-Abruf, der nur der Test-CA vertraut; liefert Antwort und Seriennummer des Zertifikats. */
  const fetchHttps = (service: TlsService, servername = 'patchwork.firma.local') =>
    new Promise<{ body: string; serial: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: port(service), servername, ca: pem(root.cert), path: '/', agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ body, serial: (res.socket as unknown as { getPeerCertificate(): { serialNumber: string } }).getPeerCertificate().serialNumber }));
      });
      req.on('error', reject);
      req.end();
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patchwork-tls-'));
    Object.assign(appConfig, { dataDir: dir, httpsPort: 0, publicUrl: 'http://patchwork.firma.local' });
  });
  afterEach(async () => {
    services.splice(0).forEach((s) => s.onApplicationShutdown());
    Object.assign(appConfig, saved);
    await rm(dir, { recursive: true, force: true });
  });

  it('erstellt eine Anforderung, übernimmt das signierte Zertifikat und startet HTTPS', async () => {
    const tls = create();
    expect(await tls.status()).toMatchObject({ active: false, certificate: null, pending: null, suggestedNames: ['patchwork.firma.local'] });

    const requested = await tls.createRequest(['patchwork.firma.local']);
    expect(requested.pending).toMatchObject({ names: ['patchwork.firma.local'], csr: expect.stringContaining('BEGIN CERTIFICATE REQUEST') });
    // Der Schlüssel ist nur für Patchwork lesbar (unter Windows gibt es keine Unix-Rechte)
    if (process.platform !== 'win32') expect((await stat(join(dir, 'tls', 'pending.key'))).mode & 0o077).toBe(0);

    const status = await tls.install(Buffer.from(pem(await sign(root, requested.pending!.csr))));
    expect(status).toMatchObject({ active: true, pending: null, redirects: false, certificate: { names: ['patchwork.firma.local'], issuer: 'Test-Root' } });
    expect(status.certificate!.daysLeft).toBeGreaterThan(700);
    expect((await fetchHttps(tls)).body).toBe('hallo');
    expect(tls.expiresAt).toBe(status.certificate!.validTo);

    // Umleitung erst, wenn PUBLIC_URL auf https:// steht
    appConfig.publicUrl = 'https://patchwork.firma.local';
    expect(tls.redirects).toBe(true);
  });

  it('tauscht ein erneuertes Zertifikat ohne Neustart aus und lädt es beim nächsten Start', async () => {
    const tls = create();
    await tls.install(Buffer.from(pem(await sign(root, (await tls.createRequest(['patchwork.firma.local'])).pending!.csr))));
    const first = await fetchHttps(tls);
    const renewed = await sign(root, (await tls.createRequest(['patchwork.firma.local'])).pending!.csr);
    await tls.install(Buffer.from(pem(renewed)));
    const second = await fetchHttps(tls);
    expect(second.serial).not.toBe(first.serial);
    expect(second.serial.toLowerCase()).toBe(renewed.serialNumber.toLowerCase());
    tls.onApplicationShutdown();

    const restarted = create();
    await restarted.start();
    expect((await restarted.status()).active).toBe(true);
    expect((await fetchHttps(restarted)).serial).toBe(second.serial);
    expect(await readFile(join(dir, 'tls', 'server.crt'), 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('lehnt Zertifikate ab, die zu keinem Schlüssel passen', async () => {
    const tls = create();
    await tls.createRequest(['patchwork.firma.local']);
    const foreign = await sign(root, (await createRequest(['anderer.firma.local'])).csrPem);
    await expect(tls.install(Buffer.from(pem(foreign)))).rejects.toThrow(/anderer\.firma\.local passt zu keinem Schlüssel/);
    expect((await tls.status()).active).toBe(false);
    // Die offene Anforderung bleibt; Verwerfen löscht sie
    expect((await tls.discardRequest()).pending).toBeNull();
  });
});
