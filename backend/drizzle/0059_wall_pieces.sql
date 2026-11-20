-- Wände als gerade Stücke (Entscheid vom 20.11.2026): Jeder Abschnitt einer bisherigen Wand (Linienzug, evtl.
-- geschlossen) wird eine eigene Wand mit derselben Dicke, mittig auf der Linie. Das erste Stück behält die ID der Wand.
-- Türen und Fenster kommen in das Stück ihres bisherigen Abschnitts, mit demselben Abstand vom Anfang.
WITH pieces AS MATERIALIZED (
  SELECT
    f.id AS floor_id,
    w.value->>'id' AS wall_id,
    w.ordinality AS wall_no,
    s.i,
    CASE WHEN s.i = 0 THEN w.value->>'id' ELSE gen_random_uuid()::text END AS piece_id,
    w.value->'points'->s.i AS a,
    w.value->'points'->((s.i + 1) % jsonb_array_length(w.value->'points')) AS b,
    w.value->'thickness' AS thickness
  FROM "plan_floors" f
  CROSS JOIN LATERAL jsonb_array_elements(f."walls") WITH ORDINALITY AS w(value, ordinality)
  CROSS JOIN LATERAL generate_series(
    0,
    jsonb_array_length(w.value->'points')
      - CASE WHEN coalesce((w.value->>'closed')::boolean, false) AND jsonb_array_length(w.value->'points') > 2 THEN 1 ELSE 2 END
  ) AS s(i)
  WHERE w.value ? 'points'
),
new_walls AS (
  SELECT floor_id, jsonb_agg(jsonb_build_object('id', piece_id, 'a', a, 'b', b, 'thickness', thickness, 'align', 'center') ORDER BY wall_no, i) AS walls
  FROM pieces
  GROUP BY floor_id
),
new_openings AS (
  SELECT f.id AS floor_id, jsonb_agg((o.value - 'segment') || jsonb_build_object('wallId', p.piece_id) ORDER BY o.ordinality) AS openings
  FROM "plan_floors" f
  CROSS JOIN LATERAL jsonb_array_elements(f."openings") WITH ORDINALITY AS o(value, ordinality)
  JOIN pieces p ON p.floor_id = f.id AND p.wall_id = o.value->>'wallId' AND p.i = coalesce((o.value->>'segment')::int, 0)
  GROUP BY f.id
)
UPDATE "plan_floors" f
SET "walls" = nw.walls, "openings" = coalesce(op.openings, '[]'::jsonb)
FROM new_walls nw
LEFT JOIN new_openings op ON op.floor_id = nw.floor_id
WHERE f.id = nw.floor_id;
