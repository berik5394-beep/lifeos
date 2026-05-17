-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolCall_userId_createdAt_idx" ON "ToolCall"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_userId_toolName_createdAt_idx" ON "ToolCall"("userId", "toolName", "createdAt");

