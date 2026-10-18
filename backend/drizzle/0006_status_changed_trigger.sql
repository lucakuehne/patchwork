-- Zeitpunkt des letzten Statuswechsels: per Trigger, damit kein Codepfad ihn vergessen kann
-- (Automatik «Wartet auf Melder»). Bestehende Vorgänge: letzter Status- bzw. Typ-Eintrag.
UPDATE "items" SET "status_changed_at" = coalesce(
  (SELECT max(e."created_at") FROM "entries" e WHERE e."item_id" = "items"."id" AND e."kind" IN ('status', 'type')),
  "items"."created_at"
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION items_status_changed() RETURNS trigger AS $$
BEGIN
  IF NEW."status_id" IS DISTINCT FROM OLD."status_id" THEN
    NEW."status_changed_at" := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER items_status_changed BEFORE UPDATE ON "items" FOR EACH ROW EXECUTE FUNCTION items_status_changed();
