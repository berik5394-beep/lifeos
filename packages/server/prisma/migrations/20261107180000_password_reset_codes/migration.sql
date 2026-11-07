-- «Забыли пароль?»: одноразовые коды сброса. ИДЕМПОТЕНТНА, аддитивна.
CREATE TABLE IF NOT EXISTS "PasswordResetCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PasswordResetCode_userId_createdAt_idx" ON "PasswordResetCode"("userId", "createdAt");
DO $$ BEGIN
    ALTER TABLE "PasswordResetCode" ADD CONSTRAINT "PasswordResetCode_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
