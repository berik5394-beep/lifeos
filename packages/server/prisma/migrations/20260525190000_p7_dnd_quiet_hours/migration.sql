-- Phase 7 P1: DND quiet hours (additive only, AGENTS.md §3)
-- Формат "HH:MM" локально (по User.timezone). null = DND off.
-- Логика в push-service.ts:deliverNotification — defer если now ∈ [start, end].
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quietHoursStart" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quietHoursEnd" TEXT;
