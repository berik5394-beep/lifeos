-- TelegramLinkCode: одноразовый код привязки Telegram-чата (фикс дыры
-- /telegram/connect с произвольным chatId). ИДЕМПОТЕНТНА (IF NOT EXISTS +
-- FK через DO/pg_constraint), аддитивна — накатывает Railway migrate deploy.
CREATE TABLE IF NOT EXISTS "TelegramLinkCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "TelegramLinkCode" ADD COLUMN IF NOT EXISTS "confirmChatId" TEXT;

CREATE INDEX IF NOT EXISTS "TelegramLinkCode_userId_idx" ON "TelegramLinkCode"("userId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramLinkCode_userId_fkey') THEN
  ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
