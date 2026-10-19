ALTER TYPE "public"."mail_auth" ADD VALUE 'microsoft';--> statement-breakpoint
CREATE TABLE "held_mails" (
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
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_mails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "oauth_refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "oauth_account" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "fetch_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "held_mails" ADD CONSTRAINT "held_mails_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_mails" ADD CONSTRAINT "held_mails_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_mails" ADD CONSTRAINT "held_mails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "held_mails_created_idx" ON "held_mails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "held_mails_item_idx" ON "held_mails" USING btree ("item_id");