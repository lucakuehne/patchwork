ALTER TABLE "mailboxes" ADD COLUMN "fetch_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Der Schalter für alle Postfächer (Einstellung «mailFetch») weicht dem Schalter je Postfach: war der Abruf aus, ist er
-- danach bei allen Postfächern aus (Entscheid vom 30.10.2026)
UPDATE "mailboxes" SET "fetch_enabled" = false
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'mailFetch' AND ("value"->>'enabled') = 'false');--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'mailFetch';
