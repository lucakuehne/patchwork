-- Im Eingang (ohne Typ) gibt es weder Priorität noch Zuständig (Entscheid vom 13.11.2026): bestehende Vorgänge ohne
-- Typ zurücksetzen, ohne Eintrag im Verlauf und ohne Mail
UPDATE "items" SET "assignee_id" = NULL, "priority" = 'normal' WHERE "type" IS NULL AND ("assignee_id" IS NOT NULL OR "priority" <> 'normal');
