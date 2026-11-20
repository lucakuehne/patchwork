-- Stockwerk mit Umriss, Flächen und Bauteilen (Entscheid vom 20.11.2026): Die bisherigen Räume werden Flächen der Art
-- «Raum». Stockwerke mit Inhalt erhalten als Umriss das Rechteck um alle Räume und Beschriftungen (mindestens 1 × 1 m).
INSERT INTO "plan_areas" ("id", "floor_id", "kind", "name", "description", "points")
SELECT "id", "floor_id", 'room', "name", "description", "points" FROM "plan_rooms";--> statement-breakpoint
UPDATE "plan_floors" f
SET "outline" = jsonb_build_array(
  jsonb_build_array(b.min_x, b.min_y),
  jsonb_build_array(greatest(b.max_x, b.min_x + 1), b.min_y),
  jsonb_build_array(greatest(b.max_x, b.min_x + 1), greatest(b.max_y, b.min_y + 1)),
  jsonb_build_array(b.min_x, greatest(b.max_y, b.min_y + 1))
)
FROM (
  SELECT p.floor_id, min(p.x) AS min_x, min(p.y) AS min_y, max(p.x) AS max_x, max(p.y) AS max_y
  FROM (
    SELECT r.floor_id, (pt->>0)::float8 AS x, (pt->>1)::float8 AS y
    FROM "plan_rooms" r, jsonb_array_elements(r.points) AS pt
    UNION ALL
    SELECT l.floor_id, l.x, l.y FROM "plan_labels" l
  ) p
  GROUP BY p.floor_id
) b
WHERE f.id = b.floor_id;
