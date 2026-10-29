# Plan: Kennung mit Präfix und Import aus HelpSpot

Stand: 29.10.2026, Schritte 1 und 2 umgesetzt und zusammen ausgerollt (die Änderungen greifen ineinander). Die
Entscheidungen dazu stehen in [Entscheidungen.md](Entscheidungen.md) unter «Import aus HelpSpot». Offen ist der Umstieg
am Stichtag (Schritt 3).

## Schritt 1: Kennung aus Präfix und Nummer

Stand: am 29.10.2026 umgesetzt (Migration 0037, Smoke-Bereich `17-item-refs`); Details in den Entscheidungen.

Ziel: Ein Vorgang heisst «Präfix-Nummer» (PW-123, später HS-17223). Jeder Präfix hat seinen eigenen Nummernkreis, die
volle Kennung steht in Adressen, Schnittstelle, Betreff und Text. Links ohne Präfix gelten als PW.

### Backend

- **Migration:** `items.prefix` (Text, Standard «PW»); eindeutig ist «Präfix + Nummer» statt nur die Nummer. Die
  Sequenz von `items.number` bleibt für PW; Vorgänge mit anderem Präfix (Import) setzen die Nummer selbst.
- **Kennung als Typ:** `ItemKey = { prefix, number }`, `parseItemRef()` («PW-123», «hs-17223», «123» → PW) und
  `formatItemRef()`; bekannte Präfixe als Liste (PW, HS). Unit-Tests.
- **Routen:** Parameter `:ref` statt `:number` mit einer Pipe, die die Kennung prüft (items, checklists, links,
  portal). Der AuthGuard prüft `:ref` auf die Bereiche (`AreasService.assertRef`).
- **Services:** Suche nach Vorgang über die Kennung statt die Nummer: `ItemsService.lock`, Checklisten, Verknüpfungen
  und Duplikate, Portal, Zuordnung von Antworten im Mail-Abruf, Simulation («Antwort auf Vorgang»), Protokolle der
  ein- und ausgehenden Mails, Bereiche.
- **Antworten der Schnittstelle:** überall, wo heute `number` steht, zusätzlich `prefix` (Listen und Board, Detail,
  Verknüpfungen, Portal, Auswertungen, Treffer der Regel-Vorschau, Mail-Protokolle, Simulation).
- **Gespeicherte Verweise** in `entries.meta` (`otherNumber`, `mergedFrom`, `duplicateOf`, `viaDuplicate`): neue Einträge
  speichern auch den Präfix; alte ohne Präfix gelten als PW (`references.ts`).
- **Mail:** `itemRef`, `subjectFor` und Links mit voller Kennung (`/items/PW-123`, `/portal/items/PW-123`); Platzhalter
  {{Nummer}} = volle Kennung. Zuordnung von Antworten: [PW-n], [HS-n] und «Ticket:{n}» (→ HS). Feste «PW-» in Texten
  ersetzen (Duplikat-Hinweis, Protokollzeilen, CSV der Auswertungen).
- **Suche:** «PW-123», «HS-17223» und «17223» (findet beide Präfixe).

### Frontend

- Typen um `prefix` ergänzen, `itemRef(prefix, number)` statt `itemRef(number)`.
- Router: `/items/:ref` und `/portal/items/:ref`; `/items/123` → `/items/PW-123`; `?item=PW-123`. In
  `legacy-urls.ts`: `/v/123` → `/items/PW-123`, `?item=123` und `?vorgang=123` → PW.
- `open-item.ts` (Adresse und Fenster) und alle Aufrufe der Schnittstelle mit `/items/${number}` auf die Kennung
  umstellen (rund 110 Stellen, v.a. ItemView, Eingang, Portal, Verknüpfungen, Auswertungen, Simulation, Board).
- Neu: «PW-123» und «HS-17223» im Text (Beschreibung, Antworten, Notizen) werden zu Links auf den Vorgang.

### Prüfung und Rollout

- Unit-Tests für Kennung, Betreff, Verweise und Weiterleitungen.
- Smoke-Test: Routen mit Kennung und mit Nummer allein (PW). Ein Vorgang mit Präfix HS entsteht per SQL, wenn die
  Datenbank erreichbar ist; damit prüfen: Detail, Suche «17223», Betreff, Antwort mit «Ticket:{n}», Verweise.
- Prüfung im Browser: Adressen mit Kennung, Weiterleitungen alter Adressen (`/items/1`, `/v/1`, `?item=1`).
- Migration: `ops/update-test.ps1`, Rollout mit `-Dump`. README, Entscheidungen (Technik) und CLAUDE.md nachführen.

## Schritt 2: Import aus HelpSpot

Stand: am 29.10.2026 umgesetzt (Migration 0038, Smoke-Bereich `18-helpspot-import` gegen einen nachgebauten
HelpSpot); offene Punkte stehen in den Entscheidungen als «noch zu bestätigen». Abweichend vom Plan läuft der Import
als Hintergrundaufgabe in Patchwork statt über pg-boss (ein Lauf dauert Stunden).

### Backend

- **Einstellung `helpspot`:** Adresse, API-Schlüssel (mit `APP_SECRET` verschlüsselt), Zuordnungen: Typ (Wert des
  Felds «Type» → Störung/Aufgabe), Status je Typ (HelpSpot-Status und offen/geschlossen → Status in Patchwork; geschlossen
  nur auf abgeschlossene, offen nur auf offene), Meldeweg («Eröffnet über» → Meldeweg oder keiner). Vorgefüllt nach den
  Entscheidungen.
- **Client für die HelpSpot-API:** Private API über HTTPS mit Bearer-Token, JSON; gebremst (etwa eine Anfrage pro
  Sekunde), bei HTTP 429 warten und wiederholen. Methoden: `private.request.getStatusTypes` (`fActiveOnly=0`),
  `getCustomFields`, `getChanged`, `search` (blättern, 1000 pro Seite), `get`, `private.document.get`,
  `private.util.getAllStaff`.
- **Analyse für die Zuordnungen:** vorkommende Kombinationen aus Status und offen/geschlossen, Werte von «Type» und
  «Eröffnet über» mit Anzahl (über die Suche, wenige Anfragen).
- **Import als Job** (pg-boss, immer nur einer): Tickets seit dem letzten erfolgreichen Lauf (`getChanged`, beim ersten
  Lauf alle); Papierkorb und Spam überspringen. Pro Ticket:
  - Vorgang mit Präfix HS und der HelpSpot-Nummer anlegen oder aktualisieren; Typ, Status und Meldeweg nach Zuordnung;
    Melder als Kontakt; Zuständige und Autoren über die E-Mail-Adressen aus `getAllStaff`, ehemalige ohne Konto mit
    Namen aus HelpSpot.
  - Einträge je HelpSpot-Eintrag (stabil über dessen ID, neue werden ergänzt): öffentlich/intern, HTML bereinigt wie
    eingehende Mails, Änderungen als kurze graue Zeilen mit dem Text aus HelpSpot, Anhänge über `document.get` in die
    Ablage, eingebettete Bilder wie bei Mails.
  - Zeiten aus den formatierten Angaben («22. Oct 2026, 11:31 Uhr», Zeitzone Zürich, auf die Minute); Eröffnung aus dem
    ersten Eintrag.
  - Rohdaten jedes Tickets unsichtbar speichern (Tabelle `helpspot_tickets` mit JSON und Zeitpunkt des Imports).
  - Keine Nebenwirkungen: keine Regeln, keine Mails, keine Benachrichtigungen; `status_changed_at` offener importierter
    Vorgänge = Zeitpunkt des Imports.
- **Läufe** in `helpspot_import_runs` (Beginn, Ende, Anzahl neu/aktualisiert/übersprungen, Fehler) für den Verlauf.
- **Auswertungen** zählen Vorgänge mit Präfix HS nicht; das **Portal** zeigt sie nicht.
- **Kopien aus der Parallelphase:** Paare über die Message-ID der ersten Mail (`tEmailHeaders` des ersten Eintrags ↔
  eingegangene Mails in Patchwork). Aktion «Kopien bereinigen» für den Stichtag: Kopie ohne Mails schliessen bzw.
  verwerfen und als Duplikat mit dem HS-Vorgang verknüpfen.

### Frontend

- Verwaltung → «HelpSpot-Import» (nur Admins, bleibt dauerhaft): Verbindung (Adresse, Schlüssel, «Verbindung prüfen»),
  Zuordnungen (Typ, Status je Typ, Meldeweg, mit Anzahl Tickets), «Importieren» mit Fortschritt und Ergebnis, Verlauf der
  Läufe, Liste der Kopien aus der Parallelphase mit «Kopien bereinigen».
- Vorgang mit Präfix HS: Zeile «Aus HelpSpot» mit dem ursprünglichen Status.

### Prüfung und Rollout

- Unit-Tests: Zeiten, Zuordnungen, Umwandlung der Einträge, Bremse bei 429.
- Smoke-Test gegen einen nachgebauten HelpSpot (kleiner HTTP-Server mit Beispieldaten im Test-Stack, inkl. 429):
  Import, Wiederholung ohne Doppelte, Antwort mit «Ticket:{n}», Kopien bereinigen, keine Mails, Auswertungen und Portal.
- Prüfen, ob der Docker-Server HelpSpot erreicht (aus einem Container des Test-Stacks).
- Prüfung im Browser: Seite «HelpSpot-Import», importierter Vorgang.
- Migration: `ops/update-test.ps1`, Rollout mit `-Dump`. README und Entscheidungen nachführen.

## Schritt 3: Umstieg

Ablauf, Stichtag und Aufgaben stehen in den Entscheidungen («Umstieg von HelpSpot»). Vor dem Stichtag: Probeimport
in der Produktion mit allen geschlossenen Tickets, dabei den Mail-Abruf in Patchwork ausschalten.
