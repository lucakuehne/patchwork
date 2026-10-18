CREATE TABLE "rule_runs" (
	"rule_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_runs_rule_id_item_id_status_changed_at_pk" PRIMARY KEY("rule_id","item_id","status_changed_at")
);
--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;