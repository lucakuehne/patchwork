ALTER TABLE "entries" ADD COLUMN "original_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "time_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "time_changed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_time_changed_by_id_users_id_fk" FOREIGN KEY ("time_changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;