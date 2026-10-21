ALTER TABLE "items" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "due_notified_on" date;--> statement-breakpoint
-- Meldeweg «Intern» (Glocke) für selbst bemerkte Dinge, ans Ende der Liste; nicht, wenn es ihn schon gibt
INSERT INTO "channels" ("key", "label", "icon", "position")
SELECT NULL, 'Intern', 'alert', coalesce(max("position"), -1) + 1 FROM "channels"
WHERE NOT EXISTS (SELECT 1 FROM "channels" WHERE lower("label") = 'intern');
