-- Rechte je Rolle (Entscheid vom 20.11.2026): Die «Bereiche der IT» werden zu den Rechten der IT. Eingang, Störungen
-- und Aufgaben bleiben, «Pläne» wird zu «Pläne ansehen»; alles andere (Pläne bearbeiten, Auswertungen, Verwaltung)
-- hatte die IT bisher nicht.
INSERT INTO "settings" ("key", "value")
SELECT 'permissions', jsonb_build_object('it', COALESCE((
  SELECT jsonb_agg(CASE WHEN a.value = 'plans' THEN 'plansView' ELSE a.value END ORDER BY a.ordinality)
  FROM jsonb_array_elements_text("value"->'it') WITH ORDINALITY AS a(value, ordinality)
), '[]'::jsonb))
FROM "settings" WHERE "key" = 'areas'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'areas';
