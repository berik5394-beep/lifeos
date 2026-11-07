import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { takeInAppNudge, IN_APP_NUDGES_PER_DAY } from './insight-store.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const NOW = new Date('2026-11-07T06:00:00Z');

async function user() {
  return (await prisma.user.create({ data: { email: `nu-${Date.now()}-${Math.random()}@a.test`, name: 'N', passwordHash: 'x', timezone: 'Asia/Almaty' } })).id;
}
const nudge = (userId: string, severity: number, message: string, extra: Record<string, unknown> = {}) =>
  prisma.insight.create({ data: { userId, severity, scope: {}, message, source: 'v2-proactivity', kind: 'v2_nudge', ...extra } });

describe('нудж робота в приложении', () => {
  it('самый важный → помечен доставленным, лежит в истории чата; второй раз не показывается', async () => {
    const u = await user();
    await nudge(u, 3, 'мелочь');
    const top = await nudge(u, 8, 'Третий день без тренировки — может, 15 минут вечером?');
    const got = await takeInAppNudge(u, NOW);
    expect(got?.id).toBe(top.id);
    expect((await prisma.insight.findUniqueOrThrow({ where: { id: top.id } })).deliveredAt).not.toBeNull();
    const chat = await prisma.chatMessage.findMany({ where: { userId: u, role: 'assistant' } });
    expect(chat.map((m) => m.content)).toContain('Третий день без тренировки — может, 15 минут вечером?');
    expect((await takeInAppNudge(u, NOW))?.message).toBe('мелочь');
  });

  it('без источника (source=NULL) тоже показывается; строки-ответы чата и просроченные — нет', async () => {
    const u = await user();
    await nudge(u, 9, 'строка-ответ', { source: 'day_load' });
    await nudge(u, 9, 'устарело', { expiresAt: new Date('2026-11-01T00:00:00Z') });
    await nudge(u, 5, 'от рефлектора', { source: null });
    expect((await takeInAppNudge(u, NOW))?.message).toBe('от рефлектора');
  });

  it(`не больше ${IN_APP_NUDGES_PER_DAY} в день`, async () => {
    const u = await user();
    for (let i = 0; i < IN_APP_NUDGES_PER_DAY + 2; i++) await nudge(u, 5, `нудж ${i}`);
    const shown = [];
    for (let i = 0; i < IN_APP_NUDGES_PER_DAY + 2; i++) shown.push(await takeInAppNudge(u, NOW));
    expect(shown.filter(Boolean)).toHaveLength(IN_APP_NUDGES_PER_DAY);
  });
});
