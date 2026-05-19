-- Phase 5 P3.a — reflector schema foundation (R7 + R2 SSOT).
-- АДДИТИВНО (правило ISSUE-X: до cutover db push→migrate deploy
-- схема только аддитивна). IF NOT EXISTS — идемпотентно. Без DROP.
-- R7: User.reflectorTuning — per-user learning-loop (Json).
-- R2: Insight.dismissKey — связь с ЕДИНЫМ InsightDismissal-стором
--     (userFeedback из P1 НЕ дропаем — депрекейтнут в schema).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reflectorTuning" JSONB;
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "dismissKey" TEXT;
