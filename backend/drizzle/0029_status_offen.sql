-- Aufgaben: Status «Offen» (grau, für angefragte Aufgaben) zuvorderst, vor dem Backlog, und neuer Start-Status.
-- Nur in bestehenden Installationen (eine neue Datenbank erhält ihn mit den Standardstatus) und nur, wenn es ihn noch
-- nicht gibt. Pfeile von «Offen» ins Backlog und in den Ablehnen-Status (wirken nur bei eingeschränktem Ablauf).
WITH inserted AS (
  INSERT INTO "statuses" ("type", "key", "label", "closed", "color", "position")
  SELECT 'task', 'open', 'Offen', false, 'gray', -1
  WHERE EXISTS (SELECT 1 FROM "statuses" WHERE "type" = 'task')
    AND NOT EXISTS (SELECT 1 FROM "statuses" WHERE "type" = 'task' AND ("key" = 'open' OR lower("label") = 'offen'))
  RETURNING "id"
),
start_target AS (
  INSERT INTO "status_targets" ("type", "target", "status_id")
  SELECT 'task', 'start', "id" FROM inserted
  ON CONFLICT ("type", "target") DO UPDATE SET "status_id" = EXCLUDED."status_id"
  RETURNING 1
),
arrows AS (
  INSERT INTO "status_transitions" ("from_id", "to_id")
  SELECT i."id", s."id"
  FROM inserted i
  JOIN "statuses" s ON s."type" = 'task'
    AND (s."key" = 'backlog' OR s."id" = (SELECT "status_id" FROM "status_targets" WHERE "type" = 'task' AND "target" = 'reject'))
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT 1;
--> statement-breakpoint
-- Reihenfolge der Status der Aufgaben neu durchnummerieren («Offen» zuvorderst)
UPDATE "statuses" s SET "position" = r.rn - 1
FROM (SELECT "id", row_number() OVER (ORDER BY "position", "created_at") AS rn FROM "statuses" WHERE "type" = 'task') r
WHERE s."id" = r."id";
