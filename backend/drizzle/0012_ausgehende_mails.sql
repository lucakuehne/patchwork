CREATE TYPE "public"."outgoing_status" AS ENUM('queued', 'sent', 'partial', 'held', 'failed');--> statement-breakpoint
CREATE TABLE "outgoing_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"entry_id" uuid,
	"mailbox_id" uuid,
	"from_address" text NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb NOT NULL,
	"subject" text NOT NULL,
	"automated" boolean NOT NULL,
	"status" "outgoing_status" NOT NULL,
	"delivered_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outgoing_mails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outgoing_mails_created_idx" ON "outgoing_mails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outgoing_mails_item_idx" ON "outgoing_mails" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "outgoing_mails_status_idx" ON "outgoing_mails" USING btree ("status");