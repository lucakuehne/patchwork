ALTER TABLE "outgoing_mails" ADD COLUMN "template" text;--> statement-breakpoint
-- Bisherige Mails: öffentliche Antworten sind an der Timeline-Verknüpfung erkennbar, die übrigen bleiben ohne Vorlage
UPDATE "outgoing_mails" SET "template" = 'reply' WHERE "entry_id" IS NOT NULL;