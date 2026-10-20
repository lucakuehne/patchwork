CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"label" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;