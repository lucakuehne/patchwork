CREATE TYPE "public"."status_target" AS ENUM('start', 'reply', 'close', 'reject', 'waiting');--> statement-breakpoint
CREATE TABLE "status_targets" (
	"type" "item_type" NOT NULL,
	"target" "status_target" NOT NULL,
	"status_id" uuid NOT NULL,
	CONSTRAINT "status_targets_type_target_pk" PRIMARY KEY("type","target")
);
--> statement-breakpoint
ALTER TABLE "statuses" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "status_targets" ADD CONSTRAINT "status_targets_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Status ohne Kategorien (20.10.2026): Daten übernehmen, die Kategorie entfällt in der nächsten Migration.
-- «abgeschlossen» = bisher Erledigt oder Abgelehnt
UPDATE "statuses" SET "closed" = "category" IN ('done', 'rejected');--> statement-breakpoint
-- Lage im Ablaufdiagramm festhalten, wo sie bisher automatisch nach Kategorie bestimmt wurde (wie status-flow.ts:
-- Neu links, In Arbeit und darunter Wartend in der Mitte, Erledigt und darunter Abgelehnt rechts, 90 px Abstand)
WITH ranked AS (
  SELECT "id", "type", "category", row_number() OVER (PARTITION BY "type", "category" ORDER BY "position") - 1 AS idx
  FROM "statuses"
), counts AS (
  SELECT "type", "category", count(*)::int AS n FROM "statuses" GROUP BY "type", "category"
)
UPDATE "statuses" s SET
  "diagram_x" = CASE r."category" WHEN 'new' THEN 0 WHEN 'in_progress' THEN 220 WHEN 'waiting' THEN 220 ELSE 440 END,
  "diagram_y" = r.idx * 90 + CASE r."category"
    WHEN 'waiting' THEN greatest(1, coalesce((SELECT c.n FROM counts c WHERE c."type" = r."type" AND c."category" = 'in_progress'), 0)) * 90 + 45
    WHEN 'rejected' THEN greatest(1, coalesce((SELECT c.n FROM counts c WHERE c."type" = r."type" AND c."category" = 'done'), 0)) * 90 + 45
    ELSE 0 END
FROM ranked r
WHERE s."id" = r."id" AND (s."diagram_x" IS NULL OR s."diagram_y" IS NULL);--> statement-breakpoint
-- Ziele: bisher der erste Status der Kategorie nach Reihenfolge
INSERT INTO "status_targets" ("type", "target", "status_id")
SELECT DISTINCT ON ("type", "category") "type",
  (CASE "category" WHEN 'new' THEN 'start' WHEN 'in_progress' THEN 'reply' WHEN 'done' THEN 'close' WHEN 'rejected' THEN 'reject' ELSE 'waiting' END)::"status_target",
  "id"
FROM "statuses"
WHERE "category" IS NOT NULL
ORDER BY "type", "category", "position";--> statement-breakpoint
-- Bisher ging «Ablehnen» auch bei eingeschränktem Ablauf aus jedem Status (Pfeile nach «Abgelehnt» gab es nicht).
-- Neu bestimmen Pfeile in den Ablehnen-Status, woraus «Ablehnen» möglich ist: Pfeile aus allen Status anlegen.
INSERT INTO "status_transitions" ("from_id", "to_id")
SELECT s."id", t."status_id"
FROM "status_targets" t
JOIN "statuses" s ON s."type" = t."type" AND s."id" <> t."status_id"
WHERE t."target" = 'reject'
  AND EXISTS (SELECT 1 FROM "settings" st WHERE st."key" = 'statusFlow' AND st."value"->'restrict'->>(t."type"::text) = 'true')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Zeitgesteuerte Regeln: Kategorie «Wartend» → «Wartet auf den Melder», sonst alle Status der Kategorie (beide Typen)
UPDATE "rules" SET "schedule" = jsonb_build_object('days', "schedule"->'days', 'statusIds', '[]'::jsonb, 'waiting', true)
WHERE "schedule" ? 'category' AND "schedule"->>'category' = 'waiting';--> statement-breakpoint
UPDATE "rules" SET "schedule" = jsonb_build_object(
  'days', "schedule"->'days',
  'statusIds', coalesce((SELECT jsonb_agg(s."id" ORDER BY s."type", s."position") FROM "statuses" s WHERE s."category"::text = "rules"."schedule"->>'category'), '[]'::jsonb),
  'waiting', false)
WHERE "schedule" ? 'category';--> statement-breakpoint
UPDATE "rules" SET "active" = false
WHERE "schedule" IS NOT NULL AND NOT ("schedule"->>'waiting')::boolean AND jsonb_array_length("schedule"->'statusIds') = 0;--> statement-breakpoint
-- Reihenfolge je Typ wie bisher angezeigt: nach Kategorie, darin nach Reihenfolge (gilt für Board und Auswahllisten)
UPDATE "statuses" s SET "position" = r.rn - 1
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "type"
    ORDER BY array_position(ARRAY['new', 'in_progress', 'waiting', 'done', 'rejected']::"status_category"[], "category"), "position"
  ) AS rn
  FROM "statuses"
) r
WHERE s."id" = r."id";
