-- «Незакрытое» робота-друга: что предложено спросить «как прошло?» и что закрыто.
CREATE TABLE IF NOT EXISTS "FollowUpLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refKey" TEXT NOT NULL,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpLog_userId_refKey_key" ON "FollowUpLog"("userId", "refKey");
CREATE INDEX IF NOT EXISTS "FollowUpLog_userId_closedAt_idx" ON "FollowUpLog"("userId", "closedAt");
DO $$ BEGIN
  ALTER TABLE "FollowUpLog" ADD CONSTRAINT "FollowUpLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
