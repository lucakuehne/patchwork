// Smoke-Test gegen eine laufende Patchwork-Instanz mit leerer Datenbank und einem
// GreenMail-Testserver (SMTP 13025, IMAP 13143, ohne Authentifizierung).
//
//   docker run -d --name patchwork-greenmail -p 13025:3025 -p 13143:3143 \
//     -e "GREENMAIL_OPTS=-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" \
//     greenmail/standalone:2.1.3
//   node test/smoke.mjs [http://localhost:8080]
// HTTPS prüft der Test über HTTPS_PORT der Instanz (Standard 8443, sonst SMOKE_HTTPS_PORT setzen).
//
// Ein Bereich pro Datei unter test/smoke/ (gemeinsame Teile in lib.mjs). Schlägt ein Schritt fehl, laufen die übrigen
// weiter; am Ende stehen die fehlgeschlagenen Schritte, der Exit-Code ist dann 1.
import { finish } from './smoke/lib.mjs';

const AREAS = [
  '01-setup',
  '02-mail',
  '03-statuses',
  '04-users-channels',
  '05-checklists',
  '06-links-duplicates',
  '07-portal',
  '08-notes-mailboxes',
  '09-rules',
  '10-board-reports',
  '11-outgoing-test-mode',
  '12-templates-welcome',
  '13-images-simulation',
  '14-preview',
  '15-areas-https',
  '16-preferences-views',
];

for (const area of AREAS) await import(`./smoke/${area}.mjs`);
finish();
