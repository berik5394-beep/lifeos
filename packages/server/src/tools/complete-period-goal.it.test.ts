import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { completePeriodGoalTool } from './complete-period-goal.js';
import { localMonthOnlyUTC, localWeekStartUTC } from '../lib/tz.js';
import { detectSkillOpportunity, renderTemplate, TEMPLATES } from '../services/v2-proactivity-engine.js';

/**
 * Обещания робота (аудит 2026-11-08) — настоящая тест-БД:
 *  - «Успеем?» по цели недели/месяца → на «уже сделал» теперь есть чем отметить;
 *  - предложение навыка называет, ЧТО повторяется (иначе «да» не из чего собрать).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `pg-${tag}-${Date.now()}@a.test`, name: 'P', passwordHash: 'x', timezone: 'UTC' } });
  return u.id;
}
type Res = { message: string };
const run = (userId: string, input: Record<string, unknown>) => completePeriodGoalTool.handler(input as never, { userId } as never) as Promise<Res>;

describe('complete_period_goal', () => {
  it('цель недели → выполнена, «осталось N из M»; undo → обратно', async () => {
    const userId = await user('w');
    const weekStart = localWeekStartUTC('UTC');
    const g = await prisma.weeklyGoal.create({ data: { userId, weekStart, goalText: 'Закрыть отчёт' } });
    await prisma.weeklyGoal.create({ data: { userId, weekStart, goalText: 'Три тренировки' } });
    expect((await run(userId, { goal: 'отчёт' })).message).toBe('Отметил цель недели «Закрыть отчёт» выполненной. Осталось 1 из 2.');
    expect((await prisma.weeklyGoal.findUnique({ where: { id: g.id } }))?.completed).toBe(true);
    expect((await run(userId, { goal: 'отчёт', undo: true })).message).toBe('Вернул цель недели «Закрыть отчёт» в открытые.');
    expect((await prisma.weeklyGoal.findUnique({ where: { id: g.id } }))?.completed).toBe(false);
  });

  it('цель месяца; последняя → «все закрыты»; нет такой — честно со списком; чужие не видны', async () => {
    const a = await user('m');
    const b = await user('other');
    await prisma.monthlyGoal.create({ data: { userId: a, monthStart: localMonthOnlyUTC('UTC'), goalText: 'Закрыть 3 сделки' } });
    await prisma.monthlyGoal.create({ data: { userId: b, monthStart: localMonthOnlyUTC('UTC'), goalText: 'Чужая цель' } });
    expect((await run(a, { goal: 'сделки', period: 'month' })).message).toBe('Отметил цель месяца «Закрыть 3 сделки» выполненной. Все цели закрыты — красавчик!');
    expect((await run(a, { goal: 'Чужая цель' })).message).toBe('Не нашёл цель «Чужая цель». Сейчас: «Закрыть 3 сделки». Какую?');
  });
});

describe('предложение навыка называет действия', () => {
  it('частые вместе задачи+траты+привычки → текст с ними и «Скажи «да»»', async () => {
    const userId = await user('skill');
    const rows = [];
    for (let d = 1; d <= 4; d++) {
      for (const toolName of ['get_today', 'add_expense', 'complete_habit']) {
        rows.push({ userId, toolName, inputJson: {}, durationMs: 1, createdAt: new Date(Date.now() - d * 86_400_000) });
      }
    }
    await prisma.toolCall.createMany({ data: rows });
    const [c] = await detectSkillOpportunity(userId);
    const actions = String(c.payload.actions);
    expect(actions.split(', ').sort()).toEqual(['записываешь траты', 'отмечаешь привычки', 'смотришь план дня']);
    const text = renderTemplate(TEMPLATES.skill_suggestion.curious as string, c.payload);
    expect(text).toBe(`Заметил, что ты часто делаешь вместе: ${actions}. Хочешь, соберу это в навык — будешь запускать одной фразой? Скажи «да».`);
  });
});
