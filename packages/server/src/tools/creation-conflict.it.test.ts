import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskTool } from './create-task.js';
import { createEventTool } from './create-event.js';
import { localDateStr } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedAlmaty(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'Берик', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}
const TODAY = localDateStr('Asia/Almaty');

describe('Проактивный конфликт ПРИ СОЗДАНИИ — «не успеешь» в ответе (тест-БД)', () => {
  beforeEach(() => {
    process.env.FEATURE_V2_SCHEDULE_CONFLICT = 'all';
  });

  it('ТВОЙ КЕЙС: встреча Серик 14:00 уже есть → создаю задачу «зал» 14:00 → ⚠️ не успеешь', async () => {
    const userId = await seedAlmaty(`cc-a-${Date.now()}@a.test`);
    await createEventTool.handler({ title: 'Встреча с Сериком', date: TODAY, startTime: '14:00', endTime: '15:00' } as never, { userId } as never);
    const res = (await createTaskTool.handler({ title: 'Сходить в зал', date: TODAY, time: '14:00', priority: 'medium' } as never, { userId } as never)) as { message: string };
    expect(res.message).toContain('⚠️');
    expect(res.message).toContain('не успеешь');
    expect(res.message).toContain('Серик');
  });

  it('обратный порядок: задача «зал» 14:00 есть → создаю встречу Серик 14:00 → ⚠️ в ответе встречи', async () => {
    const userId = await seedAlmaty(`cc-b-${Date.now()}@a.test`);
    await createTaskTool.handler({ title: 'Сходить в зал', date: TODAY, time: '14:00', priority: 'medium' } as never, { userId } as never);
    const res = (await createEventTool.handler({ title: 'Встреча с Сериком', date: TODAY, startTime: '14:00', endTime: '15:00' } as never, { userId } as never)) as { message: string };
    expect(res.message).toContain('⚠️');
    expect(res.message).toContain('зал');
  });

  it('нет наложения (задача 09:00) → нет предупреждения', async () => {
    const userId = await seedAlmaty(`cc-c-${Date.now()}@a.test`);
    await createEventTool.handler({ title: 'Серик', date: TODAY, startTime: '14:00', endTime: '15:00' } as never, { userId } as never);
    const res = (await createTaskTool.handler({ title: 'Отчёт', date: TODAY, time: '09:00', priority: 'high' } as never, { userId } as never)) as { message: string };
    expect(res.message).not.toContain('⚠️');
  });

  it('задача без времени → нет предупреждения', async () => {
    const userId = await seedAlmaty(`cc-d-${Date.now()}@a.test`);
    await createEventTool.handler({ title: 'Серик', date: TODAY, startTime: '14:00', endTime: '15:00' } as never, { userId } as never);
    const res = (await createTaskTool.handler({ title: 'Без времени', date: TODAY, priority: 'low' } as never, { userId } as never)) as { message: string };
    expect(res.message).not.toContain('⚠️');
  });

  it('флаг OFF → нет предупреждения', async () => {
    const userId = await seedAlmaty(`cc-e-${Date.now()}@a.test`);
    await createEventTool.handler({ title: 'Серик', date: TODAY, startTime: '14:00', endTime: '15:00' } as never, { userId } as never);
    process.env.FEATURE_V2_SCHEDULE_CONFLICT = 'none';
    const res = (await createTaskTool.handler({ title: 'Сходить в зал', date: TODAY, time: '14:00', priority: 'medium' } as never, { userId } as never)) as { message: string };
    expect(res.message).not.toContain('⚠️');
  });
});
