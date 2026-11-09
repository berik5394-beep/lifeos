import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({
  createAnthropic: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  QUICK_CALL: { timeout: 8000, maxRetries: 1 },
}));
const { getPortrait, gatherPortraitFacts, axesWords } = await import('./portrait.js');

/** «Каким я тебя вижу»: портрет по фактам со всего приложения, честно и с кэшем. */
const prisma = new PrismaClient();
const prevKey = process.env.CLAUDE_API_KEY;
process.env.CLAUDE_API_KEY = 'test';
afterAll(async () => {
  process.env.CLAUDE_API_KEY = prevKey;
  await prisma.$disconnect();
});
beforeEach(() => create.mockReset());
const reply = (t: string) => ({ content: [{ type: 'text', text: t }] });
const user = async () =>
  (
    await prisma.user.create({
      data: { email: `pt-${Date.now()}-${Math.random()}@a.test`, name: 'Берик Курмангалиев', passwordHash: 'x', timezone: 'UTC', settings: { keep: 1 } },
    })
  ).id;
const now = new Date('2026-11-07T12:00:00Z');
const day = (n: number) => new Date(Date.UTC(2026, 10, 7 - n));

async function filled(u: string) {
  await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'Владеет компанией по продаже турникетов', source: 'chat', tags: [] } });
  await prisma.memory.create({ data: { userId: u, type: 'preference', content: 'Любит кофе без сахара', source: 'chat', tags: [] } });
  await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Ерлан', importance: 8, attributes: { relation: 'брат', город: 'Астана' } } });
  // Привычке больше месяца — окно «из 30 дней» (у молодой окно — с её создания).
  const h = await prisma.habit.create({
    data: { userId: u, name: 'Чтение', category: 'personal', frequency: 'daily', createdAt: new Date(Date.now() - 40 * 86_400_000) },
  });
  for (const n of [1, 2, 3]) await prisma.habitLog.create({ data: { userId: u, habitId: h.id, date: day(n), completed: true } });
  await prisma.expense.create({ data: { userId: u, date: day(2), category: 'food', description: 'обед', amount: 6000 } });
  await prisma.expense.create({ data: { userId: u, date: day(3), category: 'transport', description: 'такси', amount: 4000 } });
}

describe('портрет', () => {
  it('факты — со всего приложения: память, люди, привычки, траты', async () => {
    const u = await user();
    await filled(u);
    const f = await gatherPortraitFacts(u, now);
    expect(f).toEqual(
      expect.arrayContaining([
        'из разговоров: Владеет компанией по продаже турникетов',
        'привычка «Чтение»: выполнена 3 из 30 дней',
        'траты за 30 дней больше всего: еда 60%, транспорт 40%',
      ]),
    );
    expect(f.some((x) => x.startsWith('близкий человек: Ерлан'))).toBe(true);
  });

  it('мало фактов — честно «расскажи больше», Claude не зовём', async () => {
    const r = await getPortrait(await user(), now);
    expect(r).toMatchObject({ status: 'need_more', text: null });
    expect(create).not.toHaveBeenCalled();
  });

  it('пишет портрет, сохраняет в settings (не трогая другие ключи) и не переписывает без нужды', async () => {
    const u = await user();
    await filled(u);
    create.mockResolvedValueOnce(reply('Берик, ты строишь своё дело и держишь близко семью — брат Ерлан в Астане. Чтение пока идёт урывками: 3 из 30 дней.'));
    const r1 = await getPortrait(u, now);
    expect(r1.status).toBe('ok');
    expect(r1.text).toMatch(/^Берик, ты строишь/);
    const sys = String((create.mock.calls[0][0] as { system: string }).system);
    expect(sys).toMatch(/ТОЛЬКО факты/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { settings: true } });
    expect(row.settings).toMatchObject({ keep: 1, portrait: { text: r1.text } });
    // те же факты — тот же портрет, без нового вызова
    const r2 = await getPortrait(u, new Date(now.getTime() + 2 * 3600_000));
    expect(r2.text).toBe(r1.text);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('выдуманное число — не показываем', async () => {
    const u = await user();
    await filled(u);
    create.mockResolvedValueOnce(reply('Берик, ты тратишь 250 000 ₸ на еду каждый месяц.'));
    const r = await getPortrait(u, now);
    expect(r).toMatchObject({ status: 'unavailable', text: null });
  });

  it('оси личности — словами и только при достаточном числе сигналов', () => {
    const a = { selfDiscipline: 0.8, emotionalOpenness: 0.2, conflictTolerance: 0.5, introspectionDepth: 0.5 };
    expect(axesWords({ ...a, signalCount: 3 })).toEqual([]);
    expect(axesWords({ ...a, signalCount: 40 })).toEqual(['собранность: держит слово и доводит дела', 'о чувствах говорит скупо, больше о делах']);
  });
});
