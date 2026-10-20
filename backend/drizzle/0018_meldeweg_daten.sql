-- Meldewege vorbelegen; E-Mail und Portal setzt Patchwork selbst (Schlüssel «mail» bzw. «portal»)
INSERT INTO "channels" ("key", "label", "icon", "position") VALUES
  ('mail', 'E-Mail', 'mail', 0),
  ('portal', 'Portal', 'portal', 1),
  (NULL, 'Telefon', 'phone', 2),
  (NULL, 'Persönlich (Walk-In)', 'person', 3),
  (NULL, 'Teams/Chat', 'chat', 4),
  (NULL, 'Sonstiges', 'other', 5)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Bestehende Vorgänge: aus Mails «E-Mail», aus dem Portal «Portal», intern erfasste ohne Angabe
UPDATE "items" SET "channel_id" = (SELECT "id" FROM "channels" WHERE "key" = 'mail') WHERE "source" = 'mail' AND "channel_id" IS NULL;
--> statement-breakpoint
UPDATE "items" SET "channel_id" = (SELECT "id" FROM "channels" WHERE "key" = 'portal') WHERE "source" = 'portal' AND "channel_id" IS NULL;
