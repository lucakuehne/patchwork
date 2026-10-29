CREATE TABLE "helpspot_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"started_by_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"since" timestamp with time zone,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "helpspot_tickets" (
	"number" integer PRIMARY KEY NOT NULL,
	"item_id" uuid,
	"raw" jsonb NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"reporter_name" text DEFAULT '' NOT NULL,
	"message_id" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "helpspot_import_runs" ADD CONSTRAINT "helpspot_import_runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpspot_tickets" ADD CONSTRAINT "helpspot_tickets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpspot_tickets_item_idx" ON "helpspot_tickets" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "helpspot_tickets_message_idx" ON "helpspot_tickets" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_external_id_uq" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_external_id_uq" UNIQUE("external_id");