-- Phase 6 C2 — UserProfile (синтезированный «характер», производная
-- вьюха над Memory; НЕ вторая память). АДДИТИВНО (правило ISSUE-X /
-- DEPLOY FOOTGUN: до cutover db push→migrate deploy схема только
-- аддитивна). IF NOT EXISTS — идемпотентно. Без DROP. Новая таблица
-- → существующие данные не трогаются.
CREATE TABLE IF NOT EXISTS "UserProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "values" JSONB NOT NULL DEFAULT '[]',
  "triggers" JSONB NOT NULL DEFAULT '[]',
  "patterns" JSONB NOT NULL DEFAULT '[]',
  "styleNotes" TEXT,
  "relationships" JSONB NOT NULL DEFAULT '{}',
  "lastSynthesizedAt" TIMESTAMP(3),
  "synthesisVersion" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_userId_key"
  ON "UserProfile"("userId");

DO $$ BEGIN
  ALTER TABLE "UserProfile"
    ADD CONSTRAINT "UserProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
