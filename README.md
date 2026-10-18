# Patchwork

Störungen und Aufgaben an einem Ort, als Ersatz für Wekan und HelpSpot.
Konzept: [Grundkonzept.md](Grundkonzept.md), getroffene Entscheidungen: [docs/Entscheidungen.md](docs/Entscheidungen.md).

## Funktionsumfang (MVP)

- **Ein Vorgang, zwei Typen:** Störung oder Aufgabe, Typwechsel mit einem Klick. Verlauf, Kommentare und Anhänge bleiben erhalten.
- **Tabs:** Eingang (Mails ohne Typ), Störungen (Liste, dringend zuerst; Ansicht «Gelöst»), Aufgaben (Board mit Drag & Drop; Ansichten «Erledigt» und «Abgelehnt»). Jeder Tab zeigt die Anzahl offener Vorgänge und hat den Filter «Nur meine».
- **Status pro Typ** in der Verwaltung bearbeitbar. Die Kategorie (Neu, In Arbeit, Wartend, Erledigt, Abgelehnt) steuert das Verhalten.
- **E-Mail rein und raus:** mehrere Postfächer (IMAP/SMTP, Passwort oder OAuth 2.0 für Microsoft 365), Zuordnung von Antworten über Mail-Header oder `[PW-1234]` im Betreff, Eingangsbestätigung, öffentliche Antworten an Melder und CC-Beteiligte, interne Notizen, Benachrichtigungen an Zuständige, Stummschalten pro Vorgang.
- **Login:** lokale Benutzer und LDAP/AD (Rolle über AD-Gruppen). Erster Admin über den Einrichtungs-Assistenten.
- **Volltextsuche** über Titel, Beschreibung und Timeline (PostgreSQL).

## Etappe 2

- **Portal** unter `/portal` für Standard-Benutzer (Anmeldung mit dem AD-Konto): eigene Vorgänge (offen/abgeschlossen) mit vereinfachtem Status, neue Meldungen («Etwas funktioniert nicht» / «Ich brauche etwas»), Antworten mit Anhängen. Neue Meldungen landen mit dem Typ-Vorschlag des Melders im Eingang.
- **Verknüpfungen** zwischen Vorgängen: «Bezieht sich auf», «Behebt / Wird behoben durch», «Duplikat von / Hat Duplikat». Wird ein behebender Vorgang erledigt, erhält der Zuständige des behobenen eine Mail.
- **Duplikate** werden automatisch geschlossen und zum Original umgeleitet: Bei gleichem Melder wird die Meldung ins Original übernommen, sonst wird der Melder dort Beteiligter. Er erhält einen Hinweis per Mail, und Antworten landen beim Original. Details in [docs/Entscheidungen.md](docs/Entscheidungen.md).
- **Checklisten** für Aufgaben, mehrere pro Aufgabe, mit Fortschritt auf Board und Listen. Abschliessen mit offenen Punkten nur nach Rückfrage. **Vorlagen** pflegt der Admin unter Verwaltung → Checklisten-Vorlagen.
- **Personensuche** für Melder und Beteiligte nach Name, Benutzername und E-Mail, auch im AD.
- Eigene **interne Notizen** lassen sich 5 Minuten lang bearbeiten. Mehrere Änderungen kurz hintereinander erscheinen als eine Zeile in der Timeline.

## Etappe 3

- **Regeln** (Verwaltung → Regeln) für neue Mails, neue Portal-Meldungen und Antworten. Bedingungen: Absender bzw. Domain, Betreff, Text, Postfach, AD-Gruppe, mit UND/ODER und Gruppen. Aktionen: Typ, Priorität, Zuständig, Checklisten-Vorlage, Eingangsbestätigung unterdrücken, Verwerfen. Abarbeitung von oben nach unten, Vorschau auf die letzten 30 Tage.
- **Zeitgesteuerte Regeln:** «seit N Tagen in Neu, In Arbeit oder Wartend», z.B. Eskalation per Priorität und Zuständigem oder bei «Wartet auf Melder» eine Erinnerung und das automatische Schliessen.
- **Textbausteine** (Verwaltung → Textbausteine) mit Platzhaltern wie `{{Melder}}`, die sich per Knopf einfügen lassen, im Antwortfeld über «Textbaustein» einfügbar.
- **Auswertungen** (nur Admin, in der Hauptnavigation): neue und abgeschlossene Vorgänge im Verlauf, offene nach Status, Priorität und Zuständigem, älteste offene Vorgänge, Dauer bis «Gelöst», häufigste Melder. Zeitraum wählbar, Export als CSV, Diagramme als Bild und der ganze Bericht als PDF.

## Technik

| Bereich | Wahl |
| --- | --- |
| Backend | NestJS 11, Drizzle ORM, PostgreSQL (Volltextsuche `german`) |
| Hintergrundjobs | pg-boss 10 (Mail-Abruf jede Minute, Versand mit Wiederholung) |
| Frontend | Vue 3, Vite, Pinia, vuedraggable; vom Backend als statische Dateien ausgeliefert |
| Paketverwaltung | pnpm (Workspaces `backend`, `frontend`) |

## Entwicklung

Voraussetzungen: Node.js ≥ 22.12, pnpm 10, PostgreSQL.

```bash
pnpm install
cp .env.example .env   # DATABASE_URL und APP_SECRET anpassen
pnpm dev:backend       # API auf http://localhost:8080 (Migrationen laufen beim Start)
pnpm dev:frontend      # Oberfläche auf http://localhost:5173 (leitet /api an 8080 weiter)
```

Im Entwicklungsserver (Port 5173) gibt es unten einen schwebenden Knopf für die Vue Devtools, mit Komponenten-Inspektor und
«In der IDE öffnen» (Standard: VS Code, sonst z.B. `LAUNCH_EDITOR=webstorm`). Im gebauten Frontend (Port 8080) funktioniert
nur die Browser-Erweiterung, und nur wenn mit `pnpm build:devtools` gebaut wurde. Das Docker-Image baut immer ohne Devtools.

Beim ersten Aufruf erscheint der Einrichtungs-Assistent für das erste Admin-Konto.

Weitere Befehle:

```bash
pnpm build             # Frontend und Backend bauen; danach liefert «node backend/dist/main.js» alles auf Port 8080 aus
pnpm test              # Unit-Tests
pnpm typecheck         # TypeScript-Prüfung beider Pakete
pnpm db:generate       # Migration aus Änderungen an backend/src/db/schema.ts erzeugen
```

### Smoke-Test

`backend/test/smoke.mjs` prüft den ganzen Ablauf (Einrichtung, Mail-Eingang, Antworten, Typwechsel, Board, Ablehnen, Rechte, Checklisten, Verknüpfungen, Duplikate, Portal, Regeln, Textbausteine, Auswertungen …)
gegen eine laufende Instanz mit **leerer** Datenbank und einem lokalen Testmailserver. Ist `SMOKE_DATABASE_URL` auf die
Datenbank der Test-Instanz gesetzt, prüft er auch die zeitgesteuerten Regeln (mit zurückgestellter Zeit), sonst wird dieser
Teil übersprungen:

```bash
docker run -d --name patchwork-greenmail -p 13025:3025 -p 13143:3143 -e "GREENMAIL_OPTS=-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" greenmail/standalone:2.1.3
```

```bash
pnpm --filter backend test:smoke
```

### LDAP-Tests

Beide Tests speichern LDAP-Einstellungen. Sie brechen ab, wenn die Instanz schon echte LDAP-Einstellungen hat, und gehören
deshalb gegen eine **separate Test-Instanz** mit eigener Datenbank, z.B.:

```bash
docker run -d --name patchwork-testdb -p 15432:5432 -e POSTGRES_USER=patchwork -e POSTGRES_PASSWORD=patchwork -e POSTGRES_DB=patchwork postgres:17-alpine
```

Die Test-Instanz dann mit `DATABASE_URL=postgres://patchwork:patchwork@localhost:15432/patchwork`, `PORT=18081` und
`MAIL_POLLING=false` starten.

**OpenLDAP** (`backend/test/ldap-smoke.mjs`): Testdaten aus `backend/test/ldap-seed.ldif` (Benutzer `lena` = IT,
`otto` = Admin, `sam` = Standard, `nomail` ohne E-Mail).

```bash
docker run -d --name patchwork-ldap -p 10389:389 -e LDAP_ORGANISATION=Test -e LDAP_DOMAIN=test.local -e LDAP_ADMIN_PASSWORD=admin-pw osixia/openldap:1.5.0
```

```bash
docker exec -i patchwork-ldap ldapadd -x -H ldap://localhost -D cn=admin,dc=test,dc=local -w admin-pw < backend/test/ldap-seed.ldif
```

```bash
node backend/test/ldap-smoke.mjs http://localhost:18081 <admin-email> <admin-passwort>
```

**Active Directory** (`backend/test/ad-smoke.mjs`): gegen einen Samba-AD-Testserver (`smblds/smblds`), der sich wie ein
Domain Controller mit LDAP-Signierungspflicht verhält. `backend/test/ad-setup.sh` richtet ihn ein: Container
`patchwork-ad`, eigene Test-CA mit Zertifikat für `localhost`, Testkonten und Gruppen. Voraussetzungen sind Docker,
OpenSSL und Bash (unter Windows Git Bash).

```bash
bash backend/test/ad-setup.sh ./ad-test-tls
```

```bash
node backend/test/ad-smoke.mjs http://localhost:18081 <admin-email> <admin-passwort> ./ad-test-tls/ca.pem
```

## LDAP mit Active Directory

Domain Controller verlangen heute meist **LDAP-Signierung**, ab Windows Server 2025 ist das Standard. Patchwork meldet sich
mit Benutzername und Passwort an (Simple Bind). Das geht dann nur über eine **verschlüsselte Verbindung**:

- **STARTTLS** (empfohlen): weiterhin `ldap://dc.firma.local` auf Port 389, Verbindung wird verschlüsselt.
- **LDAPS**: `ldaps://dc.firma.local` auf Port 636.

Beides braucht ein **Zertifikat auf dem Domain Controller**, ausgestellt auf seinen vollständigen Namen, mit
Verwendungszweck «Serverauthentifizierung». Fehlt es, meldet die Diagnose «Für LDAP ist kein Zertifikat installiert».

- **Mit Windows-Zertifizierungsstelle (AD CS):** Der DC erhält über die Vorlage «Domänencontrollerauthentifizierung» bzw.
  «Kerberos-Authentifizierung» meist automatisch ein Zertifikat (prüfen in `certlm.msc` → Eigene Zertifikate). In Patchwork
  unter «CA-Zertifikat» das Stammzertifikat der Zertifizierungsstelle hinterlegen.
- **Ohne Zertifizierungsstelle:** Auf dem DC ein eigenes Zertifikat erzeugen und ihm selbst vertrauen (PowerShell als
  Administrator, Namen anpassen):

  ```powershell
  $cert = New-SelfSignedCertificate -DnsName "dc01.firma.local","dc01" -CertStoreLocation Cert:\LocalMachine\My -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") -NotAfter (Get-Date).AddYears(5)
  Export-Certificate -Cert $cert -FilePath C:\dc01-ldap.cer
  Import-Certificate -FilePath C:\dc01-ldap.cer -CertStoreLocation Cert:\LocalMachine\Root
  ```

  Danach den Dienst «Active Directory-Domänendienste» neu starten oder den DC neu starten (Wartungsfenster). In Patchwork
  die Datei `dc01-ldap.cer` unter «CA-Zertifikat» laden.

Das Dienstkonto kann als `benutzer@domäne`, `DOMÄNE\benutzer` oder vollständiger DN angegeben werden. Die Vorlage
«Active Directory» setzt Benutzerfilter, Attribute und verschachtelte Gruppen passend.

## Betrieb mit Docker

Das Image enthält Front- und Backend. Daten (Anhänge, Logo, Originalmails) liegen im Volume `/data`.

**Mit eigenem Datenbank-Container** (Profil `db`):

```bash
docker compose --profile db up -d
```

**Mit externer Datenbank:** `DATABASE_URL` setzen, dann ohne Profil starten:

```bash
docker compose up -d
```

Für eine PostgreSQL auf dem Docker-Host (Dev-Betrieb) lautet die Adresse z.B.
`postgres://patchwork:patchwork@host.docker.internal:5432/patchwork`.

> Achtung: Compose liest die `.env` im selben Verzeichnis. Die Entwicklungs-`.env` enthält `localhost` als Datenbank-Host, was im Container nicht funktioniert. Für Docker eine eigene `.env` mit passender `DATABASE_URL` verwenden oder die Variable weglassen (dann gilt der Datenbank-Container).

### Umgebungsvariablen

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL-Verbindung | – (Compose: Container `db`) |
| `APP_SECRET` | Schlüssel für gespeicherte Passwörter (≥ 32 Zeichen, nach dem ersten Start nicht mehr ändern) | – |
| `PUBLIC_URL` | Öffentliche Adresse, für Links in Mails; bei `https://` werden Cookies als `Secure` gesetzt | `http://localhost:8080` |
| `PORT` | Port des Webservers | `8080` |
| `DATA_DIR` | Ablage für Dateien | `./data` (Container: `/data`) |
| `MAIL_POLLING` | Mail-Abruf ein/aus | `true` |

Mailserver, Name und Logo werden in der Oberfläche unter **Verwaltung** eingerichtet, nicht im Code.

### Microsoft 365 (OAuth 2.0)

1. App-Registrierung in Entra ID mit den Anwendungsberechtigungen `IMAP.AccessAsApp` und `SMTP.SendAsApp` (Office 365 Exchange Online), Administratorzustimmung erteilen, Client-Secret erstellen.
2. In Exchange Online einen Service Principal für die App anlegen und ihm Zugriff auf das Postfach geben (`New-ServicePrincipal`, `Add-MailboxPermission`).
3. SMTP AUTH auf dem Postfach aktivieren.
4. In Patchwork unter Verwaltung → Postfächer die Vorlage «Microsoft 365» wählen und Tenant-ID, Client-ID sowie Client-Secret eintragen.

Anleitung von Microsoft: <https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth>

## Projektstruktur

```
backend/
  src/auth/        Anmeldung (lokal, LDAP), Sitzungen, Einrichtung
  src/items/       Vorgänge: Ansichten, Typwechsel, Status, Timeline
  src/mail/        Postfächer, Abruf (IMAP), Versand (SMTP), Benachrichtigungen
  src/statuses/    Status pro Typ und Kategorie-Regeln
  src/db/          Schema und Migrationen (drizzle/)
  test/smoke.mjs   End-to-End-Test
frontend/
  src/views/       Seiten (Eingang, Störungen, Board, Detail, Verwaltung)
  src/components/  Bausteine (Tabelle, Timeline, Dialoge)
```
