-- Weitere Texte aus HelpSpot mit HTML ohne Kennzeichen: «<br />» oder Entitäten wie «&quot;» mitten im Text (z.B.
-- Fehlermeldungen beim Mailversand). 0041 hat nur Texte erfasst, die mit einem Tag beginnen. Neue Importe wandeln
-- solche Texte gleich um (normalizeTicket).
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
UPDATE "entries"
SET "meta" = jsonb_set("meta", '{text}', to_jsonb(pg_temp.helpspot_text("meta"->>'text')))
WHERE "kind" = 'change' AND "meta"->>'field' = 'helpspot'
  AND ("meta"->>'text' ~* '<br\s*/?>' OR "meta"->>'text' ~ '&(quot|amp|lt|gt|nbsp|#[0-9]+);');--> statement-breakpoint
UPDATE "entries"
SET "body" = pg_temp.helpspot_text("body")
WHERE "kind" IN ('reply', 'note') AND "meta"->>'source' = 'helpspot' AND "body_html" IS NULL
  AND ("body" ~* '<br\s*/?>' OR "body" ~ '&(quot|amp|lt|gt|nbsp|#[0-9]+);');--> statement-breakpoint
UPDATE "items"
SET "description" = pg_temp.helpspot_text("description")
WHERE "prefix" = 'HS' AND "description_html" IS NULL
  AND ("description" ~* '<br\s*/?>' OR "description" ~ '&(quot|amp|lt|gt|nbsp|#[0-9]+);');--> statement-breakpoint
DROP FUNCTION pg_temp.helpspot_text(text);
