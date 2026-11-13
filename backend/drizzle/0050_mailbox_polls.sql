CREATE TABLE "mailbox_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"polls" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer NOT NULL,
	"mails" jsonb NOT NULL,
	"error" text,
	"triggered_by" text
);
--> statement-breakpoint
ALTER TABLE "mailbox_polls" ADD CONSTRAINT "mailbox_polls_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailbox_polls_mailbox_idx" ON "mailbox_polls" USING btree ("mailbox_id","started_at");--> statement-breakpoint
CREATE INDEX "mailbox_polls_ended_idx" ON "mailbox_polls" USING btree ("ended_at");