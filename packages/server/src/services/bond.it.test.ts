import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherBond, THREAD_HOLD_MS } from './bond.js';

const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const H = 3_600_000;
const user = async (createdAt: Date) =>
  (await prisma.user.create({
    data: { email: `bond-${Date.now()}-${Math.random()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'Asia/Almaty', createdAt, settings: { checkIns: false } },
  })).id;
const mem = (userId: string, type: string, content: string, ageH: number, importance = 7) =>
  prisma.memory.create({ data: { userId, type, content, source: 'chat', importance, createdAt: new Date(Date.now() - ageH * H) } });

describe('gatherBond — «наша связь» по реальной БД', () => {
  it('история + незакрытое (событие 12ч–10дн) + дневник; другие настройки целы', async () => {
    const now = new Date();
    const u = await user(new Date(now.getTime() - 47 * 24 * H));
    await mem(u, 'event', 'Завтра собеседование в Kaspi', 30);
    await mem(u, 'fact', 'Любит кофе', 30); // не событие — не «как прошло?»
    await mem(u, 'event', 'Только что рассказал про отпуск', 2); // слишком свежее — уже обсуждаем
    await prisma.robotDiaryEntry.create({ data: { userId: u, day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 24 * H), text: 'Мне запомнилось, как ты готовился к собеседованию.' } });
    const b = await gatherBond(u, now);
    expect(b).toMatch(/вы знакомы 4[67] дн/);
    expect(b).toContain('Незакрытое из ваших разговоров: «Завтра собеседование в Kaspi»');
    expect(b).toContain('Мне запомнилось');
    const s = (await prisma.user.findUniqueOrThrow({ where: { id: u } })).settings as Record<string, unknown>;
    expect(s.checkIns).toBe(false);
    expect((s.openThread as { id: string }).id).toBeTruthy();
  });

  it('незакрытое держится сутки, потом следующее; спрошенное пушем — не повторяем', async () => {
    const now = new Date();
    const u = await user(new Date(now.getTime() - 10 * 24 * H));
    const a = await mem(u, 'event', 'Собеседование в Kaspi', 30, 8);
    const b = await mem(u, 'emotion', 'Переживает из-за ссоры с братом', 40, 7);
    const c = await mem(u, 'event', 'Поездка в Астану', 50, 6);
    expect(await gatherBond(u, now)).toContain(a.content);
    expect(await gatherBond(u, new Date(now.getTime() + 2 * H))).toContain(a.content); // та же сутки
    // Пушем «как ты?» уже спрашивали про ссору — её пропускаем
    await prisma.insight.create({ data: { userId: u, severity: 1, scope: {}, message: 'Как вы с братом?', kind: 'v2_nudge', scopeKey: `check_in:${b.id}`, source: 'v2-proactivity' } });
    const later = await gatherBond(u, new Date(now.getTime() + THREAD_HOLD_MS + H));
    expect(later).not.toContain(a.content);
    expect(later).not.toContain(b.content);
    expect(later).toContain(c.content);
  });

  it('забытое («Неправда») не всплывает; круглая дата', async () => {
    const now = new Date();
    const u = await user(new Date(now.getTime() - 30 * 24 * H));
    await prisma.memory.create({ data: { userId: u, type: 'event', content: 'Неверное событие', source: 'chat', importance: 9, createdAt: new Date(now.getTime() - 20 * H), invalidAt: new Date(now.getTime() - H) } });
    const b = await gatherBond(u, now);
    expect(b).not.toContain('Неверное событие');
    expect(b).toMatch(/Сегодня ровно 30 дней знакомства|вы знакомы (29|31) дн/);
  });
});
