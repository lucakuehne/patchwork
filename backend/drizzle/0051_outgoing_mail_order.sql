ALTER TYPE "public"."outgoing_status" ADD VALUE 'waiting';--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
-- Mails in der Versand-Queue: Zeitpunkt des Einreihens nachtragen
UPDATE "outgoing_mails" SET "queued_at" = "created_at" WHERE "status" = 'queued';--> statement-breakpoint
-- Seit über einer Stunde «wird versendet»: hängengeblieben (z.B. Neustart während des Versands). Nicht nachträglich
-- versenden, sondern als erledigten Fehler festhalten, damit sie die Reihenfolge des Postfachs nicht aufhalten
UPDATE "outgoing_mails" SET "status" = 'failed', "error" = 'Versand unterbrochen (hing seit über einer Stunde in der Versand-Queue)', "dismissed_at" = now(), "queued_at" = NULL WHERE "status" = 'queued' AND "created_at" < now() - interval '1 hour';
