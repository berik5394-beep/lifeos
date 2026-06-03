-- ИИ-оценка усилия недельной цели (минуты/неделя). Nullable, additive,
-- идемпотентно. Питает month-load (срез МЕСЯЦ движка пересечения).
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER;
