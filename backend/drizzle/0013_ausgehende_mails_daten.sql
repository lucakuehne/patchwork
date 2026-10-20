-- Bisher im Testbetrieb zurückgehaltene Mails ins Protokoll aller ausgehenden Mails übernehmen
INSERT INTO "outgoing_mails" ("message_id", "item_id", "entry_id", "mailbox_id", "from_address", "to", "cc", "subject", "automated", "status", "delivered_to", "storage_key", "created_at")
SELECT "message_id", "item_id", "entry_id", "mailbox_id", "from_address", "to", "cc", "subject", "automated", 'held', '[]'::jsonb, "storage_key", "created_at"
FROM "held_mails"
ON CONFLICT ("message_id") DO NOTHING;
--> statement-breakpoint
-- Testbetrieb: aus dem Schalter «keine Mails versenden» werden zwei Empfängerkreise (keine/ausgewählte/alle):
-- eingeschaltet = an niemanden, ausgeschaltet = an alle.
UPDATE "settings"
SET "value" = jsonb_build_object(
  'staff', CASE WHEN ("value"->>'testMode')::boolean THEN 'none' ELSE 'all' END,
  'others', CASE WHEN ("value"->>'testMode')::boolean THEN 'none' ELSE 'all' END,
  'staffEmails', '[]'::jsonb,
  'otherEmails', '[]'::jsonb
)
WHERE "key" = 'mail' AND "value" -> 'testMode' IS NOT NULL;
