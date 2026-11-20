CREATE TABLE "plan_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floor_id" uuid NOT NULL,
	"kind" text DEFAULT 'room' NOT NULL,
	"name" text,
	"description" text DEFAULT '' NOT NULL,
	"points" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_floors" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "plan_floors" ADD COLUMN "walls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_floors" ADD COLUMN "pillars" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_floors" ADD COLUMN "openings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_areas" ADD CONSTRAINT "plan_areas_floor_id_plan_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."plan_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_areas_floor_idx" ON "plan_areas" USING btree ("floor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_areas_floor_name_uq" ON "plan_areas" USING btree ("floor_id",lower("name"));