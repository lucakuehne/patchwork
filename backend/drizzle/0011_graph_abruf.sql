ALTER TABLE "mailboxes" ADD COLUMN "graph_folder_id" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "graph_sync" jsonb;