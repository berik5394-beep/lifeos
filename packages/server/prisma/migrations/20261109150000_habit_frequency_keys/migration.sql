-- Аудит 2026-11-09: частота привычки от мозга была свободной строкой («3 раза в неделю») —
-- экран делит строго на daily/weekly/monthly, такие привычки не было видно.
UPDATE "Habit" SET "frequency" = 'monthly'
  WHERE "frequency" NOT IN ('daily', 'weekly', 'monthly') AND ("frequency" ILIKE '%month%' OR "frequency" ILIKE '%месяц%');
UPDATE "Habit" SET "frequency" = 'weekly'
  WHERE "frequency" NOT IN ('daily', 'weekly', 'monthly') AND ("frequency" ILIKE '%week%' OR "frequency" ILIKE '%недел%' OR "frequency" ILIKE '%выходн%');
UPDATE "Habit" SET "frequency" = 'daily'
  WHERE "frequency" NOT IN ('daily', 'weekly', 'monthly');
