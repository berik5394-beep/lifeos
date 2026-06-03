import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPendingAction, takePendingAction } from './pending-actions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function makeUser(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email, name: 'Money', passwordHash: 'x' },
  });
  return u.id;
}

describe('pending-actions атомарность по РЕАЛЬНОЙ БД (Fix #1)', () => {
  it('два параллельных take → действие достаётся ровно один раз', async () => {
    const userId = await makeUser('money-race@a.test');
    await setPendingAction(userId, 'add_expense', { amount: 5000, category: 'food' }, 'трата 5000');

    const [a, b] = await Promise.all([
      takePendingAction(userId),
      takePendingAction(userId),
    ]);

    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.action).toBe('add_expense');
    // PendingAction в БД больше нет (consume прошёл).
    expect(await takePendingAction(userId)).toBeNull();
  });

  it('повторный take после consume → null (не дубль)', async () => {
    const userId = await makeUser('money-once@a.test');
    await setPendingAction(userId, 'add_income', { amount: 1000 }, 'доход');
    expect(await takePendingAction(userId)).not.toBeNull();
    expect(await takePendingAction(userId)).toBeNull();
  });
});
