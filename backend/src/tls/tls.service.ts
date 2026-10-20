import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { join } from 'node:path';
import { appConfig } from '../config';
import {
  assertUsable,
  certificateForKey,
  CertificateError,
  createRequest,
  daysLeft,
  describeCertificate,
  parseCertificates,
  type CertificateInfo,
} from './certificates';

export interface TlsStatus {
  /** HTTPS läuft mit einem Zertifikat */
  active: boolean;
  /** Port für HTTPS im Container */
  httpsPort: number;
  publicUrl: string;
  /** http:// leitet auf https:// um */
  redirects: boolean;
  /** z.B. Port belegt */
  error: string | null;
  certificate: (CertificateInfo & { daysLeft: number }) | null;
  /** Offene Zertifikatsanforderung, wartet auf das signierte Zertifikat */
  pending: { names: string[]; createdAt: string; csr: string } | null;
  /** Vorschlag für die Namen einer neuen Anforderung: der Host aus PUBLIC_URL */
  suggestedNames: string[];
}

interface Pair {
  key: string;
  cert: string;
  info: CertificateInfo;
}

/**
 * HTTPS direkt in Patchwork, ohne Reverse Proxy. Schlüssel und Zertifikat liegen unter DATA_DIR/tls:
 * server.key/server.crt sind aktiv, pending.* ist eine offene Anforderung. Der Schlüssel entsteht hier und
 * verlässt den Server nicht; die Zertifizierungsstelle signiert nur die Anforderung (CSR).
 * Ein neues Zertifikat übernimmt der laufende Server ohne Neustart.
 */
@Injectable()
export class TlsService implements OnApplicationShutdown {
  private readonly logger = new Logger(TlsService.name);
  private readonly dir = join(appConfig.dataDir, 'tls');
  private server: Server | null = null;
  private current: CertificateInfo | null = null;
  private error: string | null = null;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  get active(): boolean {
    return !!this.current && !!this.server?.listening;
  }

  /** Umleitung von http:// auf https:// erst, wenn HTTPS läuft und PUBLIC_URL auf https:// steht. */
  get redirects(): boolean {
    return this.active && appConfig.publicUrl.startsWith('https://');
  }

  /** Ablauf des aktiven Zertifikats (ISO), für den Hinweis an Admins. */
  get expiresAt(): string | null {
    return this.active ? (this.current?.validTo ?? null) : null;
  }

  /** Beim Start: vorhandenes Zertifikat laden und HTTPS starten. */
  async start(): Promise<void> {
    const key = await this.read('server.key');
    const cert = await this.read('server.crt');
    if (!key || !cert) return;
    try {
      const match = certificateForKey(parseCertificates(Buffer.from(cert)), key);
      if (!match) throw new Error('Zertifikat und Schlüssel passen nicht zusammen');
      await this.listen({ key, cert, info: describeCertificate(match.leaf) });
    } catch (err) {
      this.error = `HTTPS nicht gestartet: ${(err as Error).message}`;
      this.logger.error(this.error);
    }
  }

  async status(): Promise<TlsStatus> {
    const [csr, meta] = await Promise.all([this.read('pending.csr'), this.read('pending.json')]);
    const pending = csr && meta ? { ...(JSON.parse(meta) as { names: string[]; createdAt: string }), csr } : null;
    let host = '';
    try {
      host = new URL(appConfig.publicUrl).hostname;
    } catch {
      host = '';
    }
    return {
      active: this.active,
      httpsPort: appConfig.httpsPort,
      publicUrl: appConfig.publicUrl,
      redirects: this.redirects,
      error: this.error,
      certificate: this.current ? { ...this.current, daysLeft: daysLeft(this.current.validTo) } : null,
      pending,
      suggestedNames: host ? [host] : [],
    };
  }

  /** Neue Anforderung: Schlüssel und CSR entstehen hier; eine frühere offene Anforderung wird ersetzt. */
  async createRequest(names: string[]): Promise<TlsStatus> {
    const { keyPem, csrPem } = await createRequest(names);
    await this.write('pending.key', keyPem, 0o600);
    await this.write('pending.csr', csrPem);
    await this.write('pending.json', JSON.stringify({ names, createdAt: new Date().toISOString() }));
    return this.status();
  }

  async discardRequest(): Promise<TlsStatus> {
    await Promise.all(['pending.key', 'pending.csr', 'pending.json'].map((f) => rm(join(this.dir, f), { force: true })));
    return this.status();
  }

  /**
   * Übernimmt ein signiertes Zertifikat. Es muss zum Schlüssel der offenen Anforderung passen oder zum aktiven
   * Schlüssel (falls die CA dieselbe Anforderung erneut signiert hat).
   */
  async install(data: Buffer): Promise<TlsStatus> {
    const certs = parseCertificates(data);
    for (const slot of ['pending', 'server'] as const) {
      const key = await this.read(`${slot}.key`);
      const match = key ? certificateForKey(certs, key) : null;
      if (!key || !match) continue;
      assertUsable(match.leaf);
      await this.write('server.key', key, 0o600);
      await this.write('server.crt', match.pem);
      if (slot === 'pending') await this.discardRequest();
      await this.listen({ key, cert: match.pem, info: describeCertificate(match.leaf) });
      this.logger.log(`Neues Zertifikat für ${this.current?.names.join(', ')} übernommen`);
      return this.status();
    }
    const [leaf] = certs.filter((c) => !c.checkIssued(c));
    throw new CertificateError(
      `Das Zertifikat${leaf ? ` für ${describeCertificate(leaf).names.join(', ')}` : ''} passt zu keinem Schlüssel von Patchwork. ` +
        'Bitte das Zertifikat hochladen, das die Zertifizierungsstelle für die offene Anforderung ausgestellt hat.',
    );
  }

  /** Startet HTTPS mit demselben Express wie HTTP oder tauscht beim laufenden Server das Zertifikat aus. */
  private async listen(pair: Pair): Promise<void> {
    if (this.server?.listening) {
      this.server.setSecureContext({ key: pair.key, cert: pair.cert });
    } else {
      this.server?.close();
      const server = createServer({ key: pair.key, cert: pair.cert }, this.adapterHost.httpAdapter.getInstance());
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(appConfig.httpsPort, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', (err) => this.logger.error(`HTTPS: ${err.message}`));
      this.server = server;
      this.logger.log(`HTTPS auf Port ${appConfig.httpsPort} (${pair.info.names.join(', ')}, gültig bis ${pair.info.validTo})`);
    }
    this.current = pair.info;
    this.error = null;
  }

  onApplicationShutdown() {
    this.server?.closeAllConnections();
    this.server?.close();
  }

  private async read(file: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, file), 'utf8');
    } catch {
      return null;
    }
  }

  /** Schreibt zuerst in eine temporäre Datei, damit nie eine halbe Datei stehen bleibt. */
  private async write(file: string, content: string, mode = 0o644): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, file);
    await rm(`${target}.tmp`, { force: true });
    await writeFile(`${target}.tmp`, content, { mode });
    await rename(`${target}.tmp`, target);
  }
}
