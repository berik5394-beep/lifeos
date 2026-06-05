import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPendingAction, peekPendingAction } from './pending-actions.js';
import { runConfirmedAction } from './jarvis-orchestrator.js';
import { buildConfirmPrompt } from './confirm-prompt.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  process.env.FEATURE_V2_RUNWAY_BALANCE = 'all';
});

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'C', passwordHash: 'x' } });
  return u.id;
}

describe('confirm-bridge: стейдж → «да» → исполнение (без агента)', () => {
  it('clear_overdue: стейдж pending → confirmed → реально отменяет просрочки', async () => {
    const userId = await seedUser('cb-a@a.test');
    await prisma.task.create({
      data: { userId, title: 'старая', category: 'personal', priority: 'medium', date: new Date('2026-06-01'), completed: false },
    });
    const prompt = buildConfirmPrompt('clear_overdue', {});
    await setPendingAction(userId, 'clear_overdue', {}, prompt);
    const pend = await peekPendingAction(userId);
    expect(pend?.action).toBe('clear_overdue');
    await runConfirmedAction(userId, 'clear_overdue', {});
    const cancelled = await prisma.task.count({ where: { userId, cancelled: true } });
    expect(cancelled).toBe(1);
  });

  it('set_balance: confirmed → реально пишет CashSnapshot', async () => {
    const userId = await seedUser('cb-b@a.test');
    await setPendingAction(userId, 'set_balance', { balance: 500000 }, 'x');
    await runConfirmedAction(userId, 'set_balance', { balance: 500000 });
    const cnt = await prisma.cashSnapshot.count({ where: { userId } });
    expect(cnt).toBe(1);
  });
});
