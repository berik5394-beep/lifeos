import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Модель замокана: проверяем факты, гард чисел и откат на шаблон.
const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({ createAnthropic: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }) }));
const { gatherBriefExtras, composeMorningBrief, briefNumbersHonest } = await import('./morning-brief.js');

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const NOW = new Date('2026-11-07T03:00:00Z'); // 08:00 Алматы
const user = async (style = 'toxic') =>
  (
    await prisma.user.create({
      data: { email: `mb-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'Asia/Almaty', assistantStyle: style },
    })
  ).id;
beforeEach(() => {
  create.mockReset();
  process.env.CLAUDE_API_KEY = 'test-key';
});

describe('факты брифа', () => {
  it('бюджет месяца и долг со сроком сегодня', async () => {
    const userId = await user();
    await prisma.budgetLimit.create({ data: { userId, category: 'food', monthlyLimit: 100000, month: 11, year: 2026 } });
    await prisma.expense.create({ data: { userId, date: new Date('2026-11-03T00:00:00Z'), category: 'food', description: 'обед', amount: 85000 } });
    await prisma.obligation.create({
      data: { userId, personName: 'Ахмет', direction: 'i_owe', kind: 'money', description: 'долг', amount: 50000, dueDate: new Date('2026-11-07T00:00:00Z'), source: 'manual' },
    });
    // Запас денег считается всегда (флаг runway удалён): расходы без доходов →
    // тревожная строка «накоплен минус» между бюджетом и сроками.
    expect(await gatherBriefExtras(userId, 'Asia/Almaty', NOW)).toEqual([
      'бюджет месяца: потрачено 85 000 из 100 000 ₸ (85%)',
      '💸 По записям расходы давно обгоняют доходы (накоплен минус). Стоит сократить траты.',
      'срок сегодня: отдать Ахмет 50 000 ₸',
    ]);
  });

  it('доход месяца, цели недели и месяца, вчера по дневнику и свой фокус недели', async () => {
    const userId = await user();
    await prisma.income.create({ data: { userId, date: new Date('2026-11-05T00:00:00Z'), source: 'зарплата', amount: 350000 } });
    await prisma.weeklyGoal.createMany({
      data: [
        { userId, weekStart: new Date('2026-11-02T00:00:00Z'), goalText: 'спорт', completed: true },
        { userId, weekStart: new Date('2026-11-02T00:00:00Z'), goalText: 'книга', completed: false },
      ],
    });
    await prisma.monthlyGoal.create({ data: { userId, monthStart: new Date('2026-11-01T00:00:00Z'), goalText: 'отпуск' } });
    await prisma.journalEntry.create({ data: { userId, date: new Date('2026-11-06T00:00:00Z'), sleepHours: 6, mood: 4, energy: 5 } });
    await prisma.weekNote.create({ data: { userId, weekStart: new Date('2026-11-02T00:00:00Z'), improve: 'ложиться до 23' } });
    expect(await gatherBriefExtras(userId, 'Asia/Almaty', NOW)).toEqual([
      'доход за месяц: 350 000 ₸',
      'цели недели: закрыто 1 из 2',
      'цели месяца: закрыто 0 из 1',
      'вчера по дневнику: сон 6 ч, настроение 4/10, энергия 5/10; фокус недели (сам записал): «ложиться до 23»',
    ]);
  });
});

describe('пересказ мозгом', () => {
  it('стиль юзера уходит в модель; честный ответ — как есть', async () => {
    const userId = await user('toxic');
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: '3 задачи, а ты спишь? Подъём.' }] });
    const out = await composeMorningBrief(userId, '3 задачи на сегодня. Начнём?', NOW);
    expect(out).toBe('3 задачи, а ты спишь? Подъём.');
    expect(String(create.mock.calls[0][0].system)).toContain('токсичный');
  });

  it('модель выдумала число → честный шаблон из фактов', async () => {
    const userId = await user();
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'У тебя 7 задач и 2 встречи!' }] });
    expect(await composeMorningBrief(userId, '3 задачи на сегодня. Начнём?', NOW)).toBe('3 задачи на сегодня. Начнём?');
  });

  it('нет ключа / сбой модели → шаблон, без падения', async () => {
    const userId = await user();
    delete process.env.CLAUDE_API_KEY;
    expect(await composeMorningBrief(userId, '1 задача на сегодня. Начнём?', NOW)).toBe('1 задача на сегодня. Начнём?');
    process.env.CLAUDE_API_KEY = 'k';
    create.mockRejectedValueOnce(new Error('overloaded'));
    expect(await composeMorningBrief(userId, '1 задача на сегодня. Начнём?', NOW)).toBe('1 задача на сегодня. Начнём?');
  });
});

describe('briefNumbersHonest', () => {
  it('числа с разделителями тысяч сравниваются как числа', () => {
    expect(briefNumbersHonest('Отдай Ахмету 50 000 сегодня', 'срок сегодня: отдать Ахмет 50 000 ₸')).toBe(true);
    expect(briefNumbersHonest('Отдай 60 000', 'отдать 50 000')).toBe(false);
  });
});
