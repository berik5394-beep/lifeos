-- Phase 6 C5 — User.therapeuticMode (opt-out тёплого режима).
-- Аддитивно, IF NOT EXISTS, NOT NULL DEFAULT true — существующие
-- юзеры получают true (north star), ISSUE-X-safe. Без DROP.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "therapeuticMode" BOOLEAN NOT NULL DEFAULT true;
