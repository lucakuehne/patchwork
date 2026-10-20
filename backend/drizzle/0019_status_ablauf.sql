CREATE TABLE "status_transitions" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	CONSTRAINT "status_transitions_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "color" text DEFAULT 'gray' NOT NULL;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "diagram_x" double precision;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN "diagram_y" double precision;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_from_id_statuses_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_to_id_statuses_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."statuses"("id") ON DELETE cascade ON UPDATE no action;