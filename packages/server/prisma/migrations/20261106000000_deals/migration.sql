-- Сделки (спека 2026-11-05-deals). ИДЕМПОТЕНТНА, аддитивна.
CREATE TABLE IF NOT EXISTS "Deal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personEntityId" TEXT,
    "personName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT '₸',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextStepAt" DATE,
    "nextStepText" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "wonIncomeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_wonIncomeId_key" ON "Deal"("wonIncomeId");
CREATE INDEX IF NOT EXISTS "Deal_userId_stage_idx" ON "Deal"("userId", "stage");
CREATE INDEX IF NOT EXISTS "Deal_userId_nextStepAt_idx" ON "Deal"("userId", "nextStepAt");

CREATE TABLE IF NOT EXISTS "DealEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "text" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DealEvent_dealId_at_idx" ON "DealEvent"("dealId", "at");

CREATE TABLE IF NOT EXISTS "SalesPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthStart" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesPlan_userId_monthStart_key" ON "SalesPlan"("userId", "monthStart");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_userId_fkey') THEN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_personEntityId_fkey') THEN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_personEntityId_fkey" FOREIGN KEY ("personEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DealEvent_dealId_fkey') THEN
  ALTER TABLE "DealEvent" ADD CONSTRAINT "DealEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalesPlan_userId_fkey') THEN
  ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
