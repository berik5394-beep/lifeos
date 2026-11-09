-- Аудит 2026-11-09: архивные (старый план цели) привычки были active=true — видны
-- рядом с новыми, «отметь X» попадало в них. Архив = неактивна (archivedAt остаётся).
UPDATE "Habit" SET "active" = false WHERE "archivedAt" IS NOT NULL AND "active" = true;
