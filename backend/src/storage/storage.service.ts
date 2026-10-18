import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { appConfig } from '../config';

/** Ablage von Dateien (Anhänge, Logo, Original-Mails) im Datenverzeichnis. */
@Injectable()
export class StorageService {
  private readonly root = resolve(appConfig.dataDir, 'files');

  /** Speichert Daten und gibt den Ablageschlüssel zurück. */
  async save(data: Buffer, prefix = 'att'): Promise<string> {
    const now = new Date();
    const key = [prefix, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), randomUUID()].join(
      '/',
    );
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  stream(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error('Ungültiger Ablageschlüssel');
    return path;
  }
}
