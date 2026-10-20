import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { appConfig } from '../config';

const key = createHash('sha256').update(appConfig.appSecret).digest();
/** Eigener Schlüssel für Signaturen, nicht derselbe wie für die Verschlüsselung */
const signingKey = Buffer.from(hkdfSync('sha256', appConfig.appSecret, '', 'patchwork-signatur', 32));

/** Signatur für Adressen ohne Anmeldung (z.B. Bilder aus Mails in voller Grösse); «purpose» trennt die Verwendungen. */
export function sign(purpose: string, value: string): string {
  return createHmac('sha256', signingKey).update(`${purpose}:${value}`).digest('base64url');
}

export function verifySignature(purpose: string, value: string, signature: string): boolean {
  const expected = Buffer.from(sign(purpose, value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Verschlüsselt ein Geheimnis (z.B. Postfach-Passwort) für die Ablage in der Datenbank. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Ungültiges Format des verschlüsselten Werts');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
