# Patchwork

Störungen und Aufgaben an einem Ort, als Ersatz für Wekan und HelpSpot.
Konzept: [Grundkonzept.md](Grundkonzept.md), getroffene Entscheidungen: [docs/Entscheidungen.md](docs/Entscheidungen.md).

## Funktionsumfang (MVP)

- **Ein Vorgang, zwei Typen:** Störung oder Aufgabe, Typwechsel mit einem Klick. Verlauf, Kommentare und Anhänge bleiben erhalten.
- **Tabs:** Eingang (Mails ohne Typ, mit «+ Neu» für einen Vorgang beliebigen Typs), Störungen (Liste, dringend zuerst; Ansicht «Gelöst»), Aufgaben (Board mit Drag & Drop; Ansichten «Erledigt» und «Abgelehnt»). Jeder Tab zeigt die Anzahl offener Vorgänge und hat den Filter «Nur meine».
- **Status pro Typ** in der Verwaltung bearbeitbar. Die Kategorie (Neu, In Arbeit, Wartend, Erledigt, Abgelehnt) steuert das Verhalten.
- **E-Mail rein und raus:** mehrere Postfächer (IMAP/SMTP mit Passwort, Microsoft 365 über Microsoft Graph mit Anmeldung), die Patchwork nur liest (Mails bleiben ungelesen im Postfach), Abruf aus einem wählbaren Ordner ab einem einstellbaren Zeitpunkt, Zuordnung von Antworten über Mail-Header oder `[PW-1234]` im Betreff, Eingangsbestätigung, öffentliche Antworten an Melder und CC-Beteiligte, interne Notizen, Benachrichtigungen an Zuständige, Stummschalten pro Vorgang.
- **Login:** lokale Benutzer und LDAP/AD (Rolle über AD-Gruppen). Erster Admin über den Einrichtungs-Assistenten.
- **Volltextsuche** über Titel, Beschreibung und Timeline (PostgreSQL).
- **Bilder im Text** in Antworten, Notizen, Beschreibungen und im Portal: über den Knopf «Bild», mit Ctrl+V (z.B. ein Screenshot) oder per Hineinziehen, PNG, JPEG, GIF und WebP bis 10 MB. Sie erscheinen auf Textbreite verkleinert, ein Klick öffnet sie in voller Grösse. In Mails sind sie eingebettet statt angehängt.
- **Ausgehende Mails** (Verwaltung → Ausgehende Mails): Protokoll jeder Mail, die Patchwork verschickt oder zurückhält, vollständig mit Anhängen und als .eml, mit Status (versendet, teilweise versendet, nicht versendet, Fehler) und «Erneut senden» bei Fehlern.
- **Eingehende Mails** (Verwaltung → Eingehende Mails): Protokoll jeder abgeholten Mail mit Ergebnis (neuer Vorgang, Antwort, interne Notiz, automatische Antwort, ignoriert mit Grund, Fehler), vollständig mit Anhängen und als .eml, «Erneut verarbeiten» bei Fehlern. Die Originalmail einer Nachricht öffnet sich auch im Vorgang als Ansicht.
- **E-Mail-Vorlagen** (Verwaltung → E-Mail-Vorlagen): Betreff und Text aller Mails an Melder und IT, dazu Link- und Fusszeile, als Markdown mit Platzhaltern wie `{{Titel}}`, mit Vorschau und «Auf Standard zurücksetzen». Die Nummer `[PW-123]` steht immer vor dem Betreff.
- **Testbetrieb** (Verwaltung → Ausgehende Mails): zwei frei kombinierbare Empfängerkreise, IT-Mitarbeitende (Rolle IT oder Admin) und alle übrigen, je an niemanden, nur an ausgewählte oder an alle. Mails an andere Empfänger stellt Patchwork zusammen, versendet sie aber nicht; geht eine Mail nur an einen Teil der Empfänger, stehen im Kopf nur diese. Öffentliche Antworten tragen in der Timeline den Vermerk «nicht versendet» bzw. «teilweise versendet», alle Benutzer sehen oben einen Hinweis. Antworten auf ausgehende Mails und neue Mails lassen sich simulieren: Patchwork verarbeitet sie wie echte, sie landen aber nicht im Postfach und sind als «simuliert» gekennzeichnet.
- **Parallelbetrieb** mit einem System, das die Mails abholt und danach löscht (z.B. HelpSpot): Eine Regel im Postfach legt eine Kopie jeder eingehenden Mail in einen eigenen Ordner, den man beim Postfach in Patchwork wählt. Bei der Umstellung die Regel löschen und wieder den Posteingang wählen.

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

**Auf dem Docker-Server:** [deploy/test-stack.yml](deploy/test-stack.yml) startet als vorübergehender Portainer-Stack eine
Test-Instanz mit leerer Datenbank, GreenMail, OpenLDAP und Samba-AD. Die Testskripte holt er aus dem Repo (Variable
`TEST_REF`), der Ablauf für Smoke-, LDAP- und AD-Test steht in der Datei. Danach den Stack samt Volumes entfernen.

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

**Fertiges Image:** GitHub Actions ([.github/workflows/image.yml](.github/workflows/image.yml)) prüft bei jedem Push auf
`main` Typen und Unit-Tests und legt danach das Image in der GitHub Container Registry ab: `ghcr.io/lucakuehne/patchwork:latest`,
dazu `sha-<commit>` für jeden Commit und `1.2.3` für ein Git-Tag `v1.2.3`.

**Mit Portainer:** Stack aus dem Git-Repository mit dem Compose-Pfad `deploy/portainer.yml` anlegen. Er enthält Patchwork
und eine eigene PostgreSQL und holt das fertige Image, gebaut wird nichts. Die nötigen Variablen (`APP_SECRET`,
`POSTGRES_PASSWORD`, `PUBLIC_URL`, optional `PATCHWORK_PORT`) sind in der Datei beschrieben. Aktualisieren mit
«Pull and redeploy» und «Re-pull image».

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
| `PORT` | Port des Webservers (HTTP) | `8080` |
| `HTTPS_PORT` | Port für HTTPS, aktiv sobald unter Verwaltung → HTTPS ein Zertifikat eingerichtet ist | `8443` |
| `DATA_DIR` | Ablage für Dateien | `./data` (Container: `/data`) |
| `MAIL_POLLING` | Mail-Abruf ein/aus | `true` |

Mailserver, Name und Logo werden in der Oberfläche unter **Verwaltung** eingerichtet, nicht im Code.

### HTTPS

Patchwork liefert HTTPS selbst aus, ohne Reverse Proxy. Eingerichtet wird es unter **Verwaltung → HTTPS**:

1. **Anforderung erstellen:** Patchwork erzeugt Schlüssel (RSA 2048) und Zertifikatsanforderung (CSR) für die angegebenen
   Namen. Der Schlüssel liegt unter `DATA_DIR/tls` und verlässt den Server nicht.
2. **Signieren lassen**, z.B. von der Zertifizierungsstelle des Active Directory (AD CS):
   `certreq -submit -attrib "CertificateTemplate:WebServer" patchwork.csr patchwork.cer`. Die Anleitung steht auf der Seite.
3. **Zertifikat hochladen** (.cer/.crt/.pem als Base64 oder DER, Ketten als .p7b). Patchwork prüft, ob es zum Schlüssel
   passt und für Webserver ausgestellt ist, und übernimmt es ohne Neustart. Zwischenzertifikate gehen mit, die Wurzel nicht.
4. `PUBLIC_URL` auf `https://…` umstellen. Dann leitet Patchwork Aufrufe über `http://` auf `https://` um, setzt Cookies
   nur noch verschlüsselt und die Microsoft-Anmeldung kehrt direkt zu Patchwork zurück.

Im Container lauscht HTTPS auf `HTTPS_PORT` (8443), die Stack-Dateien veröffentlichen ihn auf dem Server als 443
(`PATCHWORK_HTTPS_PORT`). Ab 30 Tagen vor Ablauf sehen Admins oben einen Hinweis. Zum Erneuern auf derselben Seite eine
neue Anforderung erstellen; das bisherige Zertifikat bleibt aktiv, bis das neue hochgeladen ist.

### Microsoft 365

Postfächer in Microsoft 365 meldet man mit einem Microsoft-Konto an (OAuth 2.0, delegierte Rechte, ohne Client Secret).
Abruf und Versand laufen über Microsoft Graph, IMAP und SMTP AUTH braucht es dafür nicht:

1. **Einmalig für die ganze Instanz:** eine App-Registrierung in Entra ID. Die Anleitung steht in Patchwork unter
   Verwaltung → Postfächer → Microsoft 365 → «Einrichten»: einzelner Mandant, Umleitungs-URI «Öffentlicher Client/nativ»
   mit `https://login.microsoftonline.com/common/oauth2/nativeclient`, «Öffentliche Clientflows zulassen», delegierte Rechte
   unter Microsoft Graph `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`, `openid` und `profile` (für
   freigegebene Postfächer mit einem anderen angemeldeten Konto zusätzlich `Mail.ReadWrite.Shared` und `Mail.Send.Shared`),
   Administratorzustimmung. Am Schluss die Anwendungs-ID dort eintragen. Patchwork fordert genau die eingetragenen Rechte an
   (`https://graph.microsoft.com/.default`).
2. **Pro Postfach:** Vorlage «Microsoft 365» wählen, speichern und «Mit Microsoft anmelden». Standard ist die Anmeldung im
   Browser (Autorisierungscode mit PKCE): Patchwork öffnet die Anmeldeseite von Microsoft in einem neuen Tab. Mit HTTPS
   kehrt der Tab danach direkt zu Patchwork zurück; dafür braucht die App-Registrierung bei «Mobile- und
   Desktopanwendungen» zusätzlich die Umleitungs-URI `https://<Patchwork>/api/microsoft/callback` (steht in der Anleitung
   in Patchwork). Ohne HTTPS, oder mit «Stattdessen Adresse einfügen», fügt man die Adresse der leeren Seite in Patchwork
   ein. Alternativ «Stattdessen mit Code anmelden» (Gerätecode), sofern der Tenant das nicht per bedingtem Zugriff sperrt. Anmelden kann sich das Konto des Postfachs oder ein Konto mit Vollzugriff
   (bei einem freigegebenen Postfach zusätzlich «Senden als»). Den Tenant ermittelt Patchwork aus der Mail-Domain.
3. Den Ordner wählt man nach der Anmeldung beim Postfach aus der Liste der Ordner; Patchwork merkt sich dessen ID, ein
   Umbenennen stört also nicht.
4. Patchwork liest nur: Mails bleiben ungelesen, nichts wird verschoben oder gelöscht. Abgeholt wird über die
   Delta-Abfrage des Ordners: jede Mail, die neu im Ordner liegt und ab «Mails abholen ab» eingegangen ist
   (`receivedDateTime`), auch wenn sie erst später hineinverschoben wurde. Versendet wird die fertige Mail im MIME-Format
   (`sendMail`), sie landet in «Gesendete Elemente». Mails über 3 MB gehen über einen Entwurf mit einzeln hochgeladenen
   Anhängen; dafür braucht es `Mail.ReadWrite`.

Unter «Erweitert» bleibt der App-Zugriff ohne
angemeldetes Konto möglich (Client Credentials: `IMAP.AccessAsApp`, `SMTP.SendAsApp`, Service Principal in Exchange
Online, Client Secret). Anleitung von Microsoft:
<https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth>

## Projektstruktur

```
backend/
  src/auth/        Anmeldung (lokal, LDAP), Sitzungen, Einrichtung
  src/items/       Vorgänge: Ansichten, Typwechsel, Status, Timeline
  src/mail/        Postfächer, Abruf und Versand (IMAP/SMTP, Microsoft Graph), Benachrichtigungen
  src/statuses/    Status pro Typ und Kategorie-Regeln
  src/tls/         HTTPS: Zertifikatsanforderung, Zertifikat, Server
  src/db/          Schema und Migrationen (drizzle/)
  test/smoke.mjs   End-to-End-Test
frontend/
  src/views/       Seiten (Eingang, Störungen, Board, Detail, Verwaltung)
  src/components/  Bausteine (Tabelle, Timeline, Dialoge)
```
