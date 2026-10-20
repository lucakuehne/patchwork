-- Bestehende Status erhalten die bisherige Farbe ihrer Kategorie
UPDATE "statuses" SET "color" = CASE "category"
  WHEN 'new' THEN 'blue'
  WHEN 'in_progress' THEN 'orange'
  WHEN 'waiting' THEN 'gray'
  WHEN 'done' THEN 'green'
  WHEN 'rejected' THEN 'red'
  ELSE 'gray'
END;
