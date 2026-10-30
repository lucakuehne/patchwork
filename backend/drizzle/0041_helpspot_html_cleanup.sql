-- Aus HelpSpot übernommene Texte, die HelpSpot als HTML ohne Kennzeichen geliefert hat (z.B. die Protokolle
-- «Request Changed»), als Text: Zeilenumbruch nach Absätzen, ohne Tags, Entitäten aufgelöst. Neue Importe erkennen
-- solches HTML selbst (normalizeTicket).
CREATE FUNCTION pg_temp.helpspot_text(html text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(regexp_replace(html, '<style.*?</style>', '', 'gi'), '<script.*?</script>', '', 'gi'),
              '<br\s*/?>|</(p|div|li|tr|h[1-6]|blockquote)>', E'\n', 'gi'),
            '<[^>]*>', '', 'g'),
          '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
        '[ \t]+\n', E'\n', 'g'),
      '\n{3,}', E'\n\n', 'g'),
    E' \t\r\n')
$$;--> statement-breakpoint
-- Änderungen: ohne die Zeile «Request Changed:», im Verlauf steht ohnehin «in HelpSpot geändert»
UPDATE "entries"
SET "meta" = jsonb_set("meta", '{text}', to_jsonb(regexp_replace(pg_temp.helpspot_text("meta"->>'text'), '^Request Changed:\s*', '')))
WHERE "kind" = 'change' AND "meta"->>'field' = 'helpspot'
  AND ("meta"->>'text' ~ '<[a-zA-Z/]' OR "meta"->>'text' ~ '^\s*Request Changed:');--> statement-breakpoint
UPDATE "entries"
SET "body" = pg_temp.helpspot_text("body")
WHERE "kind" IN ('reply', 'note') AND "meta"->>'source' = 'helpspot' AND "body_html" IS NULL
  AND "body" ~* '^\s*<(div|p|span|br|table|ul|ol|font|html|body)\M';--> statement-breakpoint
UPDATE "items"
SET "description" = pg_temp.helpspot_text("description")
WHERE "prefix" = 'HS' AND "description_html" IS NULL
  AND "description" ~* '^\s*<(div|p|span|br|table|ul|ol|font|html|body)\M';--> statement-breakpoint
DROP FUNCTION pg_temp.helpspot_text(text);
