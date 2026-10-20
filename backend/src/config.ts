import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// .env im aktuellen Verzeichnis (Container) oder im Projektstamm (Entwicklung).
// Relative Pfade in der .env gelten relativ zu ihrem Verzeichnis.
let baseDir = process.cwd();
for (const candidate of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../.env')]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, quiet: true });
    baseDir = dirname(candidate);
    break;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

const appSecret = required('APP_SECRET');
if (appSecret.length < 32) throw new Error('APP_SECRET muss mindestens 32 Zeichen lang sein');

const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

export const appConfig = {
  databaseUrl: required('DATABASE_URL'),
  appSecret,
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  port: Number(process.env.PORT ?? 8080),
  /** Port für HTTPS; Patchwork lauscht dort, sobald unter Verwaltung → HTTPS ein Zertifikat eingerichtet ist */
  httpsPort: Number(process.env.HTTPS_PORT ?? 8443),
  dataDir: resolve(baseDir, process.env.DATA_DIR ?? './data'),
  frontendDir: resolve(process.env.FRONTEND_DIR ?? resolve(__dirname, '../../frontend/dist')),
  mailPolling: (process.env.MAIL_POLLING ?? 'true').toLowerCase() !== 'false',
  /** Zeitzone für Datumsangaben in Mails */
  timeZone: process.env.TIME_ZONE ?? 'Europe/Zurich',
  /** Maximale Grösse pro Anhang in Bytes */
  maxUploadBytes: 25 * 1024 * 1024,
};
