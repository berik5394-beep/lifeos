-- Obligations: first-class «кто кому что должен». ИДЕМПОТЕНТНА (как reconcile):
-- CREATE TABLE/INDEX IF NOT EXISTS + FK через DO/pg_constraint → no-op на проде,
-- полная на чистой БД. .env=ПРОД, миграцию накатывает Railway migrate deploy.
CREATE TABLE IF NOT EXISTS "Obligation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personEntityId" TEXT,
    "personName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT DEFAULT '₸',
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Obligation_userId_status_dueDate_idx" ON "Obligation"("userId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Obligation_userId_personEntityId_idx" ON "Obligation"("userId", "personEntityId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Obligation_userId_fkey') THEN
  ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Obligation_personEntityId_fkey') THEN
  ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_personEntityId_fkey" FOREIGN KEY ("personEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END IF; END $$;
