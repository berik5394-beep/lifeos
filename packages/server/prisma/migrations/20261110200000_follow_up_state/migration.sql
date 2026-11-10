-- «Незакрытое»: состояние вопроса (C) — спросил / человек ответил / исход.
ALTER TABLE "FollowUpLog" ADD COLUMN IF NOT EXISTS "text" TEXT;
ALTER TABLE "FollowUpLog" ADD COLUMN IF NOT EXISTS "askedAt" TIMESTAMP(3);
ALTER TABLE "FollowUpLog" ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP(3);
ALTER TABLE "FollowUpLog" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
