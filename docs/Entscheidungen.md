# Patchwork – Entscheidungen zum Konzept

Ergänzt das [Grundkonzept](../Grundkonzept.md). Stand: 15.10.2026, abgestimmt mit Luca Kühne.

## Umfang MVP

- Zwei Typen mit Typwechsel, Eingang, Tabs mit Liste und Board, E-Mail rein und raus, Login (lokal, LDAP/AD).
- **Kein Import** aus HelpSpot oder Wekan. Am 29.10.2026 für HelpSpot geändert: Import ist umgesetzt, siehe «Import
  aus HelpSpot».
- Patchwork bleibt vorerst privat (keine Lizenzdatei).

## Prioritäten

- Drei Stufen: **Hoch, Normal, Niedrig**. Gelten für beide Typen.
- Störungen: Sortierung «dringend zuerst» nach Priorität.
- Board: Priorität ist nur eine Markierung, die Reihenfolge in einer Spalte wird per Drag & Drop bestimmt.

## Status

- Status sind pro Typ in der Oberfläche bearbeitbar (nur Admin): anlegen, umbenennen, Farbe, sortieren, löschen.
- Texteingaben (Beschreibung, Antworten, Notizen, Ablehnungsgrund) erfolgen über einen WYSIWYG-Editor mit Toolbar, gespeichert wird Markdown.
- **Status ohne Kategorien** (bestätigt am 20.10.2026; ersetzt die bisherigen Kategorien *Neu*, *In Arbeit*, *Wartend*, *Erledigt*, *Abgelehnt* und die Gruppierung danach):
  - Pro Typ eine flache Liste ohne Gruppen. Ihre Reihenfolge gilt für die Spalten des Boards und alle Auswahllisten.
  - Jeder Status hat ausser Name, Farbe und Reihenfolge nur das Häkchen **«abgeschlossen»**. Daran hängen Abschlussdatum, Listen offen/abgeschlossen, Zähler, Board, Portal offen/abgeschlossen, Auswertungen und Duplikate.
  - Pro Typ legt der Block **«Automatische Wechsel»** die Ziel-Status fest:
    - «Neuer Vorgang erhält» (Pflicht, offener Status): intern erfasst ohne Statuswahl, Typ im Eingang zugewiesen, Regelaktion «Typ».
    - «Antwort des Melders führt in» (Pflicht, offen, nicht der Wartet-Status): Antwort des Melders oder eines Beteiligten auf einen Vorgang im Wartet-Status oder in einem abgeschlossenen Status ausser dem Ablehnen-Status.
    - «Automatisch schliessen in» (Pflicht, abgeschlossen, nicht der Ablehnen-Status): Duplikat schliessen und Zeitregel «Schliessen» (ein gemeinsames Ziel).
    - «Ablehnen führt in» (freiwillig, abgeschlossen): Aktion «Ablehnen». Leer heisst: kein Knopf «Ablehnen». Dieser Status ist nur über «Ablehnen» (mit Begründung) erreichbar, nicht über Status-Feld oder Board, und eine Antwort öffnet ihn nicht wieder. Pfeile in diesen Status sind erlaubt (bestätigt am 20.10.2026): Ist «Wechsel von Hand nur gemäss Ablauf» an, gibt es «Ablehnen» nur in Status mit Pfeil dorthin; sonst wie bisher aus jedem Status ausser dem Ablehnen-Status selbst.
    - «Wartet auf den Melder» (freiwillig, offen, höchstens ein Status je Typ, weder Start noch «nach Antwort»): Eine Antwort holt den Vorgang zurück, das Portal hebt ihn hervor, zeitgesteuerte Regeln können erinnern und schliessen.
  - Mail «Erledigt», Rückfrage bei offenen Checklisten-Punkten und Meldung «Behebt»: beim Wechsel von Hand in einen abgeschlossenen Status (ausser dem Ablehnen-Status) aus einem offenen Status oder aus dem Ablehnen-Status. Zwischen zwei abgeschlossenen Status keine Mail.
  - Löschen eines Ziel-Status: Im Lösch-Dialog erscheint das betroffene Pflichtfeld leer, «Löschen» geht erst, wenn ein passender Ersatz gewählt ist. So ist kein Pflichtfeld je leer. Ebenso lässt sich «abgeschlossen» nicht umschalten, wenn ein Ziel dadurch nicht mehr passt.
  - Typwechsel von Hand bei einem Vorgang mit Status: Ein Dialog fragt nach dem Status im neuen Typ, vorbelegt nach Rolle (Start → Start, Wartet → Wartet, sonst «nach Antwort»; übrige offene → «nach Antwort»; Ablehnen → Ablehnen, sonst Schliessen; übrige abgeschlossene → Schliessen). Aus dem Eingang und über die Regelaktion «Typ» ohne Dialog: Start.
  - Zeitgesteuerte Regeln beziehen sich auf konkrete Status (Mehrfachauswahl) und den Eintrag «Wartet auf den Melder (beide Typen)». «Melder erinnern» und «Schliessen» gibt es nur mit diesem Eintrag allein.
  - Das Ablaufdiagramm zeigt die Ziele zusätzlich als Marken (nur Anzeige, ein Klick springt zum Feld).
  - «Neuer Vorgang erhält» wird nur im Diagramm gesetzt (bestätigt am 20.10.2026): Den Startpfeil auf einen anderen offenen Status ziehen (nicht auf den Wartet-Status); das Auswahlfeld im Block «Automatische Wechsel» entfällt. Die übrigen Ziele bleiben Auswahlfelder.
  - Im Portal sieht der Melder den internen Statusnamen (ersetzt die vereinfachte Anzeige), im Eingang «Eingegangen».
  - Übernahme bestehender Daten: «abgeschlossen» = bisher *Erledigt* oder *Abgelehnt*; Ziele = bisher erster Status der Kategorie; die angezeigte Reihenfolge bleibt; zeitgesteuerte Regeln werden übernommen. Ist der Ablauf eines Typs eingeschränkt, erhält der Ablehnen-Status Pfeile aus allen Status, damit «Ablehnen» wie bisher überall geht.
- Standardstatus:
  - Störung: Neu (Start), In Arbeit («nach Antwort»), Wartet auf Melder (Wartet), Gelöst (abgeschlossen, Schliessen). Kein Ablehnen.
  - Aufgabe: Offen (grau, Start), Backlog, Geplant, In Arbeit («nach Antwort»), Erledigt (abgeschlossen, Schliessen), Abgelehnt (abgeschlossen, Ablehnen). Kein Wartet.
  - **Status «Offen»** (bestätigt am 21.10.2026; zuerst als «Angefragt» besprochen): für angefragte Aufgaben, grau, zuvorderst vor dem Backlog und neuer Start-Status der Aufgaben (vorher Backlog). Bestehende Installationen erhalten ihn beim Update, sofern es noch keinen Status «Offen» gibt; die übrigen Status rücken nach, Farben und Ziele bleiben. Dazu Pfeile von «Offen» ins Backlog und in den Ablehnen-Status; sie wirken nur bei «Wechsel von Hand nur gemäss Ablauf» (bestätigt am 21.10.2026). Da Backlog kein Ziel mehr ist, schlägt der Typwechsel einer Aufgabe im Backlog zur Störung «nach Antwort» vor (Regel oben), nicht mehr Start.
- Farben und Ablauf (bestätigt am 20.10.2026):
  - Jeder Status hat eine Farbe aus einer Palette (neu: blau wenn offen, grün wenn abgeschlossen, frei änderbar). Sie gilt für die Anzeige des Status, die Listen, die Spalten des Boards und das Diagramm.
  - Erlaubte Wechsel («von welchem Status wohin») legt man pro Typ in einem bearbeitbaren Ablaufdiagramm fest: Status als Kästchen anordnen, Pfeile ziehen.
  - Die Wechsel gelten nur für Änderungen von Hand: Im Status-Feld und auf dem Board sind nur erlaubte Ziele wählbar. Automatisches (Antwort des Melders, Regeln, zeitgesteuerte Regeln, Ablehnen, Typwechsel, Duplikat) geht immer.
  - Solange nichts festgelegt ist, sind alle Wechsel erlaubt.
  - Seite: je eine Karte für Störung und Aufgabe untereinander, links die Status (anlegen, umbenennen, Farbe, abgeschlossen, Anzahl Vorgänge, löschen, per Ziehen sortieren) und die automatischen Wechsel, rechts das Ablaufdiagramm.
  - Details: Pro Typ ein Häkchen «Wechsel von Hand nur gemäss Ablauf», anfangs aus; so lassen sich Pfeile vorbereiten, ohne dass sie schon gelten. Pfeil ziehen vom Punkt rechts an einem Status auf einen anderen Status (das ganze Kästchen nimmt ihn an), löschen durch Anklicken und Entf oder Doppelklick. Pfeile laufen von Rand zu Rand; gibt es Hin- und Rückweg zwischen zwei Status, sind beide leicht gebogen und liegen nebeneinander. Ein Pfeil in den Ablehnen-Status bestimmt, aus welchen Status «Ablehnen» möglich ist. Ist der Ablauf eingeschränkt, sind Status ohne eingehenden Pfeil (ausser Start) gestrichelt markiert, weil man sie von Hand nicht erreicht. Auf dem Board sind beim Ziehen die nicht erlaubten Spalten abgeblendet. Palette mit zehn Farben, hell und dunkel. Diagramm mit Vue Flow.

## Ansichten

- Tab Störungen: Unteransichten «Offen» und «Gelöst».
- Tab Aufgaben: «Board», «Erledigt», «Abgelehnt». «Erledigt» zeigt abgeschlossene Aufgaben ausser dem Ablehnen-Status, «Abgelehnt» den Ablehnen-Status (ohne Ablehnen-Status entfällt die Ansicht, ein direkter Aufruf führt zu «Erledigt»; bestätigt am 20.10.2026).
- Board: Der Ablehnen-Status ist keine Spalte. Abgeschlossene Spalten zeigen nur die letzten 14 Tage.
- Ansichten für Abgeschlossenes sind Listen mit Suche und Filter «Nur meine».
- Volltextsuche über alle Vorgänge.

## Eingang

- Vorgänge im Eingang haben weder Typ noch Status. Beim Zuweisen erhalten sie den Status «Neuer Vorgang erhält» des Typs.
- «Verwerfen» (Spam, Newsletter): schliesst den Vorgang ohne Typ, bleibt über die Suche auffindbar.

## Benutzer und Rollen

- Drei Rollen: **Admin** (alles wie IT, zusätzlich Einstellungen, Postfächer, Status, Benutzer), **IT** (sieht und bearbeitet alle Vorgänge), **Standard** (normale Benutzer, später Portal).
- Unbekannte Absender (und CC-Empfänger) werden automatisch als Benutzer mit Rolle Standard ohne Login angelegt.
- Im MVP melden sich nur Admin und IT an. Standard-Benutzer laufen nur über Mail.
- Der erste Admin wird über einen **Einrichtungs-Assistenten** im Browser erstellt.
- LDAP/AD: Benutzer wird beim ersten Login angelegt. Je eine konfigurierbare AD-Gruppe für Admin und für IT, alle anderen werden Standard.
- AD-Konten vorab anlegen (bestätigt am 20.10.2026): Unter Verwaltung → Benutzer lässt sich eine Person aus dem AD anlegen, bevor sie sich zum ersten Mal anmeldet, z.B. um ihr schon Vorgänge zuzuweisen. Kein Passwort nötig.
  - Im Dialog «+ Benutzer» sucht man im AD nach Name, Benutzername oder E-Mail. Name und E-Mail kommen aus dem AD, das Konto ist sofort ein LDAP-Konto.
  - Rolle: Das Feld bietet zuerst «Aus AD-Gruppen (zurzeit: …)», vorbelegt, bestimmt wie bei der Anmeldung. Wer eine Rolle von Hand wählt, legt sie dauerhaft fest: Sie bleibt bei jeder Anmeldung, bis man wieder «Aus AD-Gruppen» wählt.
  - Dasselbe Rollen-Feld gilt beim Bearbeiten bestehender AD-Konten. Bestehende Konten bleiben nach dem Update auf «Aus AD-Gruppen».
  - Umgesetzt am 20.10.2026, Details: Die Rolle «Aus AD-Gruppen» wird beim Speichern sofort im AD bestimmt, auch wenn das Konto schon auf «Aus AD-Gruppen» stand (z.B. vorab angelegt, Gruppe seither geändert). Ist das AD dabei nicht erreichbar, bleibt die gespeicherte Rolle bis zur nächsten Anmeldung; nur der Wechsel von «von Hand» zurück verlangt das AD und meldet sonst einen Fehler. Gibt es die Person schon als Kontakt (aus Mails, ohne Login), wird dieser übernommen, wie beim ersten Login. Konten mit Login (LDAP oder lokal mit Passwort) lassen sich nicht doppelt anlegen. Deaktivierte AD-Konten erscheinen nicht. In der Liste steht bei von Hand festgelegten Rollen «von Hand».
- **Als anderer Benutzer arbeiten** (bestätigt am 20.10.2026, z.B. um Antworten und Notizen im Namen eines IT-Mitarbeiters zu testen): Nur Admins, immer verfügbar. Unter Verwaltung → Benutzer im Dialog «Benutzer bearbeiten» der Knopf «Als dieser Benutzer arbeiten», nur für aktive Benutzer mit Rolle IT oder Admin (nicht man selbst). Danach läuft die ganze Sitzung als dieser Benutzer (mit seinen Rechten), oben ein auffälliger Balken «Sie arbeiten als … – Zurück zu …». Einträge, Mails und Benachrichtigungen sind nicht von denen des Benutzers selbst zu unterscheiden (kein Vermerk).
- LDAP/AD-Anmeldung über Simple Bind. Bei Domain Controllern mit LDAP-Signierungspflicht nur über eine verschlüsselte Verbindung: **STARTTLS** (empfohlen, bleibt Port 389) oder LDAPS. Dafür braucht der DC ein Zertifikat. Eine eigene Zertifizierungsstelle kann als CA-Zertifikat hinterlegt werden. LDAP-Signierung per SASL (Kerberos/NTLM) wird nicht unterstützt (Entscheid vom 15.10.2026).

## Mail

- Mehrere Postfächer. Antworten gehen standardmässig über das Postfach, in dem der Vorgang angekommen ist.
  Das Antwort-Postfach ist ein Feld am Vorgang und änderbar. Intern erfasste Vorgänge nutzen das Standard-Postfach.
- Mails an den Melder: Eingangsbestätigung mit Nummer, öffentliche Antworten, Wechsel in einen abgeschlossenen Status (ausser dem Ablehnen-Status, siehe Status).
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
- Der Melder sieht Nummer, Titel, Beschreibung, öffentliche Antworten und Anhänge sowie den Statusnamen (seit 20.10.2026 der interne Name mit seiner Farbe, im Eingang «Eingegangen»; der Wartet-Status ist hervorgehoben). Nicht sichtbar: interne Notizen, Typ, Zuständiger, Beteiligte. Verworfene Vorgänge erscheinen nicht. Den Ablehnungsgrund sieht er nur, wenn «Melder informieren» gewählt war.
- Der Melder kann nur antworten (mit Anhängen), das wirkt wie eine Antwort per Mail. Keine Statusänderung, kein Zurückziehen, kein Bearbeiten.
- Portal freischalten (bestätigt am 20.10.2026): ganz aus, nur für ausgewählte oder für alle.
  - Karte «Portal» unter Verwaltung → Allgemein. «Ausgewählte» sind einzelne Personen (Personensuche wie beim Testbetrieb) und zusätzlich die Mitglieder einer AD-Gruppe.
  - Ohne Zugang wird die Anmeldung abgelehnt, mit dem Hinweis «Das Portal ist für Sie nicht freigeschaltet. Bitte wenden Sie sich per Mail an die IT.». Für IT und Admins ändert sich nichts.
  - In Mails an Melder ohne Zugang entfällt die Link-Zeile zum Portal.
  - Nach dem Update ist das Portal aus (Parallelbetrieb mit HelpSpot).
  - Technisch: Geprüft wird bei der Anmeldung und bei jedem Aufruf im Portal; eine Änderung gilt sofort, auch für laufende Sitzungen. Die Mitgliedschaft in der AD-Gruppe fragt Patchwork über das Dienstkonto im Verzeichnis ab (auch verschachtelt, wie unter LDAP eingestellt) und merkt sie sich 5 Minuten. Antwortet das Verzeichnis nicht, gibt es keinen Zugang.

### Verknüpfungen

- Arten: «Bezieht sich auf» (beidseitig), «Behebt» ↔ «Wird behoben durch», «Duplikat von» ↔ «Hat Duplikat».
- Kein automatisches Schliessen bei «Behebt». Verknüpfen und Lösen erscheinen in beiden Timelines. Wird eine Aufgabe erledigt, die eine Störung behebt, erhält die Störung einen Timeline-Eintrag und ihr Zuständiger eine Mail.
- **«Duplikat von»** (bestätigt am 15.10.2026):
  - Das Duplikat wird automatisch geschlossen (Status «Automatisch schliessen in»; ohne Typ erhält es den Typ des Originals). Statt der Erledigt-Mail erhält sein Melder einen Hinweis aufs Original. Diese Mail läuft unter der Nummer des Originals.
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
- Punkte: Text und offen/abgehakt. Gespeichert wird, wer wann abgehakt hat (sichtbar beim Darüberfahren). Reihenfolge per Ziehen. Seit 21.10.2026 stehen Abhaken und Zurücknehmen im Verlauf (siehe «Aufgaben und interne Erfassung»).
- Fortschritt auf den Board-Karten und in den Listen, seit 21.10.2026 als Balken mit «3/5».
- Wechsel in einen abgeschlossenen Status (ausser dem Ablehnen-Status) mit offenen Punkten nur nach Rückfrage. Beim Ablehnen keine Rückfrage.
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
- **Zeitgesteuerte Regeln** (18.10.2026, ersetzen die feste Einstellung «Wartet auf Melder»): Auslöser «Vorgang ist seit N Tagen in …» (seit 20.10.2026: konkrete offene Status beider Typen und/oder «Wartet auf den Melder (beide Typen)», siehe Status). Gezählt wird ab dem letzten Statuswechsel. Patchwork prüft alle 15 Minuten, und jede Regel greift pro Vorgang einmal je Status.
  - Aktionen: Priorität und Zuständig, nur mit «Wartet auf den Melder» allein zusätzlich «Melder erinnern» und «Schliessen» (Status «Automatisch schliessen in», eigene Mail an den Melder). Wird im selben Durchlauf geschlossen, entfällt die Erinnerung.
  - Wird ein Status gelöscht, den eine Regel nennt, tritt der Ersatzstatus an seine Stelle, wenn er offen ist, sonst fällt der Status aus der Regel; bleibt nichts übrig, wird die Regel ausgeschaltet.
  - Die Bedingungen beziehen sich auf den Vorgang: Absender = Melder, Betreff = Titel, Text = Beschreibung, Postfach = Antwort-Postfach.
  - Eine bestehende Einstellung «Wartet auf Melder» wurde beim Update in zwei Regeln umgewandelt.

### Textbausteine

- Vorlagen für Antworten (z.B. «Passwort zurückgesetzt») mit Platzhaltern, z.B. dem Namen des Melders. Im Editor lassen sich die Platzhalter per Knopf an der Cursorposition einfügen.

### Auswertungen

- Nur für Admin, in der Hauptnavigation neben Eingang, Störungen und Aufgaben (seit 18.10.2026, vorher im Benutzermenü).
- Inhalt: neue und abgeschlossene Vorgänge im Verlauf (Störung/Aufgabe getrennt, als Diagramm), offene Vorgänge nach Status, Priorität und Zuständigem, die ältesten offenen Vorgänge, typische Dauer bis «Gelöst» bei Störungen (reine Statistik, keine SLA), die 10 häufigsten Melder. Kein Vergleich «wer hat wie viel erledigt». Seit 27.10.2026 aufgeteilt nach Störungen, Aufgaben und Alle, siehe Abschnitt «Auswertungen nach Störungen, Aufgaben und Alle».
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
  - Bei Aufgaben trennt eine Linie mit der Beschriftung «Verlauf» die Aufgabe (Beschreibung, Checklisten) vom Antwortfeld und der Timeline (gewünscht am 21.10.2026).
- Farben in der Timeline: interne Notizen orange, öffentliche Nachrichten blau, ursprüngliche Meldung weiss. Gilt auch im Portal.
- Antwortfeld: Feld, Umschalter und Senden-Knopf sind im Modus «Öffentliche Antwort» blau, im Modus «Interne Notiz» orange.
- Editor (gewünscht am 20.10.2026): Die Knöpfe für Listen zeigen drei Punkte bzw. drei Nummern untereinander. Eine Trennlinie gibt es im Editor nicht.
- Knopf «+ Neu» (gewünscht am 20.10.2026): steht im Eingang rechts neben «Nur meine», wie «+ Störung» und «+ Aufgabe» in den anderen Ansichten, nicht mehr in der Kopfzeile. Er öffnet wie bisher «Neuer Vorgang» mit Auswahl des Typs.
- Seitenleiste eines Vorgangs (gewünscht am 20.10.2026): unten «Erstellt», «Aktualisiert» und bei abgeschlossenen Vorgängen «Abgeschlossen».
- Typ in der Seitenleiste (gewünscht am 28.10.2026): Ein «?» neben «Typ» erklärt beim Darüberfahren (oder per
  Tastatur) den Unterschied, mit denselben Leitfragen wie beim Erfassen: Störung «Etwas funktioniert nicht mehr, das
  vorher ging», Aufgabe «Etwas Neues oder Anderes soll gemacht werden». Der Benutzer liess offen, ob «?» oder Karten
  wie beim Erfassen; gewählt ist «?», weil die Karten in der schmalen Seitenleiste untereinander stünden.
- Originalmail (gewünscht am 20.10.2026): «Originalmail» bei einer Nachricht oder der ursprünglichen Meldung öffnet die Mail in einem Fenster (Kopf, Text bzw. bereinigtes HTML ohne externe Bilder, Anhänge). Die .eml-Datei lädt man dort herunter, nicht mehr direkt.
- Bestätigt am 20.10.2026:
  - «Öffentlich» mit Weltkugel und «Intern» mit Schloss, im Umschalter über dem Antwortfeld und ebenso in der Timeline.
  - Einheitliche Kopfzeile aller Einträge der Timeline (Nachrichten, graue Änderungskarten, ursprüngliche Meldung): links Avatar, Name und Art des Eintrags, rechts der Zeitpunkt mit Aktionen wie «Bearbeiten» oder «Originalmail» davor. Regeln und System haben ein Zahnrad als Avatar.
  - Der Knopf «Textbaustein» erscheint weiterhin erst, wenn es Textbausteine gibt. Bilder in Textbausteinen gibt es nicht.

## Meldeweg (bestätigt am 20.10.2026)

- Liste in der Verwaltung pflegbar wie die Status, jeder Meldeweg mit Name und Symbol. Vorbelegt: E-Mail, Portal, Telefon, Persönlich (Walk-In), Teams/Chat, Sonstiges. E-Mail und Portal setzt Patchwork automatisch, sie lassen sich nicht löschen.
- Beim internen Erfassen («+ Neu», «+ Störung», «+ Aufgabe») Pflichtfeld ohne Vorbelegung (seit 21.10.2026 je Typ eine Vorbelegung einstellbar).
- In der Seitenleiste änderbar, mit Eintrag in der Timeline wie bei der Priorität. Angezeigt bei der ursprünglichen Meldung («per Telefon»), in den Listen als eigene Spalte nur mit dem Symbol, in den Auswertungen als Diagramm «Neue Vorgänge nach Meldeweg».
- Bestehende Vorgänge: aus Mails «E-Mail», aus dem Portal «Portal», intern erfasste ohne Angabe («–»), nachtragbar.
- Umgesetzt am 20.10.2026, Details:
  - Symbole aus einer festen Auswahl von zehn (Briefumschlag, Bildschirm, Telefon, Handy, Person, Sprechblase, Videokamera, Dokument, Glocke, Punkte).
  - Beim internen Erfassen steht «Portal» nicht zur Auswahl (setzt Patchwork selbst), «E-Mail» schon (z.B. eine Mail an die eigene Adresse).
  - Löschen wie bei den Status: Wird der Meldeweg verwendet, wählt man einen Ersatz. Simulierte Mails erhalten «E-Mail».
  - In den Listen heisst die Spalte «Meldeweg», sie zeigt nur das Symbol, die Bezeichnung beim Darüberfahren. Im CSV-Export eine eigene Spalte.

## Aufgaben und interne Erfassung (bestätigt am 21.10.2026)

- **Meldeweg «Intern»** mit dem Symbol Glocke für Dinge, die die IT selbst bemerkt und erfasst. Er kommt beim Update in die Liste der Meldewege (ans Ende, nicht, wenn es schon einen Meldeweg «Intern» gibt) und ist änderbar und löschbar wie die übrigen.
- **Vorbelegung je Typ:** Unter Verwaltung → Meldewege wählt man pro Typ (Störung, Aufgabe) einen Meldeweg, der beim internen Erfassen vorbelegt ist, oder keinen. Nach dem Update ist für beide Typen keiner gewählt. Ohne Vorbelegung bleibt der Meldeweg wie bisher ein Pflichtfeld ohne Vorgabe. Wird ein vorbelegter Meldeweg gelöscht, übernimmt der gewählte Ersatz die Vorbelegung.
- **Board-Spalten** übernehmen ganz leicht die Farbe ihres Status statt einfach grau.
- **Fälligkeitsdatum** (optional, nur Aufgaben, ohne Uhrzeit): im Dialog «Neue Aufgabe» und in der Seitenleiste, Änderungen im Verlauf, auf der Board-Karte angezeigt; überfällige offene Aufgaben rot, heute fällige orange. Nicht im Portal. Beim Typwechsel zur Störung bleibt es gespeichert und ausgeblendet wie die Checklisten.
  - **Mail bei Fälligkeit:** am Fälligkeitstag ab 07:00 einmal an den Zuständigen (nicht bei Stummschaltung), nur bei offenen Aufgaben. Wird das Datum später auf heute oder früher gesetzt, kommt die Mail innert 15 Minuten. Ohne Zuständigen keine Mail. Vorlage «Fällig» unter Verwaltung → Mail-Vorlagen (IT).
- **Checklisten im Verlauf** (ersetzt «Kein Timeline-Eintrag pro Haken»): Abhaken und Zurücknehmen eines Punkts stehen im Verlauf, z.B. «Punkt «AD-Konto anlegen» abgehakt». Mehrere Haken derselben Person innert 2 Minuten erscheinen als eine Karte; abgehakt und gleich wieder zurückgenommen fällt weg. Hinzufügen, Umbenennen und Löschen erscheinen nicht.
- **Antworten auf Aufgaben** sind im Antwortfeld standardmässig «Intern». Bei Störungen und im Eingang bleibt «Öffentlich» die Vorgabe.
- **Fortschritt der Checklisten** als schmaler Balken mit kleiner Zahl daneben («3/5»), auf den Board-Karten und in den Listen, statt «☑ 3/5». Auf den Board-Karten füllt der Balken die ganze Breite der Karte (gewünscht am 23.10.2026).
- **Aufgabe in einer Spalte erstellen:** «+» im Kopf jeder offenen Spalte des Boards öffnet «Neue Aufgabe» mit diesem Status vorgewählt. Abgeschlossene Spalten haben kein «+».
- **Board-Karte** (bestätigt am 21.10.2026): ein kleines Text-Symbol, wenn die Aufgabe eine Beschreibung hat, beim Darüberfahren die ersten Zeilen als Text. Dazu eine Sprechblase mit der Anzahl Kommentare: öffentliche Antworten (auch die des Melders) und interne Notizen, ohne Änderungen, automatische Mails und Abwesenheitsnotizen; bei 0 keine.
  - Aufbau seit 28.10.2026 (gewünscht vom Benutzer, gilt für die Boards der Aufgaben und der Störungen): oben links
    die Nummer, rechts die Priorität und ganz rechts das Alter (beim Darüberfahren «Erstellt am …»); darunter der
    Titel, die Fälligkeit in einer eigenen Zeile (nur wenn gesetzt) und der Fortschritt der Checklisten; unten Melder,
    die Symbole für Beschreibung und Kommentare und Zuständig. Lange Namen des Melders werden gekürzt, die obere Zeile
    bricht auch in der schmalsten Spalte (260 px) nicht um. Korrektur vom 28.10.2026: Mit dem Datum in der Zeile der
    Nummer war das Alter («7 Tage») gemeint, nicht die Fälligkeit; die Fälligkeit steht wieder wie vorher unter dem
    Titel, das Alter ganz rechts.
- **Nach dem Erstellen einer Aufgabe** (bestätigt am 21.10.2026) bleibt man, wo man ist (z.B. auf dem Board, die Karte erscheint in ihrer Spalte), mit der Meldung «PW-123 erstellt» und «Öffnen». Gilt für alle neuen Aufgaben, auch über «+ Neu». Neue Störungen öffnen wie bisher.
- **Erwähnen** (bestätigt am 21.10.2026): Mit «@» im Antwortfeld (öffentliche Antworten und interne Notizen, auch beim Bearbeiten einer Notiz) öffnet sich eine Auswahl der IT-Mitarbeitenden und Admins. Die Erwähnung erscheint in Patchwork hervorgehoben. Beim Melder (Mail und Portal) steht sie als gewöhnlicher Text «@Vorname Nachname». Die Erwähnten erhalten eine Mail «Erwähnt» mit dem Text und dem Link (Vorlage unter Verwaltung → Mail-Vorlagen, IT), nicht an sich selbst; beim Bearbeiten einer Notiz nur neu hinzugekommene Erwähnte.
- **Stummschalten ausgeblendet** (bestätigt am 21.10.2026): Die Option «Benachrichtigungen für mich stummschalten» ist vorläufig ausgeblendet. Bestehende Stummschaltungen bleiben gespeichert, wirken aber nicht mehr: Alle erhalten wieder ihre Mails. Wird die Option später wieder eingeblendet, gelten sie wieder.

## Bereiche je Rolle, Status beim Typ «Aufgabe» (bestätigt am 23.10.2026)

- **Bereiche je Rolle:** Unter Verwaltung legt man für die Rolle IT fest, welche Bereiche (Eingang, Störungen, Aufgaben) sie sieht. Admins sehen immer alles. Standard-Benutzer nutzen wie bisher nur das Portal.
  - «Nicht sehen» heisst kein Zugriff: Der Bereich fehlt in Navigation und Zählern, Vorgänge dieses Bereichs (Eingang = ohne Typ) sind gesperrt, auch per Link, und fehlen in Suche und Verknüpfungen.
  - IT-Mitarbeitende ohne Zugriff bleiben bei solchen Vorgängen als Zuständige wählbar und erwähnbar, öffnen können sie sie aber nicht, und sie erhalten dazu keine Mails (Zugewiesen, Neue Antwort, Fällig, Erwähnt …), auch nicht als Beteiligte (CC).
  - Details (bestätigt am 23.10.2026):
    - Die Einstellung steht unter Verwaltung → Benutzer als Karte «Bereiche der IT». Mindestens ein Bereich bleibt gewählt; nach dem Anmelden landet die IT im ersten sichtbaren Bereich.
    - Die IT kann einen Vorgang nicht in einen Bereich verschieben, den sie nicht sieht: Typen ohne Zugriff stehen beim Erfassen und beim Typwechsel nicht zur Wahl.
    - Verweise auf gesperrte Vorgänge (Verknüpfungen, Duplikate im Verlauf) zeigen nur die Nummer, ohne Titel und nicht anklickbar.
    - Antwortet jemand aus der IT per Mail auf einen Vorgang ohne Zugriff (z.B. auf eine alte Benachrichtigung), wird die Mail wie bisher als interne Notiz angenommen.
- **Status beim Typ «Aufgabe»:** Wird ein Vorgang von Hand zur Aufgabe (aus dem Eingang oder von einer Störung umklassiert), öffnet sich immer ein Dialog mit den Status der Aufgaben (ohne Ablehnen-Status) ohne Vorauswahl; erst nach der Wahl wird der Typ gesetzt. Bei Störungen bleibt es wie bisher.
  - Regeln mit der Aktion «Typ: Aufgabe» wählen den Status in der Regel (Pflicht), alle Status der Aufgaben ausser dem Ablehnen-Status (bestätigt am 23.10.2026). Bestehende Regeln erhalten den Start-Status der Aufgaben (Backlog). Setzt eine Regel einen abgeschlossenen Status, erhält der Melder nach der Eingangsbestätigung auch die Mail «Erledigt». Wird der Status einer Regel gelöscht, erhält die Regel den Ersatzstatus bzw. den Start-Status der Aufgaben.
- **Status «Offen» entfällt** (ersetzt die Entscheidung vom 21.10.2026): Aufgaben in «Offen» kommen nach «Backlog», «Backlog» wird wieder Start-Status, «Offen» wird gelöscht, auch aus den Standardstatus neuer Installationen.
- Umgesetzt am 23.10.2026, technisch:
  - Migration 0030: Aufgaben, Ziele, Pfeile und zeitgesteuerte Regeln von «Offen» gehen auf das Backlog (fehlt es, auf den ersten übrigen offenen Status ausser dem Wartet-Status), dann wird «Offen» gelöscht. Bestehende Regeln mit «Typ: Aufgabe» erhalten den Start-Status der Aufgaben.
  - Bereiche: Einstellung `areas` (`{ it: [...] }`). Der AuthGuard prüft jede Route mit `:number` (seit 29.10.2026 `:ref`, die Kennung); Anhänge, Notizen und Checklisten (über ihre ID), Listen, Zähler, Suche, Verknüpfungen und aus anderen Vorgängen kopierte Bilder prüfen selbst. Mails an die IT laufen über eine Stelle, die ohne Zugriff nichts versendet; Beteiligte ohne Zugriff fallen aus dem CC.
  - Gesperrte Vorgänge antworten mit 403 «Kein Zugriff auf den Bereich …», die Oberfläche zeigt «PW-… ist für Sie gesperrt».

## Import aus HelpSpot (umgesetzt am 29.10.2026)

Alte HelpSpot-Tickets werden oft als Wissensquelle gebraucht; mit dem Import lässt sich HelpSpot nach dem Umstieg
abschalten.

- Bestätigt: Die Tickets werden **normale, abgeschlossene Vorgänge** in Patchwork, sofern sich das sauber umsetzen lässt;
  sonst ein eigener, nur lesbarer Bereich «HelpSpot-Archiv». Ein statisches Archiv ausserhalb von Patchwork kommt nicht
  in Frage.
- Bestätigt: Alle Tickets mit Verlauf und Anhängen, ohne Papierkorb und Spam. Sichtbar nur für IT und Admins, nicht für
  Melder im Portal. Interne Notizen aus HelpSpot werden übernommen und bleiben intern.
- Technisch: Quelle ist die Web Services API von HelpSpot (`private.request.get` mit Verlauf, öffentlich/intern und
  Anhängen, `private.document.get` für die Dateien, `private.request.getChanged` für Nachträge). Beim Import lösen keine
  Regeln, Benachrichtigungen oder Mails aus. Der API-Schlüssel kommt nicht ins Repo.
- Auswertung vom 29.10.2026 (nur lesend über die API): rund 5'400 Tickets (Nummern 12400–18233, seit 2021), 23 offen;
  Status fast alle «Problem Solved»; Pflichtfeld «Type» mit Incident (rund 80 %), Changes, Project oder leer; Kategorien
  durchgehend gesetzt, übrige Zusatzfelder praktisch leer; im Mittel 6 Einträge und ein Anhang pro Ticket, Anhänge
  total rund 0,5 GB; Betreff der Mails «… - Ticket:{12345}»; die API bremst (HTTP 429), der erste Import dauert
  deshalb einige Stunden.
- Bestätigt am 29.10.2026:
  - Die HelpSpot-Nummer ist durchsuchbar (zu den Nummern siehe unten).
  - «Alle Tickets werden Störungen» ist ersetzt durch die Zuordnung der Typen (unten).
  - Importierte Vorgänge zählen in den Auswertungen nicht mit.
  - Einträge ehemaliger Mitarbeitender zeigen den Namen aus HelpSpot, ohne Konto in Patchwork; Mitarbeitende mit Konto
    werden über die E-Mail-Adresse zugeordnet.
  - Seite «HelpSpot-Import» in der Verwaltung (nur Admins) mit Adresse und API-Schlüssel (verschlüsselt), Import,
    Fortschritt und Ergebnis. Sie bleibt dauerhaft (gehört zum Funktionsumfang): Import jederzeit wiederholbar,
    bereits importierte Tickets werden aktualisiert statt doppelt angelegt, Verlauf der Importe.
- Bestätigt am 29.10.2026: **Zuordnung der Status** auf der Seite «HelpSpot-Import»: jeder HelpSpot-Status bekommt einen
  Status der Störungen, vorgefüllt (geschlossene auf den Schliessen-Status, «kein Problem» o.ä. auf den Ablehnen-Status,
  offene auf den Start-Status); geschlossene Tickets nur auf abgeschlossene Status, offene nur auf offene. Der
  ursprüngliche HelpSpot-Status bleibt als Angabe im Vorgang.
- Bestätigt am 29.10.2026: **Zuordnung der Typen** auf der Seite «HelpSpot-Import»: jeder Wert des HelpSpot-Felds «Type»
  bekommt Störung oder Aufgabe (vorgefüllt: Incident und leer → Störung, Changes und Project → Aufgabe); die
  Zuordnung der Status gilt je Typ.
- Bestätigt am 29.10.2026: **Zuordnung der Meldewege** («Eröffnet über» in HelpSpot), vorgefüllt: Mail → Meldeweg der
  Mails, Telefon → «Telefon».
- Bestätigt am 29.10.2026: Kategorien und Zusatzfelder aus HelpSpot werden nicht übernommen. Bekommt Patchwork später
  Kategorien, wird das Nachtragen neu überlegt.
- Bestätigt am 29.10.2026: **Nummern mit Präfix HS** – ein importiertes Ticket behält seine HelpSpot-Nummer mit dem
  Präfix «HS» (Ticket 17223 → HS-17223), neue Vorgänge bleiben «PW-…».
- Bestätigt am 29.10.2026 (nach dem Einwand, ein gemeinsamer Zahlenraum kreuze sich bei vielen Tickets): **Präfix und
  Nummer bilden zusammen die Kennung**, jeder Präfix hat seinen eigenen Nummernkreis (PW-17223
  und HS-17223 können nebeneinander bestehen). Adressen und Programmierschnittstelle enthalten die volle Kennung
  (`/items/PW-123`, `/items/HS-17223`, Fenster `?item=HS-17223`); Links ohne Präfix (`/items/123`, `/v/123`,
  `?item=123`) gelten als PW und funktionieren weiter. Betreff ([HS-17223]), Links im Text, Suche (auch nur «17223»)
  und die Zuordnung von Antworten ([HS-17223] oder «Ticket:{17223}») arbeiten mit der vollen Kennung. Umsetzung als
  eigener Schritt vor dem Import.
  - Technisch (umgesetzt am 29.10.2026): Spalte `items.prefix` (Standard «PW»), eindeutig ist «Präfix + Nummer»
    (Migration 0037); die Sequenz der Nummer zählt für PW. Routen `items/:ref` mit der Kennung (ohne Präfix PW). Verweise
    in `entries.meta` speichern zur Nummer den Präfix (`otherPrefix`, `mergedFromPrefix`, `duplicateOfPrefix`,
    `viaDuplicatePrefix`), ältere ohne Präfix gelten als PW. Kennungen im Text werden in der Oberfläche zu Links (nicht im
    Portal, nicht in Code oder bestehenden Links); ein Klick öffnet den Vorgang als Seite.
- Bestätigt am 29.10.2026: Die Rohdaten jedes Tickets werden beim Import unsichtbar mitgespeichert (wenige MB), damit
  sich nach dem Abschalten von HelpSpot noch etwas nachtragen lässt (z.B. Kategorien).
- Für den Umstieg: Während der Parallelphase entstehen aus denselben Mails Vorgänge in beiden Systemen; der Import
  erkennt sie über die Message-ID der ersten Mail.
- Bestätigt am 29.10.2026: **Offene HelpSpot-Tickets** werden am Stichtag mit dem letzten Import als offene Vorgänge
  übernommen (Status nach Zuordnung, Zuständige übernommen); vorher möglichst viele in HelpSpot abschliessen. HelpSpot
  holt ab dem Stichtag keine Mails mehr ab. Antworten auf alte HelpSpot-Tickets landen im importierten Vorgang, auch bei
  geschlossenen, die dann wie gewohnt wieder öffnen. Beim Import keine Mails «Zugewiesen»; zeitgesteuerte Regeln
  zählen für importierte offene Vorgänge ab dem Import.
- Umgesetzt am 29.10.2026 (Verwaltung → HelpSpot-Import):
  - Verbindung (Adresse, API-Schlüssel verschlüsselt), «Verbindung prüfen und Werte laden» zählt Status (mit
    offen/geschlossen), Werte von «Type» und «Eröffnet über»; die Zuordnungen zeigen je Wert die Anzahl Tickets.
  - Der Import läuft im Hintergrund in Patchwork, gebremst auf etwa eine Anfrage pro Sekunde, bei HTTP 429 wartet er
    und versucht es erneut. Fortschritt und Verlauf der Läufe stehen auf der Seite. Ein Neustart von Patchwork bricht
    einen Lauf ab; der nächste holt alles seit dem letzten vollständigen Lauf.
  - Priorität: «Urgent» in HelpSpot → Hoch. Zeiten in der Zeitzone Zürich, auf die Minute. Ein Vorgang, der seit dem
    letzten Import in Patchwork geändert wurde, behält seine Angaben; neue Einträge aus HelpSpot kommen trotzdem dazu.
  - Technisch: Tabellen `helpspot_tickets` (Rohdaten, Status und Melder laut HelpSpot, Message-ID der ersten Mail) und
    `helpspot_import_runs`, `entries.external_id` («hs:<Eintrag>») und `attachments.external_id` («hs-doc:<Anhang>»)
    gegen Doppelte (Migration 0038).
  - Bestätigt am 29.10.2026: Melder ohne E-Mail-Adresse in HelpSpot (rund 2 %, v.a. Anrufe) erhalten den gemeinsamen Kontakt
    «Ohne E-Mail (HelpSpot)»; der Name laut HelpSpot steht im Vorgang («Melder laut HelpSpot: …»).
  - Bestätigt am 29.10.2026: Einträge von Personen ohne Konto in Patchwork (ehemalige Mitarbeitende, Beteiligte) zeigen den
    Namen aus HelpSpot; Antworten des Melders gehören seinem Kontakt. Änderungen aus HelpSpot («Request Changed»)
    erscheinen als graue Zeile «in HelpSpot geändert: …». Im Vorgang steht «Aus HelpSpot übernommen · Status in
    HelpSpot «…»», Einträge tragen «aus HelpSpot» und lassen sich nicht bearbeiten.
  - Bestätigt am 29.10.2026: Mails an Melder zu HS-Vorgängen ohne Link-Zeile zum Portal, weil das Portal sie nicht zeigt.
- Bestätigt am 30.10.2026: **Umfang eines Laufs** wählbar: «Nur geschlossene Tickets» (Probeimport, bis zum Stichtag) oder
  «Geschlossene und offene Tickets» (am Stichtag). Mit offenen holt der Lauf alle offenen Tickets, auch die seit dem
  letzten Lauf unveränderten, weil frühere Läufe sie ausgelassen haben. Ohne offene lässt er sie aus; ein früher
  übernommenes Ticket, das in HelpSpot wieder offen ist, bleibt bis zum Stichtag auf dem Stand des letzten Imports.
  - Bestätigt am 30.10.2026: Vorgewählt ist immer «Nur geschlossene Tickets»; «Geschlossene und offene» fragt vor dem Start
    nach. Der Verlauf zeigt den Umfang je Lauf und die Anzahl ausgelassener offener Tickets.
  - Technisch: `helpspot_import_runs.include_open` und `skipped_open` (Migration 0039); die offenen Tickets kommen
    über die Suche je Status wie die Übersicht.
- **Umstieg von HelpSpot** (bestätigt am 29.10.2026):
  - Vorbereitung: Import bauen und prüfen; Probeimport in der Produktion mit allen geschlossenen Tickets (läuft einige
    Stunden im Hintergrund). Kein automatisches Nachziehen (bestätigt am 29.10.2026): «Importieren» holt bei jedem Lauf nur, was sich seit dem
    letzten geändert hat, und lässt sich jederzeit von Hand starten. Offene HelpSpot-Tickets möglichst abschliessen.
  - Mit dem Probeimport wird der Mail-Abruf in Patchwork ausgeschaltet (Verwaltung → Postfächer → Mail-Abruf); bis zum
    Stichtag kommen keine Mails in Patchwork an (auch keine Antworten auf Mails von Patchwork). Deshalb braucht es keinen Schalter: Antworten mit
    «Ticket:{12345}» ordnet Patchwork immer dem HS-Vorgang zu.
  - Stichtag (an einem Morgen, Datum noch offen, Admin anwesend): 1. In HelpSpot den Mail-Abruf ausschalten. 2. Die
    Regel im Postfach löschen, die nach «Inbox-Patchwork» kopiert; in Patchwork den Posteingang wählen, «Mails abholen
    ab» = Stichtag, Mail-Abruf wieder einschalten. 3. Letzter Import mit «Geschlossene und offene Tickets». 4. Kopien aus der Parallelphase
    bereinigen. 5. Testbetrieb in allen Blöcken auf «an alle». 6. Kontrolle: Testmail, Antwort auf ein altes Ticket,
    Mail an einen Melder. Das Portal bleibt aus und kommt später.
  - Kopien aus der Parallelphase (dieselbe erste Mail in Patchwork und HelpSpot, erkannt über die Message-ID): beim
    Stichtag ohne Mails geschlossen bzw. verworfen und mit dem HS-Vorgang verknüpft.
  - Bestätigt am 30.10.2026 (ersetzt «immer die Kopie schliessen»): Beim Bereinigen wählt man **je Paar, welcher
    Vorgang bleibt**; der andere wird ohne Mails geschlossen (im Eingang verworfen) und als «Duplikat von» mit dem
    bleibenden verknüpft. Vorschlag: Der Vorgang aus Patchwork bleibt, wenn er eine Aufgabe ist oder Antworten bzw.
    Notizen der IT hat (seit dem 28.10.2026 laufen die Aufgaben in Patchwork), sonst der HS-Vorgang. Bleibt der Vorgang
    aus Patchwork, landen Antworten mit «Ticket:{12345}» über die Umleitung des Duplikats bei ihm.
  - Bestätigt am 30.10.2026: Je Paar gibt es zusätzlich «nicht bereinigen»; solche Paare bleiben unverändert in der Liste.
    Vor dem Bereinigen fragt Patchwork mit der Anzahl, wie viele Vorgänge aus Patchwork bzw. HelpSpot geschlossen werden.
    Ist die Kopie im Eingang verworfen, ist «HS-Vorgang bleibt» vorgeschlagen, auch mit Notizen der IT (Antworten landen
    nie bei einem verworfenen Vorgang).
  - Danach: HelpSpot etwa eine Woche nur noch lesbar (ohne Mail-Abruf), dann abschalten; Sicherung der
    HelpSpot-Datenbank aufbewahren.

## Mail-Abruf ein und aus (bestätigt am 30.10.2026)

- Unter Verwaltung → Postfächer lässt sich der Mail-Abruf für alle Postfächer ein- und ausschalten (Anlass: Probeimport
  aus HelpSpot bis zum Stichtag). Ausgeschaltet holt Patchwork keine Mails ab, der Versand läuft weiter. Den Haken
  «Aktiv» beim Postfach braucht es dafür nicht; ein inaktives Postfach versendet auch nicht.
- Bestätigt am 30.10.2026:
  - Auch «Jetzt abrufen» ist gesperrt, solange der Abruf aus ist.
  - Admins sehen oben den Balken «Mail-Abruf ausgeschaltet» mit Link zu den Postfächern; Störungen des Abrufs zeigt er
    dann nicht.
  - Beim Einschalten holt Patchwork nach, was seit dem letzten Abruf im gewählten Ordner angekommen ist (wie nach einem
    Ausfall). Soll das nicht geschehen, vorher «Mails abholen ab» beim Postfach anpassen.
- Technisch: Einstellung `mailFetch`; `MAIL_POLLING=false` schaltet weiterhin den Abruf jede Minute ab (Test-Stack).

## Testbetrieb je Typ, im Namen anderer antworten, Backlog im Board (bestätigt am 28.10.2026)

- **Testbetrieb je Vorgangstyp** (ergänzt Punkt 14 unter «Testbetrieb, Mail-Abruf und Microsoft 365»): Unter
  Verwaltung → Ausgehende Mails gibt es drei vollständige Blöcke «Generell», «Störungen» und «Aufgaben», jeder mit
  beiden Empfängerkreisen (IT-Mitarbeitende; Melder, Beteiligte und alle übrigen) und einer eigenen Auswahl an
  Personen. Massgebend ist der Typ des Vorgangs beim Versand. «Generell» gilt für Mails zu Vorgängen ohne Typ (Eingang,
  z.B. Eingangsbestätigung) und für Mails ohne Vorgang (Willkommen). Normaler Betrieb ist, wenn in allen drei Blöcken
  beide Kreise auf «an alle» stehen. Nach dem Update gilt die bisherige Einstellung für alle drei Blöcke.
  - Bestätigt am 29.10.2026: Der Hinweis oben sagt im Testbetrieb immer nur «Testbetrieb: Es werden nicht alle Mails
    versendet.» (Admins mit Link auf die nicht versendeten Mails), nicht je Block. Die Übersicht je Block steht unter
    Verwaltung → Ausgehende Mails neben «Speichern» (z.B. «Generell: keine Mails. Störungen: nur an ausgewählte
    IT-Mitarbeitende. Aufgaben: alle Mails.»). Der Vermerk zum Testbetrieb im Antwortfeld richtet sich nach dem Block
    des Vorgangs. «Antwort simulieren» gibt es, solange mindestens ein Block im Testbetrieb ist.
- **Antworten und Notizen im Namen eines anderen Benutzers:** Admins wählen im Antwortfeld unter «Als» eine andere
  Person (aktive Benutzer mit der Rolle IT oder Admin), für öffentliche Antworten und interne Notizen. Vorgabe ist man
  selbst; nach dem Senden steht die Auswahl wieder auf einem selbst. Die gewählte Person gilt als Autor: im Verlauf,
  bei den Platzhaltern {{Bearbeiter …}} der Textbausteine und bei Mails (die Person selbst bekommt weder die Antwort
  noch die Mail «Erwähnt», in «Erwähnt» steht ihr Name). Intern steht beim Darüberfahren über den Namen «erfasst von …»
  mit dem Admin; Melder sehen das weder im Portal (dort wie jede Antwort der IT als «IT») noch in der Mail.
  - Bestätigt am 29.10.2026: Eine solche Notiz können in den ersten 3 Minuten die gewählte Person und der Admin
    bearbeiten, der sie erfasst hat (dieselbe Frist wie für alle Notizen).
  - Technisch: Spalte `entries.recorded_by_id` (nur gesetzt, wenn jemand im Namen eines anderen schreibt).
- **Backlog im Board:** Karten im Start-Status der Aufgaben (Standard «Backlog») sind leicht ausgegraut wie die
  abgeschlossenen (Titel grau). Nur im Board der Aufgaben.
- **Diagnose unter Verwaltung → LDAP** (bestätigt am 29.10.2026): Der Schritt «Benutzerfilter» warnt nur noch, wenn
  kein Konto im Filter eine E-Mail hat. Haben die ersten 5 Konten keine (oft Systemkonten wie Administrator, Guest,
  krbtgt), sucht er gezielt nach Konten mit E-Mail, nennt diese als Beispiel und weist darauf hin, dass sich Konten ohne
  E-Mail nicht anmelden können.
- **Englische Adressen** (gewünscht am 28.10.2026): Pfade und Query-Parameter der Oberfläche sind englisch, z.B.
  `/inbox`, `/incidents`, `/incidents/resolved`, `/tasks`, `/tasks/done`, `/tasks/rejected`, `/search`, `/settings`,
  `/setup`, `/reports`, `/items/PW-123` (bisher `/v/123`), `/portal/new`, `/portal/items/PW-123`, `/admin/general`,
  `/admin/users`, `/admin/mailboxes`, `/admin/incoming-mails`, `/admin/outgoing-mails`, `/admin/mail-templates`,
  `/admin/statuses`, `/admin/channels`, `/admin/rules`, `/admin/checklist-templates`, `/admin/snippets`; Parameter
  `?item=` (Fenster), `?next=` (nach der Anmeldung), `?result=`, `?origin=` und `?status=` mit englischen Werten. Links in
  neuen Mails zeigen auf `/items/…` bzw. `/portal/items/…`.
  - Frühere deutsche Adressen (Lesezeichen, Links in bereits versendeten Mails) führen auf die neuen weiter, mit
    umbenannten Parametern und Werten.
  - Ebenso englisch: Bezeichner und Testdaten-IDs in Tests, die CSS-Klasse des Signets (`.mark`). Deutsch bleiben die
    Platzhalter der Mail-Vorlagen und Textbausteine, weil Admins sie eintippen.

## Farbschema hell oder dunkel (bestätigt am 28.10.2026)

- Unter «Einstellungen» (Benutzermenü) steht zuoberst der Block «Darstellung» mit dem Farbschema **Automatisch | Hell |
  Dunkel**. Standard «Automatisch»: wie Windows bzw. der Browser (so wie bisher), ein Wechsel des Systems gilt sofort.
  Im Benutzermenü selbst gibt es keinen Umschalter.
- Die Wahl gehört zum Benutzerkonto und gilt auf jedem Gerät. Die Anmeldeseite (vor dem Login) zeigt das zuletzt in
  diesem Browser gewählte Schema.
- Melder im Portal wählen das Farbschema im Menü beim Namen rechts oben («Darstellung» und «Abmelden»), das Portal hat
  keine Seite «Einstellungen».
- Hell bleiben wie bisher: von Patchwork versendete Mails in der Ansicht und Exporte der Auswertungen (Bild, PDF).
  Empfangene Mails erscheinen im dunklen Schema ohne Hintergrund- und Schriftfarben aus HTML-Attributen (`bgcolor`,
  `<font color>`), damit sie lesbar bleiben (Farben aus `style` entfernt Patchwork schon immer).
- Arbeitet ein Admin «als dieser Benutzer», gilt das Farbschema dieses Benutzers (wie Board oder Liste); eine Änderung
  in dieser Zeit speichert es für ihn.
- Technisch: `theme` in `users.preferences` (keine Migration), `GET/PUT /api/me/preferences` auch für Melder im Portal.
  Am `<html>` steht das wirksame Schema als `data-theme` (`light` oder `dark`), gesetzt von `src/theme.ts` und schon vor
  dem Start des Programms von einem kleinen Skript in `index.html` aus dem Speicher des Browsers (`patchwork.theme`),
  damit nichts hell aufblitzt. Das Logo (`<img>`) folgt dem Schema der Seite. Diagramme zeichnen sich beim Wechsel neu.
  Das Benutzermenü ist eine gemeinsame Komponente (`UserMenu`) für Kopfzeile und Portal.

## Auswertungen nach Störungen, Aufgaben und Alle; Zähler der Aufgaben (bestätigt am 27.10.2026)

- **Umschalter** «Störungen | Aufgaben | Alle» oben neben dem Zeitraum, die letzte Wahl merkt sich der Browser, zuerst
  «Alle». PDF und CSV enthalten nur die gewählte Ansicht.
- **Karten je Ansicht:**

  | Karte | Störungen | Aufgaben | Alle |
  |---|---|---|---|
  | Neue Vorgänge | ✓ | ✓ | ✓ mit Eingang |
  | Abgeschlossen | «Gelöst» | «Erledigt» und «Abgelehnt» getrennt | ✓ |
  | Aktuell offen | ✓ | ohne Backlog, dazu Kennzahl Backlog | ✓ mit Eingang |
  | Typische Dauer bis «Gelöst» | ✓ | – (dafür Durchlaufzeit) | – |
  | Neu und abgeschlossen im Verlauf | Neu und Gelöst | Neu, Erledigt und Abgelehnt | nach Typ |
  | Offen nach Status | ✓ | ✓ mit Backlog | ✓ mit Eingang |
  | Offen nach Zuständigem | ✓ | ohne Backlog | nach Typ gestapelt |
  | Offen nach Priorität | ✓ | ✓ | je Typ und gesamt |
  | Neu nach Meldeweg | ✓ | ✓ | nach Typ gestapelt |
  | Häufigste Melder | ✓ | ✓ | ✓ |
  | Älteste offene (über 30 Tage) | ✓ | ohne Backlog | ✓ mit Eingang |

- **Neue Karten:** Störungen: «Erste Antwort» (typische Zeit bis zur ersten öffentlichen Antwort aus Patchwork),
  «Dauer bis «Gelöst» je Priorität», «Wiedereröffnet» (gelöste Störungen, die im Zeitraum wieder aufgingen). Aufgaben:
  «Überfällig» (offene Aufgaben mit Fälligkeit vor heute, Kennzahl und Liste), «Durchlaufzeit» (vom Verlassen des
  Backlogs bis «Erledigt»). Alle: «Verworfen» (im Zeitraum eingegangen und verworfen) und «Zeit bis zur Zuordnung» aus dem
  Eingang.
- **Zähler bei «Aufgaben»** in der Hauptnavigation ohne die Aufgaben im Backlog. Als Backlog gilt der Start-Status der
  Aufgaben (Verwaltung → Status, «Neue Aufgabe erhält»), nicht der Name; Liste und Board zeigen das Backlog weiterhin.
- Technisch:
  - Erste Antwort: erste Antwort aus Patchwork (nicht per Mail oder Portal, nicht vom Melder selbst), gezählt, wenn sie
    im Zeitraum liegt. Durchlaufzeit: Aufgaben, die im Zeitraum abgeschlossen wurden (ohne Ablehnen-Status), ab dem
    ersten Wechsel aus dem Start-Status; war eine Aufgabe nie dort, ab der Zuordnung zur Aufgabe bzw. der Erfassung.
    Zeit bis zur Zuordnung: erster Typwechsel aus dem Eingang durch eine Person (Regeln zählen nicht), im Zeitraum.
  - Statuswechsel im Verlauf speichern ab jetzt neben den Namen auch die IDs (`fromId`, `toId`). Ältere Einträge ordnen
    die Auswertungen über den Namen im Typ des Vorgangs zu; nach einem Umbenennen fehlen sie bei «Wiedereröffnet» und
    «Durchlaufzeit». Statuswechsel durch Regeln stehen nur als Text im Verlauf und zählen dort nicht.

## Logo und Signet (bestätigt am 27.10.2026)

- **Signet:** das bisherige Symbol (blaues Quadrat mit vier Kacheln), als Favicon im Browser-Tab.
- **Logo:** Signet und Schriftzug «Patchwork» in Akzentblau (Manrope ExtraBold), ein Bild, kein Text neben dem Signet.
  Es erscheint überall dort, wo bisher der Name stand: Kopfzeile, Kopfzeile des Portals, Anmeldeseite und
  Ersteinrichtung. Auf schmalen Bildschirmen zeigen die Kopfzeilen nur das Signet.
- Das Logo zeigt immer «Patchwork», auch wenn unter Verwaltung → Allgemein ein anderer Name eingestellt ist. Der Name
  erscheint im Browser-Tab, in Auswertungen und als Absender von Mails, wenn das Postfach keinen Namen hat.
- Ein **eigenes Logo** (Verwaltung → Allgemein) ersetzt Signet und Schriftzug in der Oberfläche, ohne Namen daneben. Das
  Favicon bleibt das Signet.
- Das Logo steht auch oben im README.
- Technisch: `frontend/public/logo.svg` mit dem Schriftzug als Pfade (unabhängig von installierten Schriften, Manrope
  steht unter der SIL Open Font License), im dunklen Farbschema ist der Schriftzug heller (#6d8dff, wie der Akzent),
  das Signet bleibt gleich. Komponente `AppLogo`.

## Zuletzt aktiv, Zeit interner Notizen anpassen (bestätigt am 27.10.2026)

- **Zuletzt aktiv:** Unter Verwaltung → Benutzer steht neben «Letzte Anmeldung» die Spalte «Zuletzt aktiv» (Datum und
  Uhrzeit), für alle Benutzer, auch Melder im Portal. Als Aktivität zählen echte Aktionen (Seite oder Vorgang öffnen,
  speichern, antworten …), nicht das automatische Nachladen eines offenen Tabs. Arbeitet ein Admin «als dieser
  Benutzer», ist der Admin aktiv, nicht der Benutzer.
  - Technisch: Spalte `users.last_active_at`, gesetzt bei der Anmeldung und bei Anfragen mit Sitzung, höchstens einmal
    pro Minute geschrieben. Automatisches Nachladen (Zähler alle 30 s, Hinweisbalken, Nachladen während des Versands)
    sendet den Header `X-Patchwork-Background` und zählt nicht. Migration 0034 übernimmt für bestehende Konten die letzte
    Anmeldung.
- **Zeit interner Notizen anpassen:** Admins können bei allen internen Notizen (alle Autoren, auch per Mail
  eingegangene) jederzeit Datum und Uhrzeit ändern, «Zeit anpassen» an der Notiz. Erlaubt ist jede Zeit bis jetzt, auch
  vor der Erfassung des Vorgangs, nicht in der Zukunft. Die Notiz rückt im Verlauf an die neue Stelle und zeigt
  «Zeit angepasst»; beim Darüberfahren die ursprüngliche Zeit und welcher Admin sie wann angepasst hat. Öffentliche
  Antworten nie (sie sind als Mail verschickt).
  - Technisch: `entries.created_at` ist die neue Zeit; `original_created_at` (bleibt bei weiteren Anpassungen),
    `time_changed_at` und `time_changed_by_id` halten die Anpassung fest (Migration 0035). Die Frist zum Bearbeiten
    eigener Notizen zählt ab der ursprünglichen Zeit.

## Board oder Liste, Vorgang als Seite oder Fenster (bestätigt am 27.10.2026)

- **Board oder Liste:** Offene Störungen und offene Aufgaben lassen sich jeweils als Board (Kanban) oder als Liste
  anzeigen, Umschalter in der Kopfzeile. Abgeschlossene (Gelöst, Erledigt, Abgelehnt) nur als Liste. Standard: Aufgaben als
  Board, Störungen als Liste. Die Wahl gilt pro Benutzer (auf dem Server gespeichert, in jedem Browser).
  - Board der Störungen wie das der Aufgaben: alle offenen Status, dazu die abgeschlossenen (ohne Ablehnen-Status) mit
    den Störungen der letzten 14 Tage. Karten nach Priorität, dann Alter («dringend zuerst»); Drag & Drop wechselt nur den
    Status, die Reihenfolge in der Spalte ergibt sich von selbst.
  - Liste der offenen Aufgaben: nach Status (Reihenfolge der Spalten), innerhalb eines Status wie auf dem Board;
    per Spaltenkopf umsortierbar wie jede Liste.
- **Vorgang als Seite oder Fenster:** Unter «Einstellungen» im Benutzermenü wählt man je Bereich (Eingang, Störungen,
  Aufgaben), ob ein Vorgang als Seite (wie bisher, im gleichen Tab) oder in einem grossen Fenster über der Liste öffnet.
  Standard überall «Fenster» (geändert am 27.10.2026, zuerst «Seite»; wer selbst gewählt hat, behält seine Wahl).
  Gespeichert pro Benutzer. Die Wahl gilt überall in Patchwork (Listen, Board, Suche, Verknüpfungen, Verweise im Verlauf,
  «Öffnen» in Meldungen), jeweils nach dem Typ des Vorgangs; Links aus Mails öffnen immer als Seite. Solange das Fenster
  (oder ein anderer Dialog) offen ist, scrollt die Seite dahinter nicht mit. Ctrl+Klick bzw. die mittlere Maustaste öffnen wie gewohnt einen neuen Browser-Tab.
- Technisch (entschieden am 27.10.2026): Das Fenster steht in der Adresse (`?vorgang=123`, seit 28.10.2026 `?item=123`, seit 29.10.2026 `?item=PW-123`), «Zurück» im Browser schliesst
  es, Neuladen öffnet es wieder. Im Fenster gibt es «Als Seite öffnen». Ein Link auf einen anderen Vorgang öffnet diesen je
  nach Wahl wieder im Fenster (ersetzt den Inhalt, «Zurück» führt zum vorherigen) oder als Seite. Nach dem Schliessen lädt
  die Liste bzw. das Board neu. Einstellungen in der Spalte `users.preferences`. Die Navigation der Aufgaben heisst
  «Offen | Erledigt | Abgelehnt» (bisher «Board | …»), passend zu den Störungen. Filter «Nur meine» und die Filterleiste
  gelten für Board und Liste gemeinsam; den Status-Filter gibt es nur in der Liste (im Board sind es die Spalten).
- Das Fenster schliessen ✕, Escape und «Zurück»; ein Klick neben das Fenster und Escape aus einem Eingabefeld (z.B. dem
  Antwortfeld) schliessen es nicht, damit ein angefangener Entwurf nicht verloren geht (bestätigt am 27.10.2026).
- Board der Störungen: «+» in einer offenen Spalte erfasst eine Störung in diesem Status (wie bei den Aufgaben); eine
  neue Störung öffnet sich danach wie bisher, je nach Wahl als Seite oder im Fenster (bestätigt am 27.10.2026).

## Hinweise bei Störungen, Healthcheck, Betriebsskripte (bestätigt am 26.10.2026)

- **Hinweise bei Störungen** nur für Admins, als Balken oben in Patchwork (wie der Hinweis zum Zertifikat) mit Link zur passenden Seite, ohne Mail:
  - Mail-Abruf: wenn der Abruf eines aktiven Postfachs seit 60 Minuten fehlschlägt (kürzere Aussetzer lösen nichts aus), mit Postfach und Fehlermeldung.
  - Ausgehende Mails: solange es fehlgeschlagene Mails gibt, die weder erneut gesendet noch als erledigt markiert sind. Dafür gibt es bei fehlgeschlagenen Mails unter Verwaltung → Ausgehende Mails den Knopf «Als erledigt markieren».
  - Speicherplatz: wenn auf dem Datenträger der Ablage weniger als 10 % frei sind.
- **Healthcheck** für den Patchwork-Container, damit Portainer eine hängende Anwendung als «unhealthy» zeigt.
- **Betriebsskripte im Repo** (Ordner `ops/`): Build und Testlauf auf dem Server, Smoke-, Browser-, LDAP- und AD-Test, Rollout und Aufräumen. Interne Namen und das Token stehen nur in einer ignorierten Konfigurationsdatei.
- Nicht gewünscht (26.10.2026): eigene Datenbanksicherung in der Anwendung (gehört ins Backup-Konzept des Hosts), Smoke-Test in GitHub Actions, Aufbewahrungsfrist für Verworfenes; Sicherheits-Header vorerst nicht.
- **Anrede überall per du** (ersetzt die offene Frage vom 23.10.2026): alle Mails (an Melder und an die IT) und alle Texte in Patchwork und im Portal.
- **Gegenüber Meldern heisst es überall «Meldung»** (Portal und Mails an Melder und Beteiligte), nicht mehr «Anliegen», «Nachricht» oder «Vorgang». Intern (IT, Verwaltung) bleibt es der «Vorgang».
- **Mail-Vorlage «Abgeschlossen»** statt «Erledigt», weil sie auch bei Störungen (Status «Gelöst») gilt; im Verlauf steht dann «Mail «Abgeschlossen» an …».
- **Filter und Sortierung in den Listen:** nach Priorität, Zuständig (Person oder niemand), Status (wo es mehrere gibt) und Meldeweg, im Eingang, bei den Störungen (offen und gelöst), auf dem Aufgaben-Board und unter Erledigt/Abgelehnt. Die Auswahl bleibt pro Ansicht im Browser gespeichert. In den Listen zusätzlich Sortieren per Klick auf den Spaltenkopf.
- **Namensregel:** Bezeichner, Datenbank, API und Migrationen englisch; Kommentare, Oberfläche, Commits und Dokumente deutsch (Schweizer Rechtschreibung). Bestehende Migrationen behalten ihren Namen, die Regel gilt für neue.
- **Smoke-Test** aufgeteilt in eine Datei pro Bereich; nach einem Fehler laufen die übrigen Schritte weiter, am Ende steht die Zusammenfassung.
- Vorgeschlagen, aber vorerst nicht umgesetzt (26.10.2026): Prozesse (Eingangsdienst, Prioritätskriterien, Kurzanleitung …), Meldeweg «Intern» umbenennen, deutsche Status-Namen, Version in der Oberfläche, Mehrfachauswahl, Signatur, «Neu seit dem letzten Besuch», Unteraufgaben, Stummschalten entscheiden.

## Willkommens-Mail für IT und Admins (bestätigt am 23.10.2026)

- Versand nur von Hand: Im Dialog eines aktiven Benutzers mit Rolle IT oder Admin (Verwaltung → Benutzer) gibt es den Knopf «Willkommens-Mail senden», auch für einen erneuten Versand. Legt ein Admin ein Konto mit Rolle IT oder Admin an oder ändert er die Rolle eines Benutzers auf IT oder Admin, fragt Patchwork nach dem Speichern, ob die Mail verschickt werden soll. Rollen, die bei der Anmeldung aus den AD-Gruppen kommen, lösen keine Frage und keine Mail aus.
- Inhalt: Begrüssung, Rolle, Link zu Patchwork, Benutzername und Art der Anmeldung (Windows-Konto bzw. lokales Passwort, das man separat erhält). Nie ein Passwort in der Mail. Eine Vorlage «Willkommen» für beide Rollen unter Verwaltung → E-Mail-Vorlagen (IT), mit Platzhalter {{Rolle}}.
- Bestehende IT-Mitarbeitende und Admins erhalten nach dem Update nichts; bei Bedarf einzeln über den Knopf.
- Technisch (entschieden am 23.10.2026): Die Mail gehört zu keinem Vorgang, deshalb ohne `[PW-…]` im Betreff und ohne Link- und Fusszeile der IT; sie geht über das Standard-Postfach, steht unter Verwaltung → Ausgehende Mails (Art «Willkommen», ohne Vorgang) und folgt dem Testbetrieb wie jede Mail an die IT. Benutzername bei AD-Konten aus dem Verzeichnis (Anmeldename, z.B. sAMAccountName), sonst die E-Mail-Adresse. Standardtext per du wie alle Mails (bestätigt am 26.10.2026).

## Eingebettete Bilder und Vorschau von Anhängen (bestätigt am 23.10.2026)

- **Eingebettete Bilder aus Mails** erscheinen im Text, nicht als Anhang:
  - Ursprüngliche Meldung (HTML): Bilder, die im HTML stehen, erscheinen nicht noch einmal in der Anhangsliste. Behoben: Bilder in einem leeren `<span>` (bei Outlook häufig) gingen beim Bereinigen verloren und blieben nur als Anhang.
  - Antworten und Notizen per Mail (nur Text): eingebettete Bilder erscheinen an der Stelle, an die der Absender sie gesetzt hat (Marke `[cid:…]` im Text der Mail). Eingebettete Bilder, die nur im zitierten Verlauf stehen (z.B. aus früheren Mails), werden nicht mehr als Anhang übernommen; die Originalmail enthält sie weiterhin. Echte Anhänge und eingebettete Bilder ohne Marke bleiben Anhänge.
- **Vorschau von Anhängen** in einem Fenster statt Herunterladen, mit Knopf «Herunterladen» (ohne Blättern):
  - Bilder (PNG, JPEG, GIF, WebP, BMP, SVG als Bild), Text (text/*, .txt, .log, .csv, .json, .xml, .md, .ini, .cfg, .conf, .yaml), PDF mit dem PDF-Betrachter des Browsers, Mails (.eml und Outlook-.msg: Kopf, Text bzw. bereinigtes HTML, Liste ihrer Anhänge).
  - Übrige Typen (Word, Excel, ZIP …) werden wie bisher heruntergeladen.
  - Überall, wo Anhänge stehen: Vorgang (Meldung, Antworten, Notizen), Portal und die Fenster Originalmail, Mail ansehen, Ein- und Ausgehende Mails.

## Bilder im Text (bestätigt am 20.10.2026)

- Bilder lassen sich überall einfügen, wo man Text mit dem Editor schreibt: öffentliche Antwort, interne Notiz, Beschreibung, Begründung einer Ablehnung, neuer Vorgang und im Portal (Meldung und Antwort).
  - Textbausteine vorerst ohne Bilder (**noch zu bestätigen**): Bilder in Bausteinen bräuchten eine eigene Ablage, weil hochgeladene Bilder nach einem Tag verfallen, wenn sie zu keinem Vorgang gehören.
- Drei Wege: Knopf «Bild» in der Toolbar, aus der Zwischenablage (Ctrl+V, z.B. ein Screenshot) und per Hineinziehen. Enthält die Zwischenablage auch Text (z.B. aus Excel oder Word), gilt der Text.
- PNG, JPEG, GIF und WebP bis 10 MB pro Bild. Grössere Bilder und andere Dateien gehen als Anhang. Gesendet wird erst, wenn alle Bilder hochgeladen sind.
- In Timeline, Portal und Mail wird das Bild auf die Textbreite verkleinert, ein Klick öffnet es in voller Grösse. In der Mail ist es eingebettet, nicht angehängt; die Textfassung der Mail nennt «[Bild: Name]». Bilder im Text erscheinen nicht noch einmal in der Liste der Anhänge.
- Technisch (entschieden am 20.10.2026):
  - Das Bild wird beim Einfügen hochgeladen und steht im Markdown als `![Name](upload:<id>)`. Beim Speichern wird es ein Anhang des Eintrags (mit Content-ID für die Mail), im Text steht dann `![Name](attachment:<id>)`. Nicht gespeicherte Bilder löscht die Wartung nach einem Tag.
  - Ein aus einem anderen Eintrag oder Vorgang kopiertes Bild wird ein eigener Anhang des neuen Eintrags (dieselbe Datei), damit Mail und Portal es zeigen. Melder können nur Bilder übernehmen, die sie selbst im Portal sehen.
  - Den Link auf die volle Grösse in der Mail öffnet man ohne Anmeldung, auch als Beteiligter ohne Portal: Die Adresse ist mit `APP_SECRET` signiert und gilt nur für eingebettete Bilder, die die Mail ohnehin enthält.
  - Breite Bilder erhalten in der Mail zusätzlich `width` und `height`, weil Outlook `max-width` nicht kennt.
  - Fremde Bilder (Adressen aus dem Internet) lädt Patchwork weder in der Anzeige noch in Mails. Sie erscheinen als Link bzw. als «[Bild: Name]».

## Rückmeldungen vom 15.10.2026

- **Eigene interne Notizen bearbeiten:** 3 Minuten lang nach dem Erfassen (bis 28.10.2026 5 Minuten, verkürzt am 29.10.2026) («Bearbeiten» bei der Notiz). Danach steht «bearbeitet» bei der Zeit. Nur in Patchwork erfasste Notizen, keine öffentlichen Antworten (die sind schon per Mail verschickt) und keine per Mail eingegangenen.
- **Ausgehende Mails im Verlauf** (bestätigt am 20.10.2026): Automatische Mails an Melder und Beteiligte (Eingangsbestätigung, Erledigt, Abgelehnt, Duplikat-Hinweise, Erinnerung, automatisch geschlossen) erscheinen im Verlauf als kurze graue Zeile, z.B. «Mail «Erledigt» an Anna Muster», mit Zeit und Vermerk bei Abweichungen (nicht versendet, Fehler). «ansehen» öffnet ein Modal mit Kopf (An, CC, Betreff, Status) und der Mail, wie sie versendet wurde. Benachrichtigungen an die IT erscheinen nicht. Bei öffentlichen Antworten öffnet «Mail ansehen» in der Kopfzeile dasselbe Modal. Nur in der Oberfläche, nicht im Portal. Duplikat-Hinweise laufen unter der Nummer des Originals und erscheinen im Verlauf beim Original und beim Duplikat (bestätigt am 20.10.2026). Die Mail steht ab dem Auslösen im Verlauf («wird versendet»); solange eine Mail unterwegs ist, lädt der Vorgang alle 3 Sekunden nach (höchstens eine Minute). Die Ansicht zeigt die Mail hell wie versendet, auch im dunklen Farbschema. Automatische Mails von vor dieser Änderung erscheinen nicht im Verlauf, weil ihre Art damals nicht gespeichert wurde; unter Verwaltung → Ausgehende Mails bleiben sie (bestätigt am 20.10.2026).
- **Änderungen zusammenfassen:** Mehrere Änderungen derselben Person kurz hintereinander (z.B. Status und Priorität) erscheinen als eine Zeile in der Timeline. Gespeichert wird weiterhin jede Änderung einzeln.
  - Bestätigt am 20.10.2026: Ändert dieselbe Person dasselbe Feld darin mehrmals (je höchstens 2 Minuten auseinander), erscheint es nur einmal, vom ersten zum letzten Wert, mit der Zeit der letzten Änderung. Steht am Ende wieder der Ausgangswert, entfällt die Zeile (und die Karte, wenn nichts übrig bleibt). Gilt für Status, Typ, Titel, Priorität, Meldeweg, Zuständig, Melder, Antwort-Postfach und Beschreibung («Beschreibung geändert» einmal); nicht für Beteiligte, Verknüpfungen, Ablehnen, automatische Wechsel und Regeln.
  - Geändert am 20.10.2026: Änderungen stehen in einer grauen Karte, oben Bearbeiter und Zeitpunkt, darunter die Änderungen als Liste. Das gilt für alle Änderungen, auch einzelne, und für Regeln.
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
- HTTPS, bestätigt am 20.10.2026 (vor dem produktiven Betrieb nötig, sonst gehen Passwörter, auch die AD-Passwörter, unverschlüsselt durchs Netz):
  - Zertifikat aus der eigenen Zertifizierungsstelle (AD CS). Der Schlüssel entsteht auf dem Server und verlässt ihn nicht; die CA signiert nur die Zertifikatsanforderung (CSR).
  - **Patchwork liefert HTTPS selbst aus, ohne Caddy oder einen anderen Reverse Proxy.** Im Container auf Port 8443 (`HTTPS_PORT`), auf dem Server 443.
  - `http://` leitet auf `https://` um, sobald HTTPS läuft und `PUBLIC_URL` mit `https://` beginnt (temporäre Umleitung 307 auf `PUBLIC_URL`, damit Browser sie nicht dauerhaft speichern).
  - Hinweis für Admins oben in Patchwork ab 30 Tagen vor Ablauf des Zertifikats.
  - Mit HTTPS kehrt die Microsoft-Anmeldung im Browser direkt zu Patchwork zurück (Umleitungs-URI `https://<Patchwork>/api/microsoft/callback` bei «Mobile- und Desktopanwendungen» in der App-Registrierung). Das Einfügen der Adresse und die Anmeldung mit Code bleiben als Ausweichweg.
  - Erneuern in Patchwork: Verwaltung → HTTPS zeigt das Zertifikat, erstellt eine neue Anforderung samt Anleitung für die AD CS und nimmt das signierte Zertifikat entgegen; es gilt sofort, ohne Neustart.
  - Technisch: Schlüssel und Zertifikat unter `DATA_DIR/tls` (Datenvolume, mit der Sicherung des Hosts gesichert), Anforderung mit `@peculiar/x509` (RSA 2048, SHA-256, Namen als CN und SAN). Upload als PEM, DER oder PKCS#7 (auch die Antwort der Microsoft-CA); Zwischenzertifikate gehen mit, die Wurzel nicht. Der Rücksprung von Microsoft wird über `state` zugeordnet, den Code löst nur Patchwork mit dem PKCE-Verifier ein.

## Testbetrieb, Mail-Abruf und Microsoft 365 (Stand 20.10.2026)

Wünsche des Benutzers vom 19.10.2026:

- Patchwork liest Postfächer nur, Mails bleiben ungelesen (umgesetzt, siehe Randfall 2).
- Pro Postfach festlegen, ab welchem Datum und welcher Uhrzeit Mails abgeholt werden.
- Im Testbetrieb bzw. Parallelbetrieb werden keine Mails versendet, aber man sieht, welche versendet worden wären.
- Microsoft 365: Anmeldung interaktiv, ohne Tenant-ID, Client-ID und Client Secret von Hand einzutragen.

Bestätigt am 19.10.2026:

1. Einstellung pro Postfach «Mails abholen ab» (Datum und Uhrzeit), beim Anlegen vorbelegt mit dem aktuellen Zeitpunkt. Sie ersetzt die Regel «beim ersten Abruf nur ungelesene Mails». Übernommen werden alle Mails ab diesem Zeitpunkt, gelesen oder nicht. Massgebend ist der Eingang im Postfach (IMAP INTERNALDATE), nicht das Datum des Absenders.
2. Wird der Zeitpunkt geändert, holt Patchwork ab dem neuen Zeitpunkt alles, was noch fehlt, ohne doppelte Vorgänge.
3. Schalter «Testbetrieb: keine Mails versenden» für die ganze Instanz (Verwaltung → Allgemein), mit Hinweis für alle Benutzer (auch im Portal). Er gilt für alle Mails, auch für Benachrichtigungen an Mitarbeitende. Am 20.10.2026 ersetzt durch zwei Empfängerkreise, siehe Punkt 14.
4. Nicht versendete Mails: Liste unter Verwaltung → «Nicht versendete Mails» (nur Admin) mit vollständiger Ansicht jeder Mail samt Anhängen und .eml, dazu ein Vermerk «nicht versendet» bei öffentlichen Antworten in der Timeline. Am 20.10.2026 erweitert zum Protokoll aller ausgehenden Mails, siehe Punkt 15.
5. Beim Ausschalten werden zurückgehaltene Mails nicht nachträglich verschickt, die Liste bleibt als Protokoll.
6. Microsoft 365: Anmeldung pro Postfach mit Gerätecode (microsoft.com/devicelogin): Patchwork zeigt den Code, kopiert ihn und öffnet die Anmeldeseite in einem Popup. Tenant automatisch aus der Mail-Domain, kein Client Secret. Eine Anmeldung mit Weiterleitung zu Patchwork verlangt bei Microsoft HTTPS und folgt erst danach.
   - Ergänzt am 19.10.2026: Im Tenant des Benutzers sperrt eine Richtlinie für bedingten Zugriff die Anmeldung mit Gerätecode. Deshalb zusätzlich die Anmeldung im Browser (Autorisierungscode mit PKCE, ohne Client Secret): Anmeldeseite in einem neuen Tab, Rücksprung auf die leere Seite `https://login.microsoftonline.com/common/oauth2/nativeclient`, deren Adresse man in Patchwork einfügt. Beide Wege bleiben möglich.
   - Bestätigt am 19.10.2026: Im Anmeldedialog ist die Anmeldung im Browser der Standard, «Stattdessen mit Code anmelden» die Alternative. Mit HTTPS entfällt später das Einfügen (Rückleitung direkt zu Patchwork). Umgesetzt am 20.10.2026, siehe Abschnitt Betrieb (HTTPS); «Stattdessen Adresse einfügen» bleibt als Ausweichweg.
7. Einmalige App-Registrierung für die ganze Instanz (öffentlicher Client, einzelner Mandant, delegierte Rechte unter Microsoft Graph, Administratorzustimmung; seit 20.10.2026 `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`, `openid`, `profile`, siehe Punkt 11). Ganz automatisch geht es nicht, weil Patchwork für das Anlegen bereits eine Client-ID bräuchte. Die Anleitung steht in der Anwendung (Verwaltung → Postfächer → Microsoft 365), dort trägt man am Schluss die Anwendungs-ID ein.
8. Benutzer-Postfach und freigegebenes Postfach: Es meldet sich das Konto des Postfachs selbst oder ein Konto mit Vollzugriff an (beim freigegebenen Postfach zusätzlich «Senden als»). Verbunden wird immer mit der Adresse des Postfachs. Patchwork zeigt das angemeldete Konto an.
9. Der bisherige App-Zugriff (Client Credentials mit Client Secret) bleibt unter «Erweitert» erhalten.
10. Nur für die Postfächer, keine Anmeldung der Benutzer an Patchwork mit Microsoft.
11. Bestätigt am 20.10.2026: Postfächer mit angemeldetem Microsoft-Konto laufen über **Microsoft Graph statt IMAP/SMTP**, wie bei HelpSpot. Grund: Im Tenant des Benutzers sind IMAP und SMTP AUTH abgeschaltet (wie auch der Gerätecode), Ausnahmen pro Postfach sind nicht gewünscht.
    - Abruf: Delta-Abfrage des Ordners (Standard Posteingang), beim ersten Durchgang alle Mails ab «Mails abholen ab» (`receivedDateTime`), danach jede Mail, die neu im Ordner liegt, auch wenn sie erst später hineinverschoben wurde (z.B. aus «Junk-E-Mail»). Bekannte Message-IDs werden übersprungen, neue als MIME geholt. Patchwork liest nur. Technisch entschieden am 20.10.2026; vorher merkte sich Patchwork den Eingang der zuletzt gesehenen Mail und hätte später hineinverschobene Mails verpasst.
    - Der Stand der Delta-Abfrage gilt nur für Adresse, Ordner, Startzeitpunkt und angemeldetes Konto, mit denen er entstanden ist. Ändert sich eines davon, beginnt der Abruf von vorne, ohne doppelte Vorgänge. Ist der Stand bei Microsoft abgelaufen, ebenso.
    - Versand: fertige Mail als MIME über `sendMail` (Kopie in «Gesendete Elemente»). Mails über 3 MB über einen Entwurf mit einzeln hochgeladenen Anhängen, dafür `Mail.ReadWrite`; scheitert der Versand, wird der Entwurf gelöscht.
    - Ist das angemeldete Konto selbst das Postfach (auch über eine weitere Adresse), nutzt Patchwork «/me», sonst «/users/<adresse>» mit den Rechten `Mail.ReadWrite.Shared` und `Mail.Send.Shared`.
    - Rechte: Patchwork fordert die in der App-Registrierung eingetragenen Graph-Rechte an (`.default`). Die früheren IMAP/SMTP-Rechte werden nicht mehr gebraucht.
12. Bestätigt am 20.10.2026: Den **Ordner für den Abruf wählt man aus einer Aufklappliste**, für IMAP und Microsoft 365, statt ihn einzutippen. Die Liste zeigt alle Mail-Ordner mit Pfad (z.B. «Posteingang / Helpdesk»), den Posteingang zuerst. Patchwork lädt sie beim Öffnen eines gespeicherten Postfachs, bei Microsoft 365 nach der Anmeldung; «Neu laden» holt sie erneut. Ein neues Postfach beginnt mit dem Posteingang, andere Ordner sind nach dem Speichern wählbar. Fehlt der eingestellte Ordner in der Liste, steht er mit «(nicht gefunden)» darin.
    - Technisch: Bei Microsoft 365 speichert Patchwork die ID des Ordners, ein Umbenennen stört deshalb nicht. Bei IMAP den Pfad des Servers. Ältere Einstellungen ohne ID (Pfad aus Ordnernamen) gelten weiter.
13. Bestätigt am 20.10.2026: **Parallelbetrieb mit HelpSpot.** HelpSpot holt die Mails aus dem Posteingang und löscht sie danach; im Posteingang findet Patchwork deshalb kaum Mails. Eine Regel im Postfach legt eine Kopie jeder eingehenden Mail in den Ordner «Inbox-Patchwork», den Patchwork abholt. HelpSpot bleibt davon unberührt. Bei der Umstellung die Regel löschen und in Patchwork wieder den Posteingang wählen.
14. Bestätigt am 20.10.2026: **Testbetrieb mit zwei frei kombinierbaren Empfängerkreisen** (ersetzt den Schalter aus Punkt 3, ohne Vorlagen oder Stufen):
    - «Mails an IT-Mitarbeitende» und «Mails an Melder, Beteiligte und alle übrigen», je «an niemanden», «nur an ausgewählte» oder «an alle». Beide «an alle» ist der normale Betrieb.
    - IT-Mitarbeitende sind Benutzer mit der Rolle IT oder Admin. Massgebend ist der Empfänger, nicht die Art der Mail.
    - Auswahl: IT-Mitarbeitende per Häkchen aus der Liste, die übrigen über die Personensuche (Patchwork, AD, freie E-Mail-Adresse).
    - Geht eine Mail an mehrere Empfänger, von denen nur ein Teil freigegeben ist, erhalten nur diese sie, und im Kopf stehen nur diese (über Microsoft Graph geht es nicht anders). Die vollständige Mail steht im Protokoll mit dem Vermerk, wer sie nicht bekommen hat.
    - Solange nicht beide Kreise «an alle» sind, sehen alle Benutzer oben einen Hinweis, der sagt, wer Mails bekommt (seit 29.10.2026 allgemein «Es werden nicht alle Mails versendet.», siehe «Testbetrieb je Typ …»). In der Timeline steht bei öffentlichen Antworten «nicht versendet» bzw. «teilweise versendet».
    - Bestehende Einstellung: eingeschaltet wird «an niemanden / an niemanden», ausgeschaltet «an alle / an alle».
    - Gewünscht am 20.10.2026: Die Einstellung steht auf der Seite «Ausgehende Mails» über der Liste, nicht mehr unter «Allgemein».
    - Seit 28.10.2026 je Vorgangstyp (Generell, Störungen, Aufgaben), siehe «Testbetrieb je Typ, im Namen anderer antworten, Backlog im Board».
15. Bestätigt am 20.10.2026: **Alle ausgehenden Mails werden protokolliert**, nicht nur die im Testbetrieb zurückgehaltenen:
    - Seite Verwaltung → «Ausgehende Mails» (ersetzt «Nicht versendete Mails», nur Admin) mit Status «versendet», «teilweise versendet», «nicht versendet», «Fehler» oder «wird versendet», Filter nach Status und vollständiger Ansicht (Text, Anhänge, .eml).
    - Jede Mail wird vollständig gespeichert, ohne automatische Löschung.
    - Versandfehler: Status «Fehler» mit Meldung, Patchwork versucht es wie bisher bis zu 10-mal; «Erneut senden» bei fehlgeschlagenen Mails. Eine Mail geht nie doppelt hinaus. Wiederholungen und «Erneut senden» stellen die Mail mit den aktuellen Daten des Postfachs neu zusammen (z.B. nach einer Korrektur der Absenderadresse); das Protokoll zeigt die zuletzt versendete Fassung.
    - In der Timeline nur bei Abweichungen ein Vermerk (nicht oder teilweise versendet, Fehler, wird versendet).
16. Bestätigt am 20.10.2026: **E-Mail-Vorlagen bearbeiten** (Verwaltung → E-Mail-Vorlagen, nur Admin):
    - Bearbeitbar sind Betreff und Text aller Mails an Melder (Eingangsbestätigung, Erledigt, Abgelehnt, Duplikat in zwei Varianten, Erinnerung, automatisch geschlossen) und an IT (Zugewiesen, neue Antwort, behebender Vorgang erledigt), dazu Link-Zeile und Fusszeile je für Melder und IT. Bei der öffentlichen Antwort nur Betreff und Rahmen, den Text schreibt der Bearbeiter.
    - Die Nummer `[PW-123]` setzt Patchwork immer vor den Betreff, damit Antworten zugeordnet werden.
    - Markdown mit Platzhaltern wie bei den Textbausteinen; zu jeder Vorlage steht, welche Platzhalter es gibt.
    - Liste nach Empfänger gruppiert, Editor mit Vorschau mit Beispieldaten und «Auf Standard zurücksetzen».
    - Das Aussehen der Mail (Rahmen, Schrift) bleibt fest, kein Logo.
    - Überarbeitung, bestätigt am 20.10.2026 (umgesetzt nach dem Status-Umbau):
      - Benutzer erhalten eigene Felder **Vorname** und **Nachname**. AD-Konten füllen sie aus givenName und sn (bei der Anmeldung und beim Vorab-Anlegen; Kontakte aus Mails werden bei aktivem LDAP per E-Mail im AD nachgeschlagen). Sonst werden sie aus dem Namen geschätzt («Muster, Anna» bzw. letztes Wort = Nachname). Unter Verwaltung → Benutzer korrigierbar.
      - Platzhalter nur noch mit Vor- und Nachname: {{Melder Vorname}}, {{Melder Nachname}}, {{Zuständig Vorname}}, {{Zuständig Nachname}} (ohne Zuweisung leer). Bestehendes {{Melder}} in gespeicherten Vorlagen wird zu «{{Melder Vorname}} {{Melder Nachname}}».
      - Den Platzhalter {{App}} gibt es nicht mehr. Wo er in gespeicherten Vorlagen und den Standard-Fusszeilen steht, wird einmalig der heutige Name aus Verwaltung → Allgemein als Text eingesetzt.
      - Text der Vorlagen im WYSIWYG-Editor wie bei Antworten (Fett, Kursiv, Listen, Links, Überschriften), ohne Bilder. Platzhalter per Klick an der Cursorposition einfügen, im Editor farbig hervorgehoben. Der Betreff bleibt ein einfaches Textfeld, Platzhalter auch dort per Klick.
      - Umgesetzt am 20.10.2026, Details: Vor- und Nachname aus dem AD über die Attribute givenName und sn (fest); liefert das AD nur eines davon, gilt es so, fehlen beide, wird geschätzt. Neue Kontakte aus Mails, Beteiligte und Kontakte aus der Personensuche werden bei aktivem LDAP vor dem Speichern im AD nachgeschlagen (nur Vor-/Nachname; der Anzeigename bleibt der aus der Mail bis zur ersten Anmeldung). Beim Anlegen eines lokalen Kontos werden Vor- und Nachname beim Tippen des Namens vorbelegt, bis man sie selbst ändert. Das Feld «Bearbeiter» der Mail «Behebender Vorgang erledigt» bleibt der ganze Name. Unbekannte Platzhalter bleiben in der Mail stehen. Im Editor bleibt ein Link mit dem Ziel {{Link}} erhalten.
      - Bestätigt am 20.10.2026: In «Duplikat: im Original weiterbearbeitet» (an den Melder des Duplikats, Nummer und Titel vom Original) nennen {{Melder Vorname}}/{{Melder Nachname}} den Empfänger, also den Melder des Duplikats, nicht den des Originals.
      - Bestätigt am 20.10.2026: Bestehende Kontakte (ohne Anmeldung über das AD) werden einmalig nach dem Update per E-Mail im AD nachgeschlagen; mit Treffer gelten givenName/sn, sonst bleibt die Schätzung. Ist das AD beim Start nicht erreichbar, folgt der nächste Versuch beim nächsten Start; ohne LDAP entfällt es.
      - Textbausteine gleich (bestätigt am 20.10.2026): Platzhalter {{Melder Vorname}}, {{Melder Nachname}}, {{Zuständig Vorname}}, {{Zuständig Nachname}}, {{Bearbeiter Vorname}}, {{Bearbeiter Nachname}} sowie wie bisher {{Nummer}} und {{Titel}}; bestehendes {{Melder}} bzw. {{Bearbeiter}} wird zu «Vorname Nachname». Text im selben WYSIWYG-Editor.
    - **Neue Standardtexte** (gewünscht am 21.10.2026): Die in der Produktion angepassten Vorlagen sind der Standard: an Melder per Du mit «Hallo {{Melder Vorname}}», «E-Mail» statt «Mail» in den meisten Texten, Begründung und Antworttext als Zitat («> …»), Link-Zeilen «Meldung online ansehen» bzw. «Vorgang öffnen», Fusszeilen mit «Patchwork» als Text («Patchwork · {{Nummer}}» bzw. «Patchwork · Benachrichtigung zu {{Nummer}}»). Betreffs unverändert. Angepasste Fassungen, die dem Standard entsprechen, gelten beim Start wieder als Standard (nicht mehr «angepasst»). Ein mehrzeiliger Wert in einem Zitat («> {{Text}}») bleibt ganz im Zitat.
17. Bestätigt am 20.10.2026: **Antworten simulieren** im Testbetrieb:
    - Knopf «Antwort simulieren» in der Ansicht einer Mail unter Verwaltung → Ausgehende Mails, bei jedem Status (versendet, teilweise, zurückgehalten, fehlgeschlagen). Nur für Admins und nur, solange der Testbetrieb aktiv ist.
    - Formular: Absender aus den Empfängern der Mail oder eine freie Adresse (z.B. für eine unbeteiligte Person), Text, Anhänge und ein Häkchen «Als Abwesenheitsnotiz». Die ursprüngliche Mail wird unten zitiert wie in Outlook, damit auch das Entfernen des Zitats geprüft wird.
    - Verarbeitung genau wie bei einer echten Mail: Zuordnung, Regeln, Wiedereröffnen und Benachrichtigung der IT (für die wiederum der Testbetrieb gilt). Die Mail landet nicht im echten Postfach, HelpSpot bekommt nichts davon mit. In Timeline und Portal steht «simuliert».
    - Zusätzlich «Neue Mail simulieren» ohne Bezug, z.B. um Regeln für neue Vorgänge zu testen, ohne dass in HelpSpot ein Ticket entsteht.
    - **Aus einer echten Mail simulieren** (bestätigt am 21.10.2026), z.B. für eine Antwort auf ein HelpSpot-Ticket, die im Eingang gelandet ist: «Als simulierte Mail …» im Fenster «Originalmail» eines Vorgangs (ursprüngliche Meldung und Antworten per Mail) und unter Verwaltung → Eingehende Mails in der Ansicht einer Mail; nur Admins, nur im Testbetrieb. Der Dialog ist mit Absender (Adresse und Name), Postfach, Betreff, Text und den Anhängen der echten Mail vorbelegt; alles ist änderbar, Anhänge lassen sich einzeln abwählen. Hat die echte Mail einen Vorgang im Eingang erzeugt, gibt es das Häkchen «Original verwerfen» (vorgewählt; wiederherstellbar).
    - **Antwort auf Vorgang** (bestätigt am 21.10.2026, auch bei «Neue Mail simulieren»): optional einen Vorgang wählen (Suche nach Nummer oder Text). Die Simulation setzt dann [PW-123] in den Betreff, falls er fehlt, und verweist auf die letzte Mail des Vorgangs, sodass sie dort als Antwort landet.
18. Bestätigt am 20.10.2026: **Protokoll der eingehenden Mails** (Verwaltung → Eingehende Mails, nur Admin):
    - Gleich aufgebaut wie «Ausgehende Mails»: Liste mit Filter nach Ergebnis und echt/simuliert, vollständige Ansicht mit Anhängen und .eml, Link zum Vorgang.
    - Ergebnisse: neuer Vorgang, Antwort, interne Notiz (Absender nicht beteiligt), automatische Antwort, ignoriert (mit Grund, z.B. eigene Adresse), Fehler.
    - Im Protokoll steht jede abgerufene Mail, auch die ignorierten. Wird dieselbe Mail ein zweites Mal abgerufen (z.B. nach einem Neustart des Abrufs), erscheint sie nicht doppelt. Kein Löschen.
    - Schlägt die Verarbeitung fehl, wird die Mail nicht mehr übersprungen: Sie steht als «Fehler» mit Meldung im Protokoll, mit «Erneut verarbeiten».
    - Die bisher abgerufenen Mails (neue Vorgänge und Antworten, die Originale sind gespeichert) werden nachgetragen. Früher ignorierte Mails lassen sich nicht nachtragen.

Zum Vergleich: HelpSpot bietet einen eigenen, im Internet betriebenen Anmeldedienst mit zentraler App (Schlüssel wird zurückkopiert) und als Alternative eine eigene App-Registrierung mit Client Secret und HTTPS-Rücksprungadresse. Es nutzt Microsoft Graph statt IMAP/SMTP.

## Randfälle (bestätigt am 15.10.2026)

Beim Bauen aufgefallene Randfälle:

1. **Mail von Unbeteiligten auf einen bestehenden Vorgang** (z.B. IT antwortet auf eine Benachrichtigung, oder eine fremde Person nennt `[PW-…]` im Betreff): wird als **interne Notiz** erfasst, ändert den Status nicht und macht die Person nicht zum Beteiligten.
2. **Erster Abruf eines Postfachs:** Übernommen werden alle Mails ab dem Zeitpunkt «Mails abholen ab», gelesen oder nicht (geändert am 19.10.2026, vorher nur ungelesene). Verarbeitete Mails bleiben unverändert im Postfach: nicht als gelesen markiert, nicht verschoben, nicht gelöscht (geändert am 19.10.2026, vorher als gelesen markiert). Patchwork öffnet den Ordner nur lesend, erkennt danach neue Mails an der IMAP-UID (bei Microsoft 365 über die Delta-Abfrage, siehe Abschnitt Microsoft 365 Punkt 11) und bereits übernommene an der Message-ID. Nach einem Wechsel von Server, Ordner, Benutzername oder Startzeitpunkt beginnt der Abruf wieder ab dem Startzeitpunkt, ohne doppelte Vorgänge.
3. **Antworten per Mail:** Der zitierte Verlauf wird entfernt und nur der neue Text angezeigt (als Text, ohne HTML-Formatierung). Die Originalmail (.eml) lässt sich herunterladen. Neue Vorgänge aus Mails zeigen das HTML der Mail.
4. **Antwort des Melders auf eine abgelehnte Aufgabe:** Die Aufgabe bleibt abgelehnt (nur der Wartet-Status und abgeschlossene Status ausser dem Ablehnen-Status öffnen wieder), die Antwort erscheint in der Timeline.
5. **Newsletter und automatische Mails** (List-Header, Auto-Submitted, Abwesenheitsnotizen, Unzustellbarkeit): keine Eingangsbestätigung. Abwesenheitsnotizen ändern den Status nicht und benachrichtigen niemanden.
6. **Intern erfasst für jemand anderen** (z.B. telefonische Meldung): Der Melder erhält eine Eingangsbestätigung mit der Nummer.
7. **Melderwechsel:** Der neue Melder erhält keine Mail.
8. **«Nur meine»** = mir zugewiesen.
9. **Eingang** ist nach Eingang sortiert, neueste zuerst.
