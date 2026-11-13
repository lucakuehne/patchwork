import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { safeFileName, uniqueNames, zipFiles } from './zip';

/** Einträge des ZIP über das zentrale Verzeichnis lesen (Name, Inhalt) */
function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const result: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(pos + 10);
    const size = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const offset = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const content = zip.subarray(start, start + size);
    result.push({ name, data: method === 8 ? inflateRawSync(content) : Buffer.from(content) });
    pos += 46 + nameLength;
  }
  return result;
}

describe('ZIP für mehrere Dateien', () => {
  it('Namen in UTF-8, Inhalt komprimiert bzw. unverändert, wieder lesbar', () => {
    const big = Buffer.from('Subject: Drucker\r\n\r\n' + 'Text '.repeat(500));
    const zip = zipFiles([
      { name: 'PW-1 Drucker druckt nicht.eml', data: big },
      { name: 'PW-2 Grüsse aus Zürich.eml', data: Buffer.from('x') },
    ]);
    expect(readZip(zip)).toEqual([
      { name: 'PW-1 Drucker druckt nicht.eml', data: big },
      { name: 'PW-2 Grüsse aus Zürich.eml', data: Buffer.from('x') },
    ]);
    expect(zip.length).toBeLessThan(big.length);
  });

  it('lässt sich mit dem Werkzeug des Systems entpacken (tar), falls vorhanden', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      writeFileSync(join(dir, 'test.zip'), zipFiles([{ name: 'Mail.eml', data: Buffer.from('Subject: Hallo\r\n\r\nText') }]));
      try {
        execFileSync('tar', ['-xf', 'test.zip'], { cwd: dir, stdio: 'ignore' });
      } catch {
        return; // kein tar mit ZIP-Unterstützung
      }
      expect(readFileSync(join(dir, 'Mail.eml'), 'utf8')).toBe('Subject: Hallo\r\n\r\nText');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Dateinamen ohne verbotene Zeichen, eindeutig', () => {
    expect(safeFileName('PW-12 AW: Drucker/Scanner? «defekt»  ')).toBe('PW-12 AW Drucker Scanner «defekt»');
    expect(safeFileName('...')).toBe('Datei');
    expect(uniqueNames(['A.eml', 'a.eml', 'B.eml', 'A.eml'])).toEqual(['A.eml', 'a (2).eml', 'B.eml', 'A (3).eml']);
  });
});
