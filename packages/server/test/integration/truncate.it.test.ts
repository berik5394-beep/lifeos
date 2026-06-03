import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Два теста: первый вставляет юзера, второй ОБЯЗАН видеть пустую таблицу.
// Если TRUNCATE-beforeEach не работает — второй тест увидит юзера из первого.
describe('truncate isolation', () => {
  it('тест A: вставляет юзера', async () => {
    await prisma.user.create({
      data: {
        email: 'a@truncate.test',
        name: 'A',
        passwordHash: 'x',
      },
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('тест B: видит пустую таблицу (beforeEach почистил)', async () => {
    expect(await prisma.user.count()).toBe(0);
  });
});
