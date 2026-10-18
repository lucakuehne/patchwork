-- Die bisherige Einstellung «Wartet auf Melder» wird zu zeitgesteuerten Regeln (ohne Bedingungen).
INSERT INTO "rules" ("name", "active", "position", "triggers", "schedule", "conditions", "actions")
SELECT 'Erinnerung an den Melder', true, coalesce((SELECT max("position") FROM "rules"), -1) + 1, '[]'::jsonb,
  jsonb_build_object('category', 'waiting', 'days', ("value"->>'waitingReminderDays')::int),
  '{"kind":"group","op":"and","children":[]}'::jsonb, '{"remindReporter":true}'::jsonb
FROM "settings"
WHERE "key" = 'automation' AND jsonb_typeof("value"->'waitingReminderDays') = 'number';
--> statement-breakpoint
INSERT INTO "rules" ("name", "active", "position", "triggers", "schedule", "conditions", "actions")
SELECT 'Ohne Rückmeldung schliessen', true, coalesce((SELECT max("position") FROM "rules"), -1) + 1, '[]'::jsonb,
  jsonb_build_object('category', 'waiting', 'days', ("value"->>'waitingCloseDays')::int),
  '{"kind":"group","op":"and","children":[]}'::jsonb, '{"close":true}'::jsonb
FROM "settings"
WHERE "key" = 'automation' AND jsonb_typeof("value"->'waitingCloseDays') = 'number';
--> statement-breakpoint
-- Bereits verschickte Erinnerungen nicht wiederholen
INSERT INTO "rule_runs" ("rule_id", "item_id", "status_changed_at")
SELECT r."id", i."id", i."status_changed_at"
FROM "items" i
JOIN "rules" r ON r."schedule" IS NOT NULL AND (r."actions"->>'remindReporter')::boolean IS TRUE
WHERE i."waiting_reminder_at" IS NOT NULL AND i."waiting_reminder_at" >= i."status_changed_at";
--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'automation';
