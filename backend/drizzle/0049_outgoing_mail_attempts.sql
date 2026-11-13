ALTER TABLE "outgoing_mails" ADD COLUMN "attempt_log" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outgoing_mails" ADD COLUMN "next_attempt_at" timestamp with time zone;