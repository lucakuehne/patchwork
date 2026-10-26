ALTER TABLE "mailboxes" ADD COLUMN "error_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD COLUMN "dismissed_at" timestamp with time zone;