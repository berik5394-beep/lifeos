-- Phase 6 C1 Safety — sensitive crisis-флаг на ChatMessage.
-- АДДИТИВНО (правило ISSUE-X / DEPLOY FOOTGUN: до cutover db push→
-- migrate deploy схема только аддитивна). IF NOT EXISTS —
-- идемпотентно. Без DROP. default false → существующие строки
-- безопасно получают false (не кризисные).
-- Индекс (crisis, createdAt) — purge-cron retention 30д + быстрый
-- analytics-exclusion фильтр.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "crisis" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "ChatMessage_crisis_createdAt_idx" ON "ChatMessage"("crisis", "createdAt");
