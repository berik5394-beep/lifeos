-- Phase 0.3: удаление фичи калорий/питания.
-- Идемпотентно: дропаем таблицу NutritionLog, если она есть.
DROP TABLE IF EXISTS "NutritionLog";
