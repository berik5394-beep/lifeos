import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPendingAction, peekPendingAction, takePendingAction, BATCH_ACTION } from './pending-actions.js';
import { runConfirmedAction } from './jarvis-orchestrator.js';
import { runInTurn } from '../lib/turn-context.js';

/** M9 (аудит 2026-11-09): два вопроса за ход → одно «да» выполняет оба, по-настоящему в БД. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('общий вопрос «да?» за ход', () => {
  it('две траты в одном ходе → один вопрос → «да» записывает обе', async () => {
    const u = await prisma.user.create({ data: { email: `batch-${Date.now()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'UTC' } });
    await runInTurn(async () => {
      await setPendingAction(u.id, 'add_expense', { amount: 5000, category: 'transport', description: 'такси' }, 'Записать расход 5000 ₸ (такси)? Подтверди — запишу.');
      await setPendingAction(u.id, 'add_expense', { amount: 1500, category: 'food', description: 'кофе' }, 'Записать расход 1500 ₸ (кофе)? Подтверди — запишу.');
    });
    const p = await peekPendingAction(u.id);
    expect(p?.action).toBe(BATCH_ACTION);
    expect(p?.confirmationText).toContain('• Записать расход 5000 ₸ (такси)');

    const taken = await takePendingAction(u.id);
    const reply = await runConfirmedAction(u.id, taken!.action, taken!.input);
    const rows = await prisma.expense.findMany({ where: { userId: u.id }, orderBy: { amount: 'asc' } });
    expect(rows.map((r) => r.amount)).toEqual([1500, 5000]);
    expect(reply.split('\n')).toHaveLength(2);
  });

  it('новый ход — новый вопрос затирает старый (как раньше)', async () => {
    const u = await prisma.user.create({ data: { email: `batch2-${Date.now()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'UTC' } });
    await runInTurn(async () => {
      await setPendingAction(u.id, 'add_expense', { amount: 100, category: 'food' }, 'Записать расход 100 ₸?');
    });
    await runInTurn(async () => {
      await setPendingAction(u.id, 'add_expense', { amount: 200, category: 'food' }, 'Записать расход 200 ₸?');
    });
    const p = await peekPendingAction(u.id);
    expect(p?.action).toBe('add_expense');
    expect(p?.input.amount).toBe(200);
  });
});
