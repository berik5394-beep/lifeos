import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Извлечение (LLM) замокано: проверяем проводку — на пути с действием факт
// пишется, а задачи из фразы не плодятся.
const extracted = {
  tasks: [{ title: 'Ужин с Сериком', category: 'personal', priority: 'medium' }],
  memories: [{ type: 'event', content: 'Ужинал с Сериком', tags: ['friends'], importance: 5 }],
};
vi.mock('./dictation-service.js', () => ({
  extractFromTranscript: vi.fn(async () => extracted),
  extractFromChat: vi.fn(async () => extracted),
}));
const v2Capture = vi.fn(async () => {});
vi.mock('./v2-capture.js', () => ({ captureV2InBackground: (...a: unknown[]) => v2Capture(...(a as [])) }));
const { handleMessage } = await import('./jarvis-orchestrator.js');

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const flush = () => new Promise((r) => setTimeout(r, 300));

describe('этап 4: факты и люди — и на пути с действием', () => {
  it('«потратил 5000 на ужин с Сериком» → память «ужинал с Сериком», люди (v2), без лишней задачи', async () => {
    process.env.FEATURE_V2_MEMORY = 'all';
    const userId = (
      await prisma.user.create({ data: { email: `apc-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } })
    ).id;
    const r = await handleMessage(userId, 'потратил 5000 на ужин с Сериком');
    expect(r.pendingAction?.action).toBe('add_expense'); // трата ждёт «да» — путь с действием
    await flush();
    expect((await prisma.memory.findMany({ where: { userId } })).map((m) => m.content)).toContain('Ужинал с Сериком');
    expect(v2Capture).toHaveBeenCalled(); // слой людей/сущностей
    expect(await prisma.task.count({ where: { userId } })).toBe(0);
  });
});

describe('looksPeopleWorthy', () => {
  it.each(['потратил 5000 на ужин с Сериком', 'купил подарок для Даны на 20000', 'Встреча с Ахметом завтра в 14:00'])('«%s» → да', async (t) => {
    const { looksPeopleWorthy } = await import('./jarvis-orchestrator.js');
    expect(looksPeopleWorthy(t)).toBe(true);
  });
  it.each(['добавь задачу купить хлеб', 'Потратил 3000 на такси', 'кто такой Серик?'])('«%s» → нет', async (t) => {
    const { looksPeopleWorthy } = await import('./jarvis-orchestrator.js');
    expect(looksPeopleWorthy(t)).toBe(false);
  });
});
