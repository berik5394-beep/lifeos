-- Счётчик расхода моделей по дням (lib/ai-usage.ts): стоимость одного человека в день.
CREATE TABLE "AiUsageDay" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsageDay_day_userId_provider_model_key" ON "AiUsageDay"("day", "userId", "provider", "model");
CREATE INDEX "AiUsageDay_day_idx" ON "AiUsageDay"("day");

-- Человек был в приложении в этот день (UTC): удержание D1/D7, стоимость на человека.
CREATE TABLE "UserActiveDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "UserActiveDay_pkey" PRIMARY KEY ("userId", "day")
);

CREATE INDEX "UserActiveDay_day_idx" ON "UserActiveDay"("day");
