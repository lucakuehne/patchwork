ALTER TABLE "items" DROP CONSTRAINT "items_number_unique";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "prefix" text DEFAULT 'PW' NOT NULL;--> statement-breakpoint
CREATE INDEX "items_number_idx" ON "items" USING btree ("number");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_prefix_number_uq" UNIQUE("prefix","number");