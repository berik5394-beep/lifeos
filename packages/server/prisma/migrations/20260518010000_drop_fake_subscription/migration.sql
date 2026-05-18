-- AlterTable
-- SSOT P0 billing: фейковая подписка удалена целиком (тарифов нет,
-- весь функционал доступен всем). subscriptionTier/subscriptionExpiresAt
-- читались/писались ТОЛЬКО мёртвым subscription.ts (тоже удалён) и
-- никогда не давали pro/premium (только сброс в 'free'). Колонки
-- больше не нужны — не существующий код не врёт. IF EXISTS: прод
-- синкается через `prisma db push`, колонки могли уже исчезнуть.
ALTER TABLE "User" DROP COLUMN IF EXISTS "subscriptionTier";
ALTER TABLE "User" DROP COLUMN IF EXISTS "subscriptionExpiresAt";
