# Patchwork – Hinweise für Claude

## Projekt

- Patchwork ersetzt Wekan und HelpSpot: Vorgänge vom Typ Störung oder Aufgabe, Eingang, Mail rein und raus, Portal,
  LDAP/AD, Regeln, Textbausteine, Auswertungen, Betrieb mit Docker.
- Stand 18.10.2026: MVP, Etappe 2 und Etappe 3 sind umgesetzt und getestet. Unteraufgaben/Projekte sind bewusst
  zurückgestellt.
- Massgebliche Dokumente:
  - `Grundkonzept.md`: ursprüngliches Konzept.
  - `docs/Entscheidungen.md`: alle mit dem Benutzer abgestimmten Entscheidungen inkl. Randfälle. Vor jeder
    Verhaltensänderung lesen, neue Entscheidungen dort nachtragen.
  - `README.md`: Funktionsumfang, Einrichtung, Tests, LDAP/AD, Docker. Bei neuen Funktionen nachführen.

## Zusammenarbeit

- Kommunikation auf Deutsch. Oberfläche und Dokumente auf Deutsch mit Schweizer Rechtschreibung (ss statt ß).
- So selbstständig wie möglich arbeiten und keine Fehler machen: Änderungen mit Unit-Tests, Smoke-Test und im Browser
  prüfen.
- Keine konzeptionellen Annahmen zu Verhalten, Abläufen oder Oberfläche. Solche Fragen gesammelt stellen, nummeriert und
  mit je einer Empfehlung, damit der Benutzer kurz antworten kann («passt», «a/b»). Technische Entscheidungen
  (Bibliotheken, Struktur) selbst treffen und dokumentieren.
- Offene Detailfragen in `docs/Entscheidungen.md` als «noch zu bestätigen» markieren, bis der Benutzer sie bestätigt.
- Bei längeren Arbeiten nach grösseren Schritten kurz den Fortschritt melden (kleine Tabelle: erledigt / als Nächstes).
- Nur pnpm verwenden (`pnpm install`, `pnpm --filter backend …`, `pnpm exec …`), nie npm oder npx, auch nicht in
  Anleitungen und im Dockerfile.
- Nicht committen, ausser der Benutzer verlangt es ausdrücklich.

## Entwicklungsumgebung

- Windows 11, Node ≥ 22.12, pnpm 10, PostgreSQL, Docker für Testcontainer.
- Lokale Instanz des Benutzers auf Port 8080, Datenbank laut `DATABASE_URL` in `.env`:
  - Bauen mit `pnpm build:devtools`, nicht mit `pnpm build`. Beide schreiben nach `frontend/dist`, und der Benutzer will
    die Vue Devtools auch auf 8080.
  - Starten aus dem Projektstamm mit `node backend/dist/main.js` (lädt die `.env` im Projektstamm, Migrationen laufen
    beim Start).
  - Das Frontend wird direkt aus `frontend/dist` ausgeliefert. Nach Frontend-Änderungen genügt ein Neubau, offene Tabs
    laden fehlende Chunks selbst neu. Nach Backend-Änderungen neu bauen und die Instanz neu starten.
- Entwicklungsserver: `pnpm dev:frontend` auf Port 5173 (leitet `/api` an 8080 weiter), mit schwebenden Vue Devtools und
  «In der IDE öffnen» (VS Code). Der Benutzer arbeitet mit beiden Servern.
- Testmailserver GreenMail: Container `patchwork-greenmail` (SMTP 13025, IMAP 13143, Befehl im README unter
  «Smoke-Test»). Das Postfach «IT Helpdesk» der lokalen Instanz fragt ihn ab, deshalb beim Aufräumen nie entfernen.
- Git Bash: Pfade mit Vorwärts-Schrägstrichen schreiben (`C:/…`), Backslashes gehen sonst verloren. Dateiinhalte mit
  Backslashes (Regex, `\n`) mit Edit/Write ändern, nicht über Strings in Shell- oder Python-Skripten.

## Tests

- Unit-Tests: `pnpm test` (vitest, Backend und Frontend), dazu `pnpm typecheck`.
- Smoke-, LDAP- und AD-Tests (`backend/test/*.mjs`) brauchen eine leere Datenbank und schreiben Einstellungen. Nie gegen
  die lokale Instanz auf 8080 laufen lassen (das ist die Standard-URL des Smoke-Tests), sondern gegen eine Test-Instanz
  auf Port 18081 mit eigener Datenbank. Aus `backend/`, nach dem Bauen:

  ```bash
  # Test-Datenbank
  docker run -d --name patchwork-testdb -p 15432:5432 -e POSTGRES_USER=patchwork -e POSTGRES_PASSWORD=patchwork -e POSTGRES_DB=patchwork postgres:17-alpine
  # Test-Instanz: Diese Variablen gehen der .env vor, APP_SECRET kommt aus der .env
  DATABASE_URL=postgres://patchwork:patchwork@localhost:15432/patchwork PORT=18081 PUBLIC_URL=http://localhost:18081 MAIL_POLLING=false DATA_DIR=<Scratchpad>/testdata node dist/main.js
  # Smoke-Test (GreenMail muss laufen), mit SMOKE_DATABASE_URL auch die zeitgesteuerten Regeln
  SMOKE_DATABASE_URL=postgres://patchwork:patchwork@localhost:15432/patchwork node test/smoke.mjs http://localhost:18081
  # Vor einem weiteren Lauf: Test-Instanz stoppen, Datenbank neu anlegen, Test-Ablage leeren
  docker exec patchwork-testdb psql -U patchwork -d postgres -q -c "drop database patchwork" -c "create database patchwork owner patchwork"
  ```

- LDAP und AD: Container und Aufrufe im README. Als Admin dient ein Konto der Test-Instanz, z.B. das vom Smoke-Test
  angelegte (`ada@test.local`, Passwort in `smoke.mjs`).
- Danach aufräumen: Test-Instanz stoppen, `docker rm -f patchwork-testdb patchwork-ldap patchwork-ad`. GreenMail bleibt.

## Technik

- pnpm-Monorepo: `backend` (NestJS 11, Drizzle ORM, pg-boss 10, zod) und `frontend` (Vue 3, Vite 7, Pinia, Tiptap).
- Schema in `backend/src/db/schema.ts`, Migrationen in `backend/drizzle/`. Neue Migration aus `backend/` mit
  `pnpm exec drizzle-kit generate --name <name>`, eigenes SQL zusätzlich mit `--custom` (z.B. der Trigger
  `items_status_changed`, der `status_changed_at` setzt).
- Die Logik hängt am Häkchen «abgeschlossen» je Status und an den Ziel-Status je Typ (Start, nach Antwort, Schliessen,
  Ablehnen, Wartet; Tabelle `status_targets`), nie an Statusnamen. Kategorien gibt es seit 20.10.2026 nicht mehr.
- Passwörter von Postfächern und LDAP sind mit `APP_SECRET` verschlüsselt. `APP_SECRET` nicht ändern, solange die
  Datenbank weiterverwendet wird.
- AD des Benutzers: Windows Server 2025 mit Pflicht zur LDAP-Signierung. Patchwork verbindet sich per STARTTLS mit dem
  Zertifikat des Domain Controllers. Bei LDAP-Problemen zuerst TLS/Zertifikat und Gruppen-DNs prüfen, die Diagnose unter
  Verwaltung → LDAP erklärt AD-Fehlercodes.
