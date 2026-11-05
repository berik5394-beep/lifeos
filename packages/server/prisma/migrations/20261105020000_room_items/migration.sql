-- Робот-эпик, Часть 4: мебель в комнате робота. ИДЕМПОТЕНТНА (IF NOT EXISTS +
-- FK через DO/pg_constraint), аддитивна — накатывает Railway migrate deploy.
CREATE TABLE IF NOT EXISTS "RoomItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RoomItem_userId_idx" ON "RoomItem"("userId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoomItem_userId_fkey') THEN
  ALTER TABLE "RoomItem" ADD CONSTRAINT "RoomItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
