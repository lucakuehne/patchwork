# Patchwork – Entscheidungen zum Konzept

Ergänzt das [Grundkonzept](../Grundkonzept.md). Stand: 15.10.2026, abgestimmt mit Luca Kühne.

## Umfang MVP

- Zwei Typen mit Typwechsel, Eingang, Tabs mit Liste und Board, E-Mail rein und raus, Login (lokal, LDAP/AD).
- **Kein Import** aus HelpSpot oder Wekan.
- Patchwork bleibt vorerst privat (keine Lizenzdatei).

## Prioritäten

- Drei Stufen: **Hoch, Normal, Niedrig**. Gelten für beide Typen.
- Störungen: Sortierung «dringend zuerst» nach Priorität.
- Board: Priorität ist nur eine Markierung, die Reihenfolge in einer Spalte wird per Drag & Drop bestimmt.

## Status

- Status sind pro Typ in der Oberfläche bearbeitbar (nur Admin): anlegen, umbenennen, sortieren, löschen.
- Jeder Status hat eine feste **Kategorie**: *Neu*, *In Arbeit*, *Wartend*, *Erledigt*, *Abgelehnt*.
  *Erledigt* und *Abgelehnt* gelten als abgeschlossen.
- Pro Typ braucht es mindestens je einen Status der Kategorie *Neu*, *In Arbeit* und *Erledigt*.
- Löschen eines verwendeten Status erfordert die Wahl eines Ersatzstatus.
- Die Verwaltung zeigt die Status nach Kategorie gruppiert. Die Reihenfolge (auch der Board-Spalten) ergibt sich aus der Kategorie (Neu, In Arbeit, Wartend, Erledigt, Abgelehnt) und innerhalb der Kategorie aus der eingestellten Reihenfolge.
- Texteingaben (Beschreibung, Antworten, Notizen, Ablehnungsgrund) erfolgen über einen WYSIWYG-Editor mit Toolbar, gespeichert wird Markdown.
- Die Logik hängt an der Kategorie:
  - Neuer Vorgang → erster Status der Kategorie *Neu*.
  - Antwort des Melders (oder eines Beteiligten) auf einen Vorgang in *Wartend* oder *Erledigt* → erster Status der Kategorie *In Arbeit*.
  - Wechsel in die Kategorie *Erledigt* → Mail an den Melder.
  - Aktion «Ablehnen» → Status der Kategorie *Abgelehnt*.
  - Typwechsel → erster Status derselben Kategorie im anderen Typ. Ersatz, falls nicht vorhanden: *Wartend* → *In Arbeit*, *Abgelehnt* → *Erledigt*.
- Standardstatus:
  - Störung: Neu (Neu), In Arbeit (In Arbeit), Wartet auf Melder (Wartend), Gelöst (Erledigt)
  - Aufgabe: Backlog (Neu), Geplant (Neu), In Arbeit (In Arbeit), Erledigt (Erledigt), Abgelehnt (Abgelehnt)

## Ansichten

- Tab Störungen: Unteransichten «Offen» und «Gelöst».
- Tab Aufgaben: «Board», «Erledigt», «Abgelehnt».
- Board: «Abgelehnt» ist keine Spalte. Die Spalte «Erledigt» zeigt nur die letzten 14 Tage.
- Ansichten für Abgeschlossenes sind Listen mit Suche und Filter «Nur meine».
- Volltextsuche über alle Vorgänge.

## Eingang

- Vorgänge im Eingang haben weder Typ noch Status. Beim Zuweisen erhalten sie den ersten Status der Kategorie *Neu*.
- «Verwerfen» (Spam, Newsletter): schliesst den Vorgang ohne Typ, bleibt über die Suche auffindbar.

## Benutzer und Rollen

- Drei Rollen: **Admin** (alles wie IT, zusätzlich Einstellungen, Postfächer, Status, Benutzer), **IT** (sieht und bearbeitet alle Vorgänge), **Standard** (normale Benutzer, später Portal).
- Unbekannte Absender (und CC-Empfänger) werden automatisch als Benutzer mit Rolle Standard ohne Login angelegt.
- Im MVP melden sich nur Admin und IT an. Standard-Benutzer laufen nur über Mail.
- Der erste Admin wird über einen **Einrichtungs-Assistenten** im Browser erstellt.
- LDAP/AD: Benutzer wird beim ersten Login angelegt. Je eine konfigurierbare AD-Gruppe für Admin und für IT, alle anderen werden Standard.
- LDAP/AD-Anmeldung über Simple Bind. Bei Domain Controllern mit LDAP-Signierungspflicht nur über eine verschlüsselte Verbindung: **STARTTLS** (empfohlen, bleibt Port 389) oder LDAPS. Dafür braucht der DC ein Zertifikat. Eine eigene Zertifizierungsstelle kann als CA-Zertifikat hinterlegt werden. LDAP-Signierung per SASL (Kerberos/NTLM) wird nicht unterstützt (Entscheid vom 15.10.2026).

## Mail

- Mehrere Postfächer. Antworten gehen standardmässig über das Postfach, in dem der Vorgang angekommen ist.
  Das Antwort-Postfach ist ein Feld am Vorgang und änderbar. Intern erfasste Vorgänge nutzen das Standard-Postfach.
- Mails an den Melder: Eingangsbestätigung mit Nummer, öffentliche Antworten, Wechsel in die Kategorie *Erledigt*.
  Keine Mails zu internen Notizen und anderen Statuswechseln. Keine Mails zu Änderungen, die der Melder selbst gemacht hat.
- Ablehnen: Checkbox «Melder informieren», standardmässig aus.
- IT: Der Zuständige erhält eine Mail bei Zuweisung und bei Antworten des Melders. Kein Mailversand für neue Vorgänge im Eingang.
  Stummschalten pro Vorgang unterdrückt Mails an diesen Benutzer zu diesem Vorgang.
- Format: Beschreibung und Kommentare in Markdown. Ausgehende Mails als HTML mit Text-Alternative. Eingehende HTML-Mails werden bereinigt gespeichert.
- CC: CC-Adressen eingehender Mails werden **Beteiligte** des Vorgangs (eigene Postfach-Adressen ausgenommen).
  - Öffentliche Antworten gehen an den Melder (To) und alle Beteiligten (CC).
  - IT kann Beteiligte hinzufügen und entfernen.
  - Antwort eines Beteiligten zählt als öffentliche Antwort und wirkt wie eine Antwort des Melders.
  - Eingangsbestätigung und Mail bei *Erledigt* gehen nur an den Melder.
  - Im späteren Portal sieht ein Beteiligter den Vorgang nicht.

## Etappe 2 (Stand 15.10.2026)

Umfang: Portal, Verknüpfungen, Checklisten. **Unteraufgaben/Projekte sind zurückgestellt**, stattdessen erhalten Aufgaben Checklisten.

### Portal

- Anmeldung nur mit dem AD-Konto (Windows-Passwort). Es gibt keine Melder von aussen und deshalb keinen Anmeldelink per Mail.
- Beim ersten Login wird das Konto als Standard angelegt bzw. mit dem bestehenden Kontakt (gleiche E-Mail) zusammengeführt.
- Eigener, schlichter Bereich unter `/portal`: «Meine Vorgänge» (offen/abgeschlossen) und «Neue Meldung». Admin und IT nutzen weiterhin die normale Oberfläche.
- Mails an Melder enthalten einen Link zum Vorgang im Portal.
- Neue Meldung: Auswahl «Etwas funktioniert nicht» / «Ich brauche etwas», Titel, Beschreibung, Anhänge, keine Priorität. Die Meldung landet im Eingang mit dem Vorschlag des Melders, die IT bestätigt mit einem Klick oder wählt den anderen Typ. Eingangsbestätigung per Mail.
- Der Melder sieht Nummer, Titel, Beschreibung, öffentliche Antworten und Anhänge sowie den Status vereinfacht nach Kategorie («Eingegangen», «In Bearbeitung», «Wartet auf Ihre Rückmeldung», «Erledigt», «Abgelehnt»). Nicht sichtbar: interne Notizen, interne Statusnamen, Typ, Zuständiger, Beteiligte. Verworfene Vorgänge erscheinen nicht. Den Ablehnungsgrund sieht er nur, wenn «Melder informieren» gewählt war.
- Der Melder kann nur antworten (mit Anhängen), das wirkt wie eine Antwort per Mail. Keine Statusänderung, kein Zurückziehen, kein Bearbeiten.

### Verknüpfungen

- Arten: «Bezieht sich auf» (beidseitig), «Behebt» ↔ «Wird behoben durch», «Duplikat von» ↔ «Hat Duplikat».
- Kein automatisches Schliessen bei «Behebt». Verknüpfen und Lösen erscheinen in beiden Timelines. Wird eine Aufgabe erledigt, die eine Störung behebt, erhält die Störung einen Timeline-Eintrag und ihr Zuständiger eine Mail.
- **«Duplikat von»** (bestätigt am 15.10.2026):
  - Das Duplikat wird automatisch geschlossen (erster Status der Kategorie «Erledigt»; ohne Typ erhält es den Typ des Originals). Statt der Erledigt-Mail erhält sein Melder einen Hinweis aufs Original. Diese Mail läuft unter der Nummer des Originals.
  - **Gleicher Melder → zusammenführen:** Die Meldung des Duplikats (Text und Anhänge) erscheint im Original als Nachricht des Melders («Zusammengeführt aus PW-…»). Hinweis-Mail «… wurde dort hinzugefügt».
  - **Anderer Melder → Umleitung:** Der Melder wird beim Original Beteiligter (CC) und erhält so dessen öffentliche Antworten. Hinweis-Mail «… wird dort weiterbearbeitet».
  - Antworten auf Mails zum Duplikat landen beim Original. Im Portal zeigt das Duplikat «Erledigt» mit dem Hinweis aufs Original, ohne Antwortfeld. Das Original sieht der Melder im Portal nur, wenn er auch dort Melder ist.
  - Wird die Verknüpfung gelöst, wird nichts rückgängig gemacht. Die IT öffnet das Duplikat bei Bedarf von Hand wieder.
- Duplikate, Randfälle (bestätigt am 15.10.2026):
  - Das Original muss offen sein (nicht abgeschlossen, nicht verworfen). Sonst erscheint eine Fehlermeldung: Original wieder öffnen oder «Bezieht sich auf» verwenden. Grund: «wird dort weiterbearbeitet» wäre sonst falsch, und der Melder bekäme keine Updates mehr.
  - Beteiligte (CC) des Duplikats werden ebenfalls Beteiligte des Originals und erhalten die Hinweis-Mail in CC.
  - Ein bereits abgeschlossenes Duplikat wird nicht nochmals geschlossen, aber genauso umgeleitet (mit Hinweis-Mail). Ein verworfenes Duplikat wird nur verknüpft, ohne Mail.
  - Die Umleitung gilt, solange das Duplikat abgeschlossen ist. Öffnet die IT es wieder, landen Antworten wieder beim Duplikat, und im Portal ist das Antwortfeld zurück.
  - Beim Zusammenführen bleibt der Status des Originals unverändert, auch wenn es auf den Melder wartet.
- Technisch: Keine Duplikat-Ketten. Ein Vorgang kann nur Duplikat eines Vorgangs sein, der selbst kein Duplikat ist, und ein Vorgang mit Duplikaten kann nicht selbst Duplikat werden.

### Checklisten

- Nur bei Aufgaben, mehrere Checklisten mit Titel pro Aufgabe.
- Punkte: Text und offen/abgehakt. Gespeichert wird, wer wann abgehakt hat (sichtbar beim Darüberfahren). Kein Timeline-Eintrag pro Haken. Reihenfolge per Ziehen.
- Fortschritt (z.B. «☑ 3/5») auf den Board-Karten und in den Listen.
- Wechsel in einen «Erledigt»-Status mit offenen Punkten nur nach Rückfrage. Beim Ablehnen keine Rückfrage.
- Typwechsel zur Störung: Checklisten bleiben gespeichert, sind ausgeblendet und erscheinen wieder, wenn der Vorgang erneut eine Aufgabe wird (Hinweis im Timeline-Eintrag).
- Im Portal nicht sichtbar.
- **Vorlagen** (z.B. «Neuer Mitarbeiter»): vom Admin gepflegt (Name und Punkte), in jeder Aufgabe über «Vorlage einfügen» als neue Checkliste übernehmbar.

### Portal – Darstellung

- Antworten der IT erscheinen im Portal als «IT» (ohne Namen des Bearbeiters), eigene Nachrichten als «Sie».
- Automatische Mails des Melders (Abwesenheitsnotizen) erscheinen im Portal nicht.
- Lokale Standard-Konten, denen ein Admin ein Passwort gibt (z.B. zum Testen ohne AD), können sich ebenfalls ins Portal anmelden.
- Mails von Adressen ohne AD-Konto (Lieferanten, Newsletter …) landen weiterhin im Eingang.
- Verknüpfen im Vorgang über eine Suche (Nummer oder Text), zwischen allen Typen, auch mit Vorgängen im Eingang. Nur für die IT sichtbar, nicht im Portal.

## Etappe 3 (Stand 15.10.2026)

Umfang: Regeln, Automatik für «Wartet auf Melder», Textbausteine und Auswertungen. **Unteraufgaben/Projekte bleiben weiterhin zurückgestellt.**

### Regeln

- **Auslöser** pro Regel wählbar: neue Vorgänge aus Mails, neue Meldungen im Portal und Antworten auf bestehende Vorgänge.
- **Bedingungen:** Absender (Adresse oder ganze Domain), Betreff enthält, Text enthält, Postfach, Absender ist in AD-Gruppe. Mit UND/ODER verknüpfbar. Gross- und Kleinschreibung spielt keine Rolle.
- **Aktionen:** Typ setzen (der Vorgang überspringt den Eingang), Priorität, Zuständig (mit der üblichen Mail), Checklisten-Vorlage (nur Aufgaben), Eingangsbestätigung unterdrücken, Verwerfen.
- Alle passenden Regeln wirken, abgearbeitet von oben nach unten.
- Nur Admin verwaltet die Regeln (Verwaltung → Regeln), Reihenfolge per Ziehen, einzeln ein- und ausschaltbar.
- Jede angewendete Regel hinterlässt einen Timeline-Eintrag.
- Regeln wirken nur auf neue Ereignisse. Eine Vorschau zeigt, was in den letzten 30 Tagen gepasst hätte.
- **Zeitgesteuerte Regeln** (18.10.2026, ersetzen die feste Einstellung «Wartet auf Melder»): Auslöser «Vorgang ist seit N Tagen in einem Status der Kategorie Neu, In Arbeit oder Wartend». Gezählt wird ab dem letzten Statuswechsel. Patchwork prüft alle 15 Minuten, und jede Regel greift pro Vorgang einmal je Status.
  - Aktionen: Priorität und Zuständig, bei «Wartend» zusätzlich «Melder erinnern» und «Schliessen» (erster Status «Erledigt», eigene Mail an den Melder). Wird im selben Durchlauf geschlossen, entfällt die Erinnerung.
  - Die Bedingungen beziehen sich auf den Vorgang: Absender = Melder, Betreff = Titel, Text = Beschreibung, Postfach = Antwort-Postfach.
  - Eine bestehende Einstellung «Wartet auf Melder» wurde beim Update in zwei Regeln umgewandelt.

### Textbausteine

- Vorlagen für Antworten (z.B. «Passwort zurückgesetzt») mit Platzhaltern, z.B. dem Namen des Melders. Im Editor lassen sich die Platzhalter per Knopf an der Cursorposition einfügen.

### Auswertungen

- Nur für Admin, in der Hauptnavigation neben Eingang, Störungen und Aufgaben (seit 18.10.2026, vorher im Benutzermenü).
- Inhalt: neue und abgeschlossene Vorgänge im Verlauf (Störung/Aufgabe getrennt, als Diagramm), offene Vorgänge nach Status, Priorität und Zuständigem, die ältesten offenen Vorgänge, typische Dauer bis «Gelöst» bei Störungen (reine Statistik, keine SLA), die 10 häufigsten Melder. Kein Vergleich «wer hat wie viel erledigt».
- Zeitraum: diese Woche, letzte Woche, dieser Monat, letzter Monat, dieses Quartal, letztes Quartal, dieses Jahr, letztes Jahr oder frei.
- Export: CSV (eine Zeile pro Vorgang), jedes Diagramm als Bild, der ganze Bericht als PDF.

### Etappe 3, Details (bestätigt am 18.10.2026)

- Auslöser einzeln wählbar: neue Mail, neue Portal-Meldung, Antwort per Mail, Antwort im Portal.
- Bedingungen zusätzlich verneinbar («ist nicht», «enthält nicht»). UND/ODER über Gruppen, eine Ebene tief, z.B. (A und B) oder C.
- Bei Antworten wirken nur Priorität und Zuständig, der Typ nur, solange der Vorgang noch im Eingang liegt. Checklisten-Vorlage, Bestätigung unterdrücken und Verwerfen gibt es nur bei neuen Vorgängen.
- Setzen zwei Regeln dasselbe, gilt die untere, weil sie später läuft. «Verwerfen» beendet die Abarbeitung.
- Erinnern und Schliessen (zeitgesteuerte Regeln): gezählt in Kalendertagen. Die Erinnerung geht nur an den Melder. Beim automatischen Schliessen erhält er eine eigene Mail statt der üblichen «Gelöst»-Mail.
- Textbausteine pflegt der Admin (wie die Checklisten-Vorlagen). Platzhalter {{Melder}}, {{Nummer}}, {{Titel}}, {{Bearbeiter}}. Einfügbar in Antworten und Notizen.
- Auswertungen: Die Woche beginnt am Montag. Das Diagramm teilt je nach Zeitraum nach Tagen, Wochen oder Monaten ein. Die CSV-Datei nutzt Semikolons, damit Excel sie in der Schweiz direkt öffnet.

## Darstellung

- Oberfläche nur Deutsch, Schweizer Rechtschreibung (ss statt ß), Datum dd.mm.yyyy.
- Detailansicht eines Vorgangs: zuoberst das Antwortfeld (öffentlich/intern), darunter die Timeline mit dem Neuesten zuoberst, zuunterst die ursprüngliche Meldung.
  - Bei **Aufgaben** steht die Beschreibung zuoberst über den Checklisten (Bezeichnung «Beschreibung»). Bei Störungen und im Eingang bleibt sie als «Ursprüngliche Meldung» zuunterst.
- Farben in der Timeline: interne Notizen orange, öffentliche Nachrichten blau, ursprüngliche Meldung weiss. Gilt auch im Portal.
- Antwortfeld: Feld, Umschalter und Senden-Knopf sind im Modus «Öffentliche Antwort» blau, im Modus «Interne Notiz» orange.

## Rückmeldungen vom 15.10.2026

- **Eigene interne Notizen bearbeiten:** 5 Minuten lang nach dem Erfassen («Bearbeiten» bei der Notiz). Danach steht «bearbeitet» bei der Zeit. Nur in Patchwork erfasste Notizen, keine öffentlichen Antworten (die sind schon per Mail verschickt) und keine per Mail eingegangenen.
- **Änderungen zusammenfassen:** Mehrere Änderungen derselben Person kurz hintereinander (z.B. Status und Priorität) erscheinen als eine Zeile in der Timeline. Gespeichert wird weiterhin jede Änderung einzeln.
- **Antwort-Postfach:** ein Eintrag pro Postfach, das Standard-Postfach mit dem Zusatz «(Standard)». Ohne eigenes Antwort-Postfach ist das Standard-Postfach gewählt.
- **Melder und Beteiligte suchen:** nach Name, Benutzername und E-Mail, in Patchwork und im AD (wenn die LDAP-Anmeldung aktiv ist). Eine unbekannte E-Mail-Adresse lässt sich weiterhin als neuer Kontakt eintragen.
- Details (bestätigt am 15.10.2026):
  - Notizen: Wer die Bearbeitung rechtzeitig beginnt, kann bis 10 Minuten nach dem Erfassen speichern, damit nichts verloren geht. Notizen lassen sich nicht löschen.
  - Zusammengefasst werden Änderungen derselben Person, die höchstens 2 Minuten auseinanderliegen, ohne Nachricht dazwischen. Ablehnungen (mit Begründung) und automatische Statuswechsel stehen immer einzeln.
  - Personensuche: Jedes Suchwort muss vorkommen, die Reihenfolge spielt keine Rolle. Im AD wird ab 2 Zeichen gesucht, höchstens 10 Treffer. Deaktivierte AD-Konten und Konten ohne E-Mail-Adresse erscheinen nicht. Wer aus dem AD gewählt wird, wird als Kontakt mit Namen und E-Mail aus dem AD angelegt.

## Technische Festlegungen (ohne Einfluss aufs Konzept)

- Monorepo mit pnpm-Workspaces: `backend` (NestJS 11, Drizzle ORM, pg-boss 10) und `frontend` (Vue 3, Vite, Pinia).
- Dev-Datenbank: `postgres://patchwork:patchwork@localhost:5432/patchwork`.
- Standardport 8080 (Port 3000 ist unter Windows mit Hyper-V/WSL oft reserviert).
- Sitzungen gelten 14 Tage und verlängern sich bei Nutzung.
- Anhänge: höchstens 25 MB pro Datei, 20 Dateien pro Antwort.
- Nach einem Update fehlen einem noch offenen Browser-Tab die Dateien der alten Version. Die Seite lädt sich dann einmal automatisch neu (beim Seitenwechsel direkt mit dem Ziel), statt «Failed to fetch dynamically imported module» zu zeigen.

## Betrieb (Stand 19.10.2026)

- Patchwork läuft vollständig auf dem Docker-Server, der mit Portainer verwaltet wird: Anwendung, Datenbank und auch Testläufe. Auf dem Laptop läuft nichts, er dient nur zum Bearbeiten und Steuern.
- Das GitHub-Repo ist öffentlich. GitHub Actions prüft bei jedem Push auf `main` Typen und Unit-Tests und baut danach das Image in die GitHub Container Registry (`ghcr.io/lucakuehne/patchwork`). Der Portainer-Stack (`deploy/portainer.yml`) holt es von dort, ohne Zugangsdaten. Interne Namen (Server, Domain) stehen deshalb nicht im Repo, sondern nur in den Variablen des Stacks.
- Bestätigt am 19.10.2026:
  - Zuerst Testbetrieb, mit eigenem PostgreSQL-Container im Stack.
  - Aufruf über einen eigenen DNS-Namen (CNAME auf den Docker-Server), ohne Reverse-Proxy. Patchwork belegt dafür Port 80 des Servers direkt.
  - Gesichert wird über das Sicherungskonzept für den ganzen Host, ohne eigenen `pg_dump`.
  - Smoke-, LDAP- und AD-Tests laufen in einem vorübergehenden Stack «patchwork-test» auf dem Server (`deploy/test-stack.yml`), der danach wieder entfernt wird.
  - Einrichtung über die Portainer-API mit einem Access Token des Benutzers. Die Token-Datei `portainer-token.txt` ist von Git und Docker ausgeschlossen.
  - Neue Versionen gehen erst nach Freigabe durch den Benutzer auf `main` und damit auf den Server.
- Noch zu bestätigen:
  - Vor dem produktiven Betrieb: HTTPS. Ohne HTTPS gehen Passwörter, auch die AD-Passwörter, unverschlüsselt durchs Netz.

## Testbetrieb, Mail-Abruf und Microsoft 365 (Stand 19.10.2026)

Wünsche des Benutzers vom 19.10.2026:

- Patchwork liest Postfächer nur, Mails bleiben ungelesen (umgesetzt, siehe Randfall 2).
- Pro Postfach festlegen, ab welchem Datum und welcher Uhrzeit Mails abgeholt werden.
- Im Testbetrieb bzw. Parallelbetrieb werden keine Mails versendet, aber man sieht, welche versendet worden wären.
- Microsoft 365: Anmeldung interaktiv, ohne Tenant-ID, Client-ID und Client Secret von Hand einzutragen.

Bestätigt am 19.10.2026:

1. Einstellung pro Postfach «Mails abholen ab» (Datum und Uhrzeit), beim Anlegen vorbelegt mit dem aktuellen Zeitpunkt. Sie ersetzt die Regel «beim ersten Abruf nur ungelesene Mails». Übernommen werden alle Mails ab diesem Zeitpunkt, gelesen oder nicht. Massgebend ist der Eingang im Postfach (IMAP INTERNALDATE), nicht das Datum des Absenders.
2. Wird der Zeitpunkt geändert, holt Patchwork ab dem neuen Zeitpunkt alles, was noch fehlt, ohne doppelte Vorgänge.
3. Schalter «Testbetrieb: keine Mails versenden» für die ganze Instanz (Verwaltung → Allgemein), mit Hinweis für alle Benutzer (auch im Portal). Er gilt für alle Mails, auch für Benachrichtigungen an Mitarbeitende.
4. Nicht versendete Mails: Liste unter Verwaltung → «Nicht versendete Mails» (nur Admin) mit vollständiger Ansicht jeder Mail samt Anhängen und .eml, dazu ein Vermerk «nicht versendet» bei öffentlichen Antworten in der Timeline.
5. Beim Ausschalten werden zurückgehaltene Mails nicht nachträglich verschickt, die Liste bleibt als Protokoll.
6. Microsoft 365: Anmeldung pro Postfach mit Gerätecode (microsoft.com/devicelogin): Patchwork zeigt den Code, kopiert ihn und öffnet die Anmeldeseite in einem Popup. Tenant automatisch aus der Mail-Domain, kein Client Secret. Eine Anmeldung mit Weiterleitung zu Patchwork verlangt bei Microsoft HTTPS und folgt erst danach.
7. Einmalige App-Registrierung für die ganze Instanz (öffentlicher Client, einzelner Mandant, delegierte Rechte `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`, `openid`, `profile`, Administratorzustimmung). Ganz automatisch geht es nicht, weil Patchwork für das Anlegen bereits eine Client-ID bräuchte. Die Anleitung steht in der Anwendung (Verwaltung → Postfächer → Microsoft 365), dort trägt man am Schluss die Anwendungs-ID ein.
8. Benutzer-Postfach und freigegebenes Postfach: Es meldet sich das Konto des Postfachs selbst oder ein Konto mit Vollzugriff an (beim freigegebenen Postfach zusätzlich «Senden als»). Verbunden wird immer mit der Adresse des Postfachs. Patchwork zeigt das angemeldete Konto an.
9. Der bisherige App-Zugriff (Client Credentials mit Client Secret) bleibt unter «Erweitert» erhalten.
10. Nur für die Postfächer, keine Anmeldung der Benutzer an Patchwork mit Microsoft.

Zum Vergleich: HelpSpot bietet einen eigenen, im Internet betriebenen Anmeldedienst mit zentraler App (Schlüssel wird zurückkopiert) und als Alternative eine eigene App-Registrierung mit Client Secret und HTTPS-Rücksprungadresse. Es nutzt Microsoft Graph statt IMAP/SMTP – der Ausweg für Patchwork, falls SMTP AUTH im Tenant gesperrt ist.

## Randfälle (bestätigt am 15.10.2026)

Beim Bauen aufgefallene Randfälle:

1. **Mail von Unbeteiligten auf einen bestehenden Vorgang** (z.B. IT antwortet auf eine Benachrichtigung, oder eine fremde Person nennt `[PW-…]` im Betreff): wird als **interne Notiz** erfasst, ändert den Status nicht und macht die Person nicht zum Beteiligten.
2. **Erster Abruf eines Postfachs:** Übernommen werden alle Mails ab dem Zeitpunkt «Mails abholen ab», gelesen oder nicht (geändert am 19.10.2026, vorher nur ungelesene). Verarbeitete Mails bleiben unverändert im Postfach: nicht als gelesen markiert, nicht verschoben, nicht gelöscht (geändert am 19.10.2026, vorher als gelesen markiert). Patchwork öffnet den Ordner nur lesend, erkennt danach neue Mails an der IMAP-UID und bereits übernommene an der Message-ID. Nach einem Wechsel von Server, Ordner, Benutzername oder Startzeitpunkt beginnt der Abruf wieder ab dem Startzeitpunkt, ohne doppelte Vorgänge.
3. **Antworten per Mail:** Der zitierte Verlauf wird entfernt und nur der neue Text angezeigt (als Text, ohne HTML-Formatierung). Die Originalmail (.eml) lässt sich herunterladen. Neue Vorgänge aus Mails zeigen das HTML der Mail.
4. **Antwort des Melders auf eine abgelehnte Aufgabe:** Die Aufgabe bleibt abgelehnt (nur «Wartend» und «Erledigt» öffnen wieder), die Antwort erscheint in der Timeline.
5. **Newsletter und automatische Mails** (List-Header, Auto-Submitted, Abwesenheitsnotizen, Unzustellbarkeit): keine Eingangsbestätigung. Abwesenheitsnotizen ändern den Status nicht und benachrichtigen niemanden.
6. **Intern erfasst für jemand anderen** (z.B. telefonische Meldung): Der Melder erhält eine Eingangsbestätigung mit der Nummer.
7. **Melderwechsel:** Der neue Melder erhält keine Mail.
8. **«Nur meine»** = mir zugewiesen.
9. **Eingang** ist nach Eingang sortiert, neueste zuerst.
