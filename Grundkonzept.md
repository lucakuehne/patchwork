# Patchwork – Konzept

Oct 15, 2026 · @Luca Kühne

> Ursprüngliches Konzept, Stand 15.10.2026. Was seither entschieden wurde (auch Abweichungen von diesem Konzept), steht in
> [docs/Entscheidungen.md](docs/Entscheidungen.md); dort ist der aktuelle Stand massgeblich.

## Ausgangslage und Ziel

Patchwork ersetzt Wekan und HelpSpot durch ein einziges Tool, in dem Störungen und Aufgaben gemeinsam verwaltet werden.

| System | Zweck heute |
| --- | --- |
| Wekan (Kanban) | Changes, Projekte, ToDos |
| HelpSpot (Tickets) | Incidents, Fälle |

Die Trennung führt zu drei Problemen:

- Anfragen für neue Dinge kommen teilweise als Ticket in HelpSpot an.
- Incidents werden teilweise fälschlich als Karte in Wekan erfasst.
- Ein Vorgang lässt sich nicht einfach ins andere System übertragen, und offene Arbeit ist auf zwei Orte verteilt.

Ziel: Alles Offene liegt an einem Ort, und ein falsch erfasster Vorgang lässt sich mit einem Klick umklassieren. Patchwork ist ein privates Projekt und wird so gebaut, dass es nicht an eine bestimmte Umgebung gebunden ist.

## Grundprinzip

Jeder Vorgang ist ein einziges Objekt. Ob Störung oder Aufgabe, ist nur ein Feld und jederzeit änderbar.

&#91;embedded content: Vorgangsfluss · 3 Kanäle, 2 Typen\]

E-Mail und Portal landen im Eingang, bis ein Typ zugewiesen ist. Intern Erfasstes bekommt den Typ direkt, und beim Typwechsel bleiben Verlauf, Kommentare und Anhänge erhalten.

## Typen und Status

Es gibt genau zwei Typen. Der Typ beantwortet nur eine Frage: Ist etwas kaputt, oder soll etwas gemacht werden?

| Typ | Leitfrage | Beispiele | Darstellung |
| --- | --- | --- | --- |
| Störung | Funktioniert etwas nicht mehr, das vorher ging? | VPN verbindet nicht, Drucker druckt nicht, Share nicht erreichbar | Ticket-Liste, dringend zuerst |
| Aufgabe | Soll etwas Neues oder Anderes gemacht werden? | Account für neuen Mitarbeiter, Firmware-Update, Migration Owncloud → Nextcloud | Kanban-Board |

Changes, ToDos, Anfragen und Projekte aus dem alten Modell sind alles Aufgaben. Ein Projekt ist eine Aufgabe mit Unteraufgaben.

- **Störung:** Neu → In Arbeit → Wartet auf Melder → Gelöst
- **Aufgabe:** Backlog → Geplant → In Arbeit → Erledigt, dazu «Abgelehnt» als Abschluss. Die Status sind zugleich die Spalten des Boards.

Beim Typwechsel wird der Status sinngemäss übernommen: «In Arbeit» bleibt «In Arbeit», «Neu» wird «Backlog».

## Personen und Rollen

Jeder Vorgang hat immer einen Ersteller und einen Melder, egal ob Störung oder Aufgabe.

| Feld | Bedeutung | Gesetzt durch |
| --- | --- | --- |
| Ersteller | Wer den Vorgang erfasst hat | Automatisch, nicht änderbar |
| Melder | Für wen bzw. auf wessen Wunsch der Vorgang existiert | Standard = Ersteller, änderbar (z.B. bei telefonischer Meldung) |
| Zuständig | Wer den Vorgang bearbeitet | IT |

Es gibt zwei Rollen:

- **IT:** sieht und bearbeitet alle Vorgänge.
- **Melder:** sieht nur die eigenen Vorgänge, z.B. im Portal.

Ob ein Vorgang «von aussen» kommt, ergibt sich aus der Rolle des Melders. Ein eigenes Feld dafür gibt es nicht.

**Benachrichtigungen:** Der Melder erhält Updates per Mail, ausser zu Änderungen, die er selbst gemacht hat. IT-Mitarbeiter können Benachrichtigungen pro Vorgang stummschalten.

**Ablehnen:** Jede Aufgabe kann abgelehnt werden, in jeder Spalte und mit Begründung. Die Begründung geht automatisch per Mail an den Melder.

## Eingang und Erfassung

Vorgänge entstehen auf drei Wegen. Monitoring-Alerts gehören nicht dazu, sie werden bei Bedarf intern erfasst.

| Kanal | Ablauf | Typ |
| --- | --- | --- |
| E-Mail | Ein Postfach wird per IMAP abgeholt (bei Microsoft 365 mit OAuth 2.0). Antworten werden über die Nummer im Betreff (z.B. `[PW-1234]`) dem Vorgang zugeordnet. | Wird im Eingang zugewiesen |
| Portal | Der Melder wählt «Etwas funktioniert nicht» oder «Ich brauche etwas». | Vorschlag, im Eingang bestätigt |
| Intern erfasst | Die IT erfasst direkt im Tool. | Beim Erfassen gewählt, landet sofort im richtigen Tab |

## Typwechsel und Verknüpfungen

Ein falsch erfasster Vorgang wird nicht kopiert, sondern umklassiert.

- **Typ ändern:** ein Klick. Verlauf, Kommentare und Anhänge bleiben erhalten.
- **Verknüpfen:** Vorgänge lassen sich miteinander verbinden, z.B. eine Störung mit der Aufgabe, die ihre Ursache behebt.
- **Unteraufgaben:** Eine Aufgabe mit Unteraufgaben ist ein Projekt.
- **Kommunikation:** Öffentliche Antworten (gehen per Mail an den Melder) und interne Notizen stehen in derselben Timeline.

## Navigation und Ansichten

Die Navigation ist nach Typ aufgeteilt, mit drei Tabs.

| Tab | Inhalt | Darstellung |
| --- | --- | --- |
| Eingang | Vorgänge aus E-Mail und Portal ohne zugewiesenen Typ | Liste |
| Störungen | Alle offenen Störungen | Ticket-Liste, dringend zuerst |
| Aufgaben | Alle offenen Aufgaben inkl. Projekte | Kanban-Board |

Jeder Tab zeigt in der Tab-Leiste die Anzahl offener Vorgänge und hat einen Filter «Nur meine». Eine separate Sammelansicht gibt es nicht.

## Datenmodell (Entwurf)

Alle Vorgänge liegen in einer einzigen Tabelle. Der Typ ist ein Feld, die Status sind pro Typ konfigurierbar.

| Entität | Wichtige Felder | Zweck |
| --- | --- | --- |
| `item` | `number` (PW-1234), `type` (incident, task), `title`, `description`, `status`, `priority`, `creatorId`, `reporterId`, `assigneeId`, `parentId`, `createdAt`, `closedAt` | Der Vorgang |
| `status` | `type`, `key`, `label`, `order`, `isClosed` | Status pro Typ, zugleich Spalten des Boards |
| `user` | `name`, `email`, `role` (it, reporter), `authSource` (local, ldap, oidc) | Benutzer und Rollen |
| `entry` | `itemId`, `authorId`, `kind` (reply, note, status, type), `body`, `mailMessageId` | Timeline inkl. Mail-Threading |
| `attachment` | `entryId`, `filename`, `size`, `storageKey` | Anhänge |
| `link` | `fromId`, `toId`, `kind` | Verknüpfungen zwischen Vorgängen |
| `mute` | `userId`, `itemId` | Stummgeschaltete Benachrichtigungen |

Unteraufgaben sind normale Vorgänge mit gesetztem `parentId`. Ein Typwechsel ändert nur `type` und `status` und schreibt einen `entry` vom Typ `type` in die Timeline.

## Technik und Betrieb

Der Stack besteht aus NestJS, Vue und PostgreSQL. Weitere Dienste wie Redis braucht es nicht, und nichts ist fest an eine bestimmte Umgebung gebunden.

| Bereich | Wahl |
| --- | --- |
| Backend | NestJS, PostgreSQL (Volltextsuche über Postgres) |
| Frontend | Vue 3, Drag & Drop fürs Board. Wird vom Backend als statische Dateien ausgeliefert. |
| Hintergrundjobs | pg-boss (Job-Queue in PostgreSQL) für Mail-Abruf, Mailversand mit Wiederholung und Benachrichtigungen |
| Login | Lokale Benutzer als Standard, LDAP/AD und OIDC optional |
| Mail | IMAP/SMTP für alle Postfächer. Anmeldung pro Postfach wählbar: Passwort oder OAuth 2.0 (Modern Auth, z.B. Microsoft 365 über eine App-Registrierung in Entra ID) |
| Oberfläche | Nur Deutsch, weitere Sprachen allenfalls später |
| Betrieb Dev | Ein Container mit Front- und Backend, nutzt die vorhandene PostgreSQL auf dem Docker-Host |
| Betrieb Prod | Docker Compose: ein Container mit Front- und Backend, dazu ein PostgreSQL-Container (per Compose-Profil zuschaltbar) oder eine externe DB über `DATABASE_URL` |
| Konfiguration | Mailserver, Name und Logo in den Einstellungen, nicht im Code |
| Import | Optionale Module für HelpSpot und Wekan (über deren API). Danach bleiben die alten Systeme read-only stehen. |

Für Microsoft 365 braucht es eine App-Registrierung mit den Berechtigungen `IMAP.AccessAsApp` und `SMTP.SendAsApp`, einen Service Principal in Exchange Online mit Zugriff auf das Postfach und aktiviertes SMTP AUTH auf dem Postfach ([Microsoft-Anleitung](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)).

## Etappen

Schon das MVP löst Wekan und HelpSpot ab. Die weiteren Etappen bauen darauf auf.

1. **MVP:** zwei Typen mit Typwechsel, Eingang, Tabs mit Liste und Board, E-Mail rein und raus, Login (lokal, LDAP/AD), Import aus HelpSpot und Wekan.
2. **Ausbau:** Portal, Verknüpfungen, Unteraufgaben für Projekte.
3. **Komfort:** Regeln (z.B. «Mail von Absender X → Typ Aufgabe»), Auswertungen.

Stand 26.10.2026: alle drei Etappen umgesetzt, mit zwei Ausnahmen. Den Import aus HelpSpot und Wekan gibt es nicht
(entschieden, siehe docs/Entscheidungen.md), stattdessen einen Parallelbetrieb mit HelpSpot. Unteraufgaben für Projekte sind
bewusst zurückgestellt; kleinere Abläufe decken die Checklisten der Aufgaben ab.

## Abgrenzung

Bewusst nicht Teil von Patchwork:

- **Monitoring-Integration:** Alerts werden bei Bedarf manuell erfasst.
- **Kalender für Wartungsfenster.**
- **ITIL-Unterteilung** in Incident, Request, Change und Projekt.
- **Sammelansichten** wie «Meine Arbeit» oder eine Queue. Stattdessen hat jeder Tab den Filter «Nur meine».
- **Reaktions- und Lösungszeiten (SLA):** vorerst nicht, allenfalls später.

## Offene Punkte

Stand 26.10.2026:

- [x] Wie viele Prioritätsstufen gibt es, und gelten sie auch für Aufgaben? Drei Stufen (Hoch, Normal, Niedrig), für beide
      Typen.
- [ ] Bleibt Patchwork privat oder wird es als Open Source veröffentlicht? Das Repo ist seit dem 19.10.2026 öffentlich
      (Images über GitHub Actions), eine Lizenz ist noch nicht festgelegt.
