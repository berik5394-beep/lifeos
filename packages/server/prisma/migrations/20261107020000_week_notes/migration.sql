-- Заметки недели на сервере (раньше только MMKV на телефоне). ИДЕМПОТЕНТНА, аддитивна.
-- updatedAt с DB-default: сырые вставки не упадут на NOT NULL (урок MoodSnapshot).
CREATE TABLE IF NOT EXISTS "WeekNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "improve" TEXT NOT NULL DEFAULT '',
    "gratitude" TEXT NOT NULL DEFAULT '',
    "wins" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeekNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WeekNote_userId_weekStart_key" ON "WeekNote"("userId", "weekStart");

DO $$ BEGIN
    ALTER TABLE "WeekNote" ADD CONSTRAINT "WeekNote_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
