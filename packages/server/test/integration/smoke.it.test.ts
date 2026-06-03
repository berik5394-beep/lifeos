import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('integration smoke', () => {
  it('подключается к тест-БД и видит применённую схему', async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 as one`;
      expect(rows[0].one).toBe(1);
      // Таблица из миграций существует → schema применена.
      const users = await prisma.user.count();
      expect(typeof users).toBe('number');
    } finally {
      await prisma.$disconnect();
    }
  });
});
