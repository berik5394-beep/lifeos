import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { handleMessage } from './jarvis-orchestrator.js';
import { civilDayRefs } from '../lib/tz.js';

/**
 * intent-TZ фикс, РЕАЛЬНЫЙ путь бота: handleMessage → deterministicIntent →
 * runRegistryTool(create_task) → Task в БД. До фикса дата = UTC сервера.
 *
 * Тест не зависит от часов: берём пояс, где ПРЯМО СЕЙЧАС календарная дата
 * отличается от UTC (UTC+14 при UTC-часе ≥10, иначе UTC−11) — расхождение есть
 * в любой момент запуска, иначе тест молча проходил бы на старом коде.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

function zoneDifferingFromUtcNow(): string {
  return new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
}

async function seedUser(email: string, timezone: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'T', passwordHash: 'x', timezone } });
  return u.id;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('intent-TZ: «сегодня/завтра» из бота = календарь юзера', () => {
  it('предусловие: выбранный пояс реально расходится с UTC сейчас', () => {
    const tz = zoneDifferingFromUtcNow();
    expect(civilDayRefs(tz).today).not.toBe(civilDayRefs('UTC').today);
  });

  it('«…сегодня» → задача на локальное сегодня', async () => {
    const tz = zoneDifferingFromUtcNow();
    const userId = await seedUser(`itz-today-${Date.now()}@a.test`, tz);
    const expected = civilDayRefs(tz).today;
    await handleMessage(userId, 'Создай задачу позвонить маме сегодня');
    const task = await prisma.task.findFirstOrThrow({ where: { userId } });
    expect(iso(task.date)).toBe(expected);
  });

  it('«…завтра» → задача на локальное завтра', async () => {
    const tz = zoneDifferingFromUtcNow();
    const userId = await seedUser(`itz-tmrw-${Date.now()}@a.test`, tz);
    const expected = civilDayRefs(tz).tomorrow;
    await handleMessage(userId, 'Напомни купить хлеб завтра');
    const task = await prisma.task.findFirstOrThrow({ where: { userId } });
    expect(iso(task.date)).toBe(expected);
  });

  it('регрессия: юзер с поясом UTC получает UTC-сегодня (прежнее поведение)', async () => {
    const userId = await seedUser(`itz-utc-${Date.now()}@a.test`, 'UTC');
    await handleMessage(userId, 'Добавь задачу полить цветы');
    const task = await prisma.task.findFirstOrThrow({ where: { userId } });
    expect(iso(task.date)).toBe(civilDayRefs('UTC').today);
  });
});
