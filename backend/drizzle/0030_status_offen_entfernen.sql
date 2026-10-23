-- Aufgaben: Der Status «Offen» (Migration 0029) entfällt wieder (23.10.2026). Aufgaben darin kommen ins Backlog, das
-- wieder Start-Status wird. Ziele, Pfeile und zeitgesteuerte Regeln, die «Offen» nennen, gehen auf das Backlog über.
-- Gibt es kein offenes Backlog mehr, übernimmt der erste übrige offene Status der Aufgaben (nicht der Wartet-Status).
DO $$
DECLARE
  offen uuid;
  ersatz uuid;
BEGIN
  SELECT "id" INTO offen FROM "statuses" WHERE "type" = 'task' AND "key" = 'open';
  IF offen IS NULL THEN
    RETURN;
  END IF;
  SELECT "id" INTO ersatz FROM "statuses"
  WHERE "type" = 'task' AND "id" <> offen AND NOT "closed"
    AND "id" NOT IN (SELECT "status_id" FROM "status_targets" WHERE "type" = 'task' AND "target" = 'waiting')
  ORDER BY ("key" = 'backlog') DESC, "position"
  LIMIT 1;
  IF ersatz IS NULL THEN
    RETURN;
  END IF;

  UPDATE "items" SET "status_id" = ersatz WHERE "status_id" = offen;

  -- Ziele: Wartet ist freiwillig und darf nicht der Start-Status sein, die übrigen gehen auf den Ersatz
  DELETE FROM "status_targets" WHERE "status_id" = offen AND "target" = 'waiting';
  UPDATE "status_targets" SET "status_id" = ersatz WHERE "status_id" = offen;

  -- Pfeile von und nach «Offen» gelten für den Ersatz (wirken nur bei eingeschränktem Ablauf)
  INSERT INTO "status_transitions" ("from_id", "to_id")
  SELECT ersatz, "to_id" FROM "status_transitions" WHERE "from_id" = offen AND "to_id" <> ersatz
  ON CONFLICT DO NOTHING;
  INSERT INTO "status_transitions" ("from_id", "to_id")
  SELECT "from_id", ersatz FROM "status_transitions" WHERE "to_id" = offen AND "from_id" <> ersatz
  ON CONFLICT DO NOTHING;

  UPDATE "rules"
  SET "schedule" = jsonb_set(
    "schedule",
    '{statusIds}',
    (SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN e.t = offen::text THEN ersatz::text ELSE e.t END), '[]'::jsonb)
     FROM jsonb_array_elements_text("schedule"->'statusIds') AS e(t))
  )
  WHERE "schedule" IS NOT NULL AND "schedule"->'statusIds' ? offen::text;

  DELETE FROM "statuses" WHERE "id" = offen;
  UPDATE "statuses" s SET "position" = r.rn - 1
  FROM (SELECT "id", row_number() OVER (ORDER BY "position", "created_at") AS rn FROM "statuses" WHERE "type" = 'task') r
  WHERE s."id" = r."id";
END $$;
--> statement-breakpoint
-- Regeln mit der Aktion «Typ: Aufgabe» wählen den Status selbst (seit 23.10.2026): bestehende erhalten den
-- Start-Status der Aufgaben
UPDATE "rules" SET "actions" = "rules"."actions" || jsonb_build_object('statusId', t."status_id")
FROM "status_targets" t
WHERE t."type" = 'task' AND t."target" = 'start'
  AND "rules"."actions"->>'type' = 'task' AND NOT ("rules"."actions" ? 'statusId');
