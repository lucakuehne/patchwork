ALTER TABLE "users" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Vor- und Nachname aus dem Namen schätzen, wie splitName (users/user-names.ts); AD-Konten erhalten sie bei der
-- nächsten Anmeldung aus givenName/sn. Gearbeitet wird mit dem normalisierten Namen n (Leerraum zu einem Leerzeichen,
-- aussen ohne Leerzeichen); jeder Wert ist gegen NULL abgesichert (die Spalten sind NOT NULL). «Muster, Anna»:
UPDATE "users" u SET
  "last_name" = coalesce(btrim(split_part(x.n, ',', 1)), ''),
  "first_name" = coalesce(btrim(substr(x.n, strpos(x.n, ',') + 1)), '')
FROM (SELECT "id", btrim(regexp_replace("name", '\s+', ' ', 'g')) AS n FROM "users") x
WHERE u."id" = x."id" AND strpos(x.n, ',') > 0;--> statement-breakpoint
-- Mehrere Wörter: letztes Wort = Nachname
UPDATE "users" u SET
  "first_name" = coalesce(regexp_replace(x.n, ' \S+$', ''), ''),
  "last_name" = coalesce(substring(x.n from '\S+$'), '')
FROM (SELECT "id", btrim(regexp_replace("name", '\s+', ' ', 'g')) AS n FROM "users") x
WHERE u."id" = x."id" AND strpos(x.n, ',') = 0 AND strpos(x.n, ' ') > 0;--> statement-breakpoint
-- Aus der E-Mail gebildet, z.B. «anna.muster»: Teile an «.» und «_», Trenner aussen zählen nicht («a.b_» → A / B)
UPDATE "users" u SET
  "first_name" = coalesce(initcap(regexp_replace(regexp_replace(x.m, '[._]+[^._]*$', ''), '[._]+', ' ', 'g')), ''),
  "last_name" = coalesce(initcap(substring(x.m from '[^._]+$')), '')
FROM (
  SELECT "id", btrim(btrim(regexp_replace("name", '\s+', ' ', 'g')), '._') AS m, btrim(regexp_replace("name", '\s+', ' ', 'g')) AS n
  FROM "users"
) x
WHERE u."id" = x."id" AND strpos(x.n, ',') = 0 AND strpos(x.n, ' ') = 0 AND strpos(x.n, '@') = 0 AND x.m ~ '[._]';--> statement-breakpoint
-- Ein einzelnes Wort gilt als Vorname
UPDATE "users" SET "first_name" = btrim(regexp_replace("name", '\s+', ' ', 'g')) WHERE "first_name" = '' AND "last_name" = '';--> statement-breakpoint
-- Textbausteine: {{Melder}} und {{Bearbeiter}} werden zu Vor- und Nachname
UPDATE "snippets" SET "body" = regexp_replace(
  regexp_replace("body", '\{\{\s*Melder\s*\}\}', '{{Melder Vorname}} {{Melder Nachname}}', 'gi'),
  '\{\{\s*Bearbeiter\s*\}\}', '{{Bearbeiter Vorname}} {{Bearbeiter Nachname}}', 'gi');--> statement-breakpoint
-- E-Mail-Vorlagen bestehender Installationen: Standard-Fusszeilen mit {{App}} als eigene Vorlage festhalten, damit dort
-- gleich unten der App-Name eingesetzt wird (neue Standard-Fusszeilen kommen ohne {{App}} aus)
INSERT INTO "settings" ("key", "value") SELECT 'mailTemplates', '{}'::jsonb WHERE EXISTS (SELECT 1 FROM "users")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{reporterFooter}', coalesce("value"->'reporterFooter', '{}'::jsonb) ||
  jsonb_build_object('body', '{{App}} · {{Nummer}}' || chr(10) || 'Bitte lassen Sie bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.'))
WHERE "key" = 'mailTemplates' AND "value"->'reporterFooter'->>'body' IS NULL;--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{staffFooter}', coalesce("value"->'staffFooter', '{}'::jsonb) ||
  jsonb_build_object('body', '{{App}} · Benachrichtigung zu {{Nummer}}'))
WHERE "key" = 'mailTemplates' AND "value"->'staffFooter'->>'body' IS NULL;--> statement-breakpoint
-- {{Melder}} und {{Zuständig}} werden zu Vor- und Nachname, {{App}} zum heutigen App-Namen (JSON-maskiert; im Ersatztext
-- von regexp_replace sind Backslashes zu verdoppeln)
UPDATE "settings" SET "value" = regexp_replace(
  regexp_replace(
    regexp_replace("value"::text, '\{\{\s*Melder\s*\}\}', '{{Melder Vorname}} {{Melder Nachname}}', 'gi'),
    '\{\{\s*Zuständig\s*\}\}', '{{Zuständig Vorname}} {{Zuständig Nachname}}', 'gi'),
  '\{\{\s*App\s*\}\}',
  replace(
    (SELECT substr(j, 2, length(j) - 2) FROM (SELECT to_json(coalesce((SELECT "value"->>'appName' FROM "settings" WHERE "key" = 'general'), 'Patchwork'))::text AS j) t),
    '\', '\\'),
  'gi')::jsonb
WHERE "key" = 'mailTemplates';
