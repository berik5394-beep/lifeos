import type { PrismaClient } from '@prisma/client';

// Чистим все public-таблицы между тестами одним TRUNCATE … RESTART IDENTITY
// CASCADE. Имена тянем из information_schema, кроме служебной _prisma_migrations
// (её трогать нельзя — иначе пришлось бы migrate на каждый тест).
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
