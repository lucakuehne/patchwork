CREATE TYPE "public"."incoming_result" AS ENUM('created', 'reply', 'note', 'automated', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "incoming_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"mailbox_id" uuid,
	"from_address" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb NOT NULL,
	"subject" text NOT NULL,
	"mail_date" timestamp with time zone,
	"result" "incoming_result" NOT NULL,
	"reason" text,
	"item_id" uuid,
	"entry_id" uuid,
	"simulated" boolean DEFAULT false NOT NULL,
	"simulated_by_id" uuid,
	"attempts" integer DEFAULT 1 NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "incoming_mails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_simulated_by_id_users_id_fk" FOREIGN KEY ("simulated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incoming_mails_created_idx" ON "incoming_mails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "incoming_mails_result_idx" ON "incoming_mails" USING btree ("result");