import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Пуш замокан: проверяем решение «слать / не слать», а не сеть.
const deliverNotification = vi.fn(async (..._a: unknown[]) => ({ push: true, telegram: false }));
vi.mock('./push-service.js', () => ({ deliverNotification: (...a: unknown[]) => deliverNotification(...a) }));
const { V2ProactivityEngine, NUDGE_DEDUP_DAYS } = await import('./v2-proactivity-engine.js');
const { deliverTopInsight } = await import('./insight-store.js');
type Cand = import('./v2-proactivity-engine.js').NudgeCandidate;

/**
 * Этап 2: доставка проактивных нуджей.
 *  - gate4 раньше не матчил никогда → смахнутый нудж возвращался на следующем тике;
 *  - runForUser брал только top-1 → если он под кулдауном, не доставлялось ничего;
 *  - goal_no_progress: одна общая очередь на все цели, значимость 1.0, прошлые годы;
 *  - строки-ответы в чате (deliveredAt сразу) съедали дневной пуш.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const NOW = new Date('2026-11-06T09:00:00Z'); // 09:00 UTC — не тихие часы
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.FEATURE_V2_MOOD_TONE = '';
  process.env.FEATURE_V2_ENGAGEMENT = '';
  process.env.FEATURE_V2_GOAL_SLOT = '';
  deliverNotification.mockClear();
});
afterEach(() => vi.useRealTimers());

async function user(tag: string) {
  return (
    await prisma.user.create({
      data: { email: `pd-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'P', passwordHash: 'x', timezone: 'UTC' },
    })
  ).id;
}
const goalCand = (entityId: string, sig = 0.65): Cand => ({
  source: 'goal_no_progress',
  entityId,
  significance: sig,
  payload: { goal: `Цель ${entityId}`, daysSilent: 20 },
  toneHint: 'curious',
});
function engineWith(cands: Cand[]) {
  const e = new V2ProactivityEngine();
  vi.spyOn(e, 'detectCandidates').mockResolvedValue(cands);
  return e;
}
const nudges = (userId: string) =>
  prisma.insight.findMany({ where: { userId, source: 'v2-proactivity' }, orderBy: { createdAt: 'asc' } });

describe('gate4: смахнутый нудж не возвращается раньше окна', () => {
  it('смахнул → тот же ключ не создаётся снова; через окно — снова можно', async () => {
    const userId = await user('dismiss');
    await engineWith([goalCand('g1')]).runForUser(userId);
    const [first] = await nudges(userId);
    expect(first.scopeKey).toBe('goal_no_progress:g1');
    await prisma.insight.update({ where: { id: first.id }, data: { dismissed: true } });

    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000)); // следующий тик
    const r = await engineWith([goalCand('g1')]).runForUser(userId);
    expect(r.nudgesDelivered).toBe(0);

    vi.setSystemTime(new Date(NOW.getTime() + (NUDGE_DEDUP_DAYS + 1) * 86_400_000));
    expect((await engineWith([goalCand('g1')]).runForUser(userId)).nudgesDelivered).toBe(1);
  });
});

describe('runForUser: верхний под кулдауном не душит остальных', () => {
  it('top создан стором недавно (активный) → доставляется следующий', async () => {
    const userId = await user('next');
    // Активный нудж того же ключа, созданный ДО окна gate4, но в окне R10 стора
    // не бывает; моделируем гонку: ряд от другого источника записи (kind v2_nudge,
    // source не v2-proactivity) — gate4 его не видит, R10 стора видит.
    await prisma.insight.create({
      data: { userId, kind: 'v2_nudge', scopeKey: 'goal_no_progress:g1', scope: { key: 'goal_no_progress:g1', kind: 'v2_nudge' }, source: 'reflector', severity: 7, message: 'x' },
    });
    const r = await engineWith([goalCand('g1', 0.7), goalCand('g2', 0.65)]).runForUser(userId);
    expect(r.nudgesDelivered).toBe(1);
    expect((await nudges(userId)).map((n) => n.scopeKey)).toEqual(['goal_no_progress:g2']);
  });
});

describe('goal_no_progress: по цели, текущий год, без вечного первого места', () => {
  it('две молчащие цели этого года — два кандидата со своими ключами; прошлый год и выполненная — нет', async () => {
    const userId = await user('goals');
    const old = new Date(NOW.getTime() - 30 * 86_400_000);
    const mk = (goalText: string, year: number, progress = 0) =>
      prisma.yearlyGoal.create({ data: { userId, year, area: 'career', goalText, progress } });
    const a = await mk('Запустить продукт', 2026);
    const b = await mk('50 книг', 2026);
    const prev = await mk('Прошлогодняя', 2025);
    const done = await mk('Сделано', 2026, 100); // проценты 0..100
    await prisma.$executeRaw`UPDATE "YearlyGoal" SET "updatedAt" = ${old} WHERE "userId" = ${userId}`;

    const c = (await new V2ProactivityEngine().detectCandidates(userId)).filter((x) => x.source === 'goal_no_progress');
    expect(c.map((x) => x.entityId).sort()).toEqual([a.id, b.id].sort());
    expect(c.map((x) => x.entityId)).not.toContain(prev.id);
    expect(c.map((x) => x.entityId)).not.toContain(done.id);
    for (const x of c) expect(x.significance).toBeLessThanOrEqual(0.7);
  });
});

describe('пуш: ответы в чате не съедают дневной лимит', () => {
  it('строка «сдвиг дня» в ответе (deliveredAt сегодня) → нудж всё равно уходит пушем', async () => {
    const userId = await user('inline');
    await prisma.insight.create({
      data: { userId, severity: 5, scope: { key: 'day:load', kind: 'day_load_reactive' }, scopeKey: 'day:load', source: 'day_load', message: 'День плотный', deliveredAt: NOW },
    });
    await engineWith([goalCand('g1')]).runForUser(userId);
    const r = await deliverTopInsight(userId, NOW);
    expect(r.deliveredId).not.toBeNull();
    expect(deliverNotification).toHaveBeenCalledTimes(1);
  });

  it('настоящий пуш сегодня уже был → второй не шлём (≤1/день)', async () => {
    const userId = await user('one-a-day');
    await engineWith([goalCand('g1')]).runForUser(userId);
    expect((await deliverTopInsight(userId, NOW)).deliveredId).not.toBeNull();
    await engineWith([goalCand('g2')]).runForUser(userId);
    expect((await deliverTopInsight(userId, NOW)).deliveredId).toBeNull();
  });
});
