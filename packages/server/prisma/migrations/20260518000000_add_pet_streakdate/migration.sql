-- AlterTable
-- SSOT P0 Pet.streak: streakDate жил только в schema.prisma (прод
-- синкается через `prisma db push`, поэтому колонка в БД уже есть);
-- файл миграции добавлен для гигиены истории — чтобы будущий
-- переход на `prisma migrate deploy` не сломался на рассинхроне.
ALTER TABLE "Pet" ADD COLUMN IF NOT EXISTS "streakDate" DATE;
