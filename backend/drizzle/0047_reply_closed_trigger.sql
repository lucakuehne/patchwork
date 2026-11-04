-- Testbetrieb: Der neue Auslöser «Antwort mit Abschluss» (Entscheid vom 04.11.2026) übernimmt in den Blöcken Störungen
-- und Aufgaben die Einstellung von «Öffentliche Antwort», falls dort eine abweichende gesetzt ist.
UPDATE "settings" SET "value" = (
  SELECT jsonb_object_agg(
    block,
    CASE
      WHEN block IN ('incident', 'task') AND jsonb_typeof(conf->'triggers') = 'object'
        AND conf->'triggers' ? 'reply' AND NOT (conf->'triggers' ? 'replyClosed')
      THEN jsonb_set(conf, '{triggers,replyClosed}', conf->'triggers'->'reply')
      ELSE conf
    END
  )
  FROM jsonb_each("value") AS b(block, conf)
)
WHERE "key" = 'mail' AND jsonb_typeof("value") = 'object' AND "value" <> '{}'::jsonb;
