-- CashSnapshot: точка отсчёта баланса для runway «на сколько хватит».
-- Референсная точка (balance, asOf), НЕ денежный ledger. Идемпотентно
-- (IF NOT EXISTS) — таблица уже создана на проде ручным raw-SQL, поэтому
-- replay через migrate deploy безопасен (no-op на проде, fresh на тест-БД).
CREATE TABLE IF NOT EXISTS "CashSnapshot" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "balance"   DOUBLE PRECISION NOT NULL,
  "asOf"      DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashSnapshot_userId_asOf_idx" ON "CashSnapshot" ("userId", "asOf");

DO $$ BEGIN
  ALTER TABLE "CashSnapshot" ADD CONSTRAINT "CashSnapshot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
