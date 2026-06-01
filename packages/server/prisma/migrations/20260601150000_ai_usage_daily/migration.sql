-- 2.3 (AUDIT-2026-06): durable дневной AI-бюджет (per-user). Идемпотентно.
CREATE TABLE IF NOT EXISTS "AiUsageDaily" (
  "userId" TEXT NOT NULL,
  "day"    DATE NOT NULL,
  "count"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AiUsageDaily_pkey" PRIMARY KEY ("userId", "day")
);
