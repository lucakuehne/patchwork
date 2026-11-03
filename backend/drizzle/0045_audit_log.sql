CREATE TYPE "public"."audit_area" AS ENUM('items', 'portal', 'admin', 'account');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"impersonator_id" uuid,
	"impersonator_name" text,
	"area" "audit_area" NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"item_id" uuid
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonator_id_users_id_fk" FOREIGN KEY ("impersonator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_item_idx" ON "audit_log" USING btree ("item_id");