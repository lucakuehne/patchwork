ALTER TABLE "entries" ADD COLUMN "recorded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Testbetrieb je Typ (Entscheid vom 28.10.2026): die bisherige Einstellung gilt für alle drei Blöcke
UPDATE "settings" SET "value" = jsonb_build_object('general', "value", 'incident', "value", 'task', "value")
WHERE "key" = 'mail' AND "value" ? 'staff';
