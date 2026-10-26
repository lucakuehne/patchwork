# Patchwork – Hinweise für Claude

## Projekt

- Patchwork ersetzt Wekan und HelpSpot: Vorgänge vom Typ Störung oder Aufgabe, Eingang, Mail rein und raus, Portal,
  LDAP/AD, Regeln, Textbausteine, Auswertungen, Betrieb mit Docker.
- Stand 26.10.2026: MVP, Etappe 2 und Etappe 3 sind umgesetzt, getestet und in Produktion (zurzeit im Testbetrieb,
  parallel zu HelpSpot). Unteraufgaben/Projekte sind bewusst zurückgestellt.
- Massgebliche Dokumente:
  - `Grundkonzept.md`: ursprüngliches Konzept.
  - `docs/Entscheidungen.md`: alle mit dem Benutzer abgestimmten Entscheidungen inkl. Randfälle. Vor jeder
    Verhaltensänderung lesen, neue Entscheidungen dort nachtragen.
  - `README.md`: Funktionsumfang, Einrichtung, Tests, Betriebsskripte, LDAP/AD, Docker. Bei neuen Funktionen nachführen.

## Zusammenarbeit

- Kommunikation auf Deutsch. Oberfläche und Dokumente auf Deutsch mit Schweizer Rechtschreibung (ss statt ß).
- Oberfläche, Portal und alle Mails sprechen per du an. Gegenüber Meldern heisst ein Vorgang «Meldung», intern «Vorgang».
- So selbstständig wie möglich arbeiten und keine Fehler machen: Änderungen mit Unit-Tests, Smoke-Test und im Browser
  prüfen.
- Keine konzeptionellen Annahmen zu Verhalten, Abläufen oder Oberfläche. Solche Fragen gesammelt stellen, nummeriert und
  mit je einer Empfehlung, damit der Benutzer kurz antworten kann («passt», «a/b»). Technische Entscheidungen
  (Bibliotheken, Struktur) selbst treffen und dokumentieren.
- Offene Detailfragen in `docs/Entscheidungen.md` als «noch zu bestätigen» markieren, bis der Benutzer sie bestätigt.
- Bei längeren Arbeiten nach grösseren Schritten kurz den Fortschritt melden (kleine Tabelle: erledigt / als Nächstes).
- Nur pnpm verwenden (`pnpm install`, `pnpm --filter backend …`, `pnpm exec …`), nie npm oder npx, auch nicht in
  Anleitungen und im Dockerfile.
- Nicht committen und nicht ausrollen, ausser der Benutzer verlangt es ausdrücklich. Commits ohne Vermerk zu Claude
  (kein «Co-Authored-By»).
- Das Repo ist öffentlich: keine internen Namen (Server, Domain, Portainer-Adresse) und keine Geheimnisse ins Repo. Diese
  stehen nur in `ops/config.ps1` und im Token-File, beide ignoriert.

## Namen

- Bezeichner, Datenbank, API, Migrationen und Dateinamen englisch; Kommentare, Oberfläche, Commits und Dokumente
  deutsch. Bestehende Migrationen behalten ihren (teils deutschen) Namen.

## Umgebung

- Alles läuft auf dem Docker-Server, verwaltet mit Portainer: Produktion (Stack «patchwork») und Tests (vorübergehender
  Stack «patchwork-test» aus `deploy/test-stack.yml`). Auf dem Laptop (Windows 11, Node ≥ 22.12, pnpm 10) nur
  `pnpm install`, `pnpm typecheck`, `pnpm test` und Builds; dort läuft keine Instanz und keine Datenbank.
- Die Betriebsskripte in `ops/` (PowerShell) arbeiten über die Portainer-API, Zugang in `ops/config.ps1`
  (Vorlage `ops/config.example.ps1`), Ausgaben in `ops/out/`. Übersicht im README unter «Betriebsskripte».
- Der Server wird mit anderen Diensten geteilt: nie global aufräumen (`prune`), nur eigene Patchwork-Images entfernen
  (`ops/cleanup-images.ps1`), `postgres:17-alpine` nie löschen. Nach Builds aufräumen, sonst läuft die Platte voll.
- Git Bash: Pfade mit Vorwärts-Schrägstrichen schreiben (`C:/…`), Backslashes gehen sonst verloren. Dateiinhalte mit
  Backslashes (Regex, `\n`) mit Edit/Write ändern, nicht über Strings in Shell-Skripten. Skripte für Windows PowerShell
  5.1 mit BOM speichern (sonst stimmen die Umlaute nicht).

## Tests

- Unit-Tests: `pnpm test` (vitest, Backend und Frontend), dazu `pnpm typecheck`.
- Vor einer Freigabe: `ops/build-test.ps1` (Image bauen, Test-Stack, Smoke-Test, Prüfung im Browser; Bilder in
  `ops/out/shots` ansehen). Bei Änderungen an Anmeldung, LDAP oder AD `ops/all-tests.ps1`, bei Migrationen zusätzlich
  `ops/update-test.ps1` (veröffentlichte Version mit Testdaten, dann Update).
- Der Smoke-Test (`backend/test/smoke.mjs`, Bereiche in `backend/test/smoke/`) läuft nach einem Fehler weiter und nennt
  am Ende die fehlgeschlagenen Schritte. Neue Schritte in den passenden Bereich, gemeinsame Hilfsfunktionen in `lib.mjs`.
- Die Prüfung im Browser steht in `ops/ui/ui-check.mjs` (Playwright, Container im Netz des Test-Stacks).
- Smoke-, LDAP- und AD-Tests brauchen eine leere Datenbank und schreiben Einstellungen: nie gegen die Produktion.

## Rollout

- Nur nach Freigabe durch den Benutzer: committen, pushen, dann `ops/deploy.ps1 -Sha <commit>` (wartet auf GitHub
  Actions, rollt den Stack neu aus und prüft Revision, HTTPS, Healthcheck und Log). Bei Migrationen mit `-Dump`.

## Technik

- pnpm-Monorepo: `backend` (NestJS 11, Drizzle ORM, pg-boss 10, zod) und `frontend` (Vue 3, Vite 7, Pinia, Tiptap).
- Schema in `backend/src/db/schema.ts`, Migrationen in `backend/drizzle/`. Neue Migration aus `backend/` mit
  `pnpm exec drizzle-kit generate --name <englischer_name>`, eigenes SQL zusätzlich mit `--custom` (z.B. der Trigger
  `items_status_changed`, der `status_changed_at` setzt).
- Die Logik hängt am Häkchen «abgeschlossen» je Status und an den Ziel-Status je Typ (Start, nach Antwort, Schliessen,
  Ablehnen, Wartet; Tabelle `status_targets`), nie an Statusnamen. Kategorien gibt es seit 20.10.2026 nicht mehr.
- Bereiche je Rolle: Der AuthGuard prüft jede Route mit `:number`; Routen über andere IDs (Anhänge, Notizen,
  Checklisten) und Listen prüfen selbst (`AreasService`).
- Passwörter von Postfächern und LDAP sind mit `APP_SECRET` verschlüsselt. `APP_SECRET` nicht ändern, solange die
  Datenbank weiterverwendet wird.
- AD des Benutzers: Windows Server 2025 mit Pflicht zur LDAP-Signierung. Patchwork verbindet sich per STARTTLS mit dem
  Zertifikat des Domain Controllers. Bei LDAP-Problemen zuerst TLS/Zertifikat und Gruppen-DNs prüfen, die Diagnose unter
  Verwaltung → LDAP erklärt AD-Fehlercodes.
