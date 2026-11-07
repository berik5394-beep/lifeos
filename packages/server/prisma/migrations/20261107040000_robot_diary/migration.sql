-- Дневник робота (робот-друг №3). ИДЕМПОТЕНТНА, аддитивна.
CREATE TABLE IF NOT EXISTS "RobotDiaryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'facts',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RobotDiaryEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RobotDiaryEntry_userId_day_key" ON "RobotDiaryEntry"("userId", "day");
DO $$ BEGIN
    ALTER TABLE "RobotDiaryEntry" ADD CONSTRAINT "RobotDiaryEntry_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
