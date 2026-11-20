ALTER TABLE "statuses" ADD COLUMN "compact_cards" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Kleine Karten (Entscheid vom 20.11.2026): Backlog und Erledigt der Aufgaben gleich umstellen
UPDATE "statuses" SET "compact_cards" = true WHERE "type" = 'task' AND "key" IN ('backlog', 'done');
