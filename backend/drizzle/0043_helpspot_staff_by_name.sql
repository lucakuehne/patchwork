-- Mitarbeitende aus HelpSpot, die in dessen Mitarbeiterliste fehlen (Ehemalige), über den Namen einem Benutzer zuordnen,
-- wenn genau ein Benutzer so heisst (Entscheid vom 30.10.2026). Neue Importe tun das selbst (staffUser); hier die schon
-- übernommenen: Zuständige der Vorgänge und Autoren der Einträge von Mitarbeitenden. «updated_at» bleibt, sonst gälte
-- der Vorgang beim nächsten Import als in Patchwork geändert.
UPDATE "items" i
SET "assignee_id" = u."id"
FROM "helpspot_tickets" t, "users" u
WHERE t."item_id" = i."id" AND i."assignee_id" IS NULL
  AND btrim(coalesce(t."raw"->>'xPersonAssignedTo', '')) <> ''
  AND lower(btrim(t."raw"->>'xPersonAssignedTo')) = lower(btrim(u."name"))
  AND (SELECT count(*) FROM "users" u2 WHERE lower(btrim(u2."name")) = lower(btrim(u."name"))) = 1;--> statement-breakpoint
-- Autor nur bei Einträgen, die HelpSpot als von Mitarbeitenden führt (person_type «staff» im gespeicherten Verlauf)
UPDATE "entries" e
SET "author_id" = u."id", "meta" = e."meta" - 'authorName'
FROM "helpspot_tickets" t, "users" u
WHERE t."item_id" = e."item_id" AND e."author_id" IS NULL AND e."meta"->>'source' = 'helpspot'
  AND lower(btrim(e."meta"->>'authorName')) = lower(btrim(u."name"))
  AND (SELECT count(*) FROM "users" u2 WHERE lower(btrim(u2."name")) = lower(btrim(u."name"))) = 1
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE jsonb_typeof(coalesce(t."raw"->'request_history'->'item', t."raw"->'request_history'))
        WHEN 'array' THEN coalesce(t."raw"->'request_history'->'item', t."raw"->'request_history')
        WHEN 'object' THEN (SELECT coalesce(jsonb_agg(x.v), '[]'::jsonb) FROM jsonb_each(coalesce(t."raw"->'request_history'->'item', t."raw"->'request_history')) AS x(k, v))
        ELSE '[]'::jsonb
      END
    ) AS h(v)
    WHERE jsonb_typeof(h.v) = 'object' AND h.v->>'xRequestHistory' = e."meta"->>'helpspotId' AND h.v->>'person_type' = 'staff'
  );
