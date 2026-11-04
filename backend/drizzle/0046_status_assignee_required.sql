ALTER TABLE "statuses" ADD COLUMN "assignee_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Zuständig Pflicht (Entscheid vom 04.11.2026): vorbelegt für alle Status ausser dem Start-Status je Typ und «Geplant»
-- der Aufgaben. Bei einer leeren Datenbank gibt es hier noch keine Status; dort setzt DEFAULT_STATUSES die Werte.
UPDATE "statuses" SET "assignee_required" = true
WHERE "id" NOT IN (SELECT "status_id" FROM "status_targets" WHERE "target" = 'start')
  AND NOT ("type" = 'task' AND "key" = 'planned');
