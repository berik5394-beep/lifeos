import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskTool } from './create-task.js';
import { createEventTool } from './create-event.js';
import { getTasksTool } from './get-tasks.js';
import { buildScheduleConflict } from '../services/schedule-conflict/index.js';
import { localDateStr, dateOnlyUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedAlmaty(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'Берик', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

const TODAY_ALMATY = localDateStr('Asia/Almaty'); // реальная календарная дата юзера

describe('TZ date FIX: Almaty юзер — «сегодня» записывается на верную дату + конфликт срабатывает', () => {
  beforeEach(() => {
    process.env.FEATURE_V2_SCHEDULE_CONFLICT = 'all';
  });

  it('create_task «сегодня» → @db.Date == календарная дата Almaty (не civil−1)', async () => {
    const userId = await seedAlmaty(`tzm-a-${Date.now()}@a.test`);
    const res = (await createTaskTool.handler(
      { title: 'Сходить в зал', date: TODAY_ALMATY, time: '14:00', priority: 'medium' } as never,
      { userId } as never,
    )) as { taskId?: string };
    const t = await prisma.task.findFirst({ where: { userId, title: 'Сходить в зал' } });
    expect(t!.date.toISOString().slice(0, 10)).toBe(TODAY_ALMATY);
  });

  it('create_event «сегодня» → @db.Date == та же календарная дата (write/read согласованы)', async () => {
    const userId = await seedAlmaty(`tzm-b-${Date.now()}@a.test`);
    await createEventTool.handler(
      { title: 'Встреча с Сериком', date: TODAY_ALMATY, startTime: '14:00' } as never,
      { userId } as never,
    );
    const e = await prisma.calendarEvent.findFirst({ where: { userId, title: 'Встреча с Сериком' } });
    expect(e!.date.toISOString().slice(0, 10)).toBe(TODAY_ALMATY);
    expect(e!.date.getTime()).toBe(dateOnlyUTC(TODAY_ALMATY).getTime());
  });

  it('get_tasks «сегодня» НАХОДИТ задачу, созданную сегодня (раньше разъезд терял)', async () => {
    const userId = await seedAlmaty(`tzm-c-${Date.now()}@a.test`);
    await createTaskTool.handler(
      { title: 'Отчёт', date: TODAY_ALMATY, priority: 'high' } as never,
      { userId } as never,
    );
    const res = (await getTasksTool.handler({} as never, { userId } as never)) as { tasks?: Array<{ title: string }> };
    const titles = JSON.stringify(res);
    expect(titles).toContain('Отчёт');
  });

  it('ТВОЙ КЕЙС: задача «зал» 14:00 + встреча «Серик» 14:00 сегодня → конфликт срабатывает', async () => {
    const userId = await seedAlmaty(`tzm-d-${Date.now()}@a.test`);
    await createTaskTool.handler(
      { title: 'Сходить в зал', date: TODAY_ALMATY, time: '14:00', priority: 'medium' } as never,
      { userId } as never,
    );
    await createEventTool.handler(
      { title: 'Встреча с Сериком', date: TODAY_ALMATY, startTime: '14:00' } as never,
      { userId } as never,
    );
    const conflict = await buildScheduleConflict(userId);
    expect(conflict).not.toBeNull();
    expect(conflict).toContain('⚠️ Конфликт');
    expect(conflict).toContain('зал');
    expect(conflict).toContain('Серик');
  });
});
