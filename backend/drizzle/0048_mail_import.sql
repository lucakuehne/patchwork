ALTER TABLE "incoming_mails" ADD COLUMN "imported_by_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "import_info" jsonb;--> statement-breakpoint
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_imported_by_id_users_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;