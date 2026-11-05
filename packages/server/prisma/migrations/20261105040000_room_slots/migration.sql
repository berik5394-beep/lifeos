-- Робот-эпик, Часть 6: ремонт за монеты — вариант каталога и ячейка у предмета комнаты.
ALTER TABLE "RoomItem" ADD COLUMN IF NOT EXISTS "variantKey" TEXT;
ALTER TABLE "RoomItem" ADD COLUMN IF NOT EXISTS "slot" TEXT;
ALTER TABLE "RoomItem" ALTER COLUMN "x" SET DEFAULT 0.5;
ALTER TABLE "RoomItem" ALTER COLUMN "y" SET DEFAULT 0.5;
CREATE UNIQUE INDEX IF NOT EXISTS "RoomItem_userId_slot_key" ON "RoomItem"("userId", "slot");
