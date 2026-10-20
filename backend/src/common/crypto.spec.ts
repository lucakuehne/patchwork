import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, sign, verifySignature } from './crypto';

describe('Signaturen', () => {
  it('prüft die eigene Signatur', () => {
    expect(verifySignature('image', 'abc', sign('image', 'abc'))).toBe(true);
  });

  it('lehnt fremde Werte, andere Verwendungen und Fälschungen ab', () => {
    const signature = sign('image', 'abc');
    const forged = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    expect(verifySignature('image', 'abd', signature)).toBe(false);
    expect(verifySignature('download', 'abc', signature)).toBe(false);
    expect(verifySignature('image', 'abc', forged)).toBe(false);
    expect(verifySignature('image', 'abc', '')).toBe(false);
  });
});

describe('Verschlüsselung', () => {
  it('entschlüsselt, was sie verschlüsselt hat', () => {
    expect(decryptSecret(encryptSecret('geheim'))).toBe('geheim');
  });
});
