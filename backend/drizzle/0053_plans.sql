ALTER TYPE "public"."audit_area" ADD VALUE 'plans';--> statement-breakpoint
CREATE TABLE "plan_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"plan_storage_key" text,
	"plan_content_type" text,
	"plan_width_px" integer,
	"plan_height_px" integer,
	"plan_meters_per_px" double precision,
	"plan_x" double precision DEFAULT 0 NOT NULL,
	"plan_y" double precision DEFAULT 0 NOT NULL,
	"plan_calibrated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floor_id" uuid NOT NULL,
	"text" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"points" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_buildings" ADD CONSTRAINT "plan_buildings_site_id_plan_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."plan_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_floors" ADD CONSTRAINT "plan_floors_building_id_plan_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."plan_buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_labels" ADD CONSTRAINT "plan_labels_floor_id_plan_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."plan_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rooms" ADD CONSTRAINT "plan_rooms_floor_id_plan_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."plan_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_buildings_site_idx" ON "plan_buildings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "plan_floors_building_idx" ON "plan_floors" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "plan_labels_floor_idx" ON "plan_labels" USING btree ("floor_id");--> statement-breakpoint
CREATE INDEX "plan_rooms_floor_idx" ON "plan_rooms" USING btree ("floor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_rooms_floor_name_uq" ON "plan_rooms" USING btree ("floor_id",lower("name"));