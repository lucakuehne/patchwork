ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
-- Bestehende Konten: Eine Anmeldung ist auch Aktivität, bis zur nächsten Anfrage gilt sie als «zuletzt aktiv»
UPDATE "users" SET "last_active_at" = "last_login_at";
