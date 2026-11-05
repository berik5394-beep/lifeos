import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { voiceRoutes } from './voice.js';
import { chatRoutes } from './chat.js';
import { civilDayRefs } from '../lib/tz.js';

/**
 * voice-one-brain: голосовая кнопка мобилки (/voice/process) идёт через
 * handleMessage — деньги ждут подтверждения, задачи пишет сервер, кризис
 * отвечает safety-текстом. Раньше: parseIntent + шаблон, мобилка исполняла
 * сама (деньги без «да», «unknown → задача»).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([voiceRoutes, chatRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function authed(label: string, timezone = 'Asia/Almaty') {
  const u = await prisma.user.create({
    data: { email: `vp-${label}-${Date.now()}@a.test`, name: 'V', passwordHash: 'x', timezone },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const say = (headers: Record<string, string>, text: string) =>
  app.inject({ method: 'POST', url: '/voice/process', headers, payload: { text } });

describe('/voice/process → единый мозг', () => {
  it('расход: НЕ пишется сразу (pendingAction), пишется после подтверждения', async () => {
    const { userId, headers } = await authed('exp');
    const res = await say(headers, 'Потратил 3000 на еду');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      intent: { action: string };
      response: string;
      pendingAction: { action: string } | null;
      confirmationText: string | null;
    };
    expect(body.pendingAction?.action).toBe('add_expense');
    expect(body.confirmationText).toBeTruthy();
    expect(body.response).toBe(body.confirmationText);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);

    const ok = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
  });

  it('отмена: расход не пишется', async () => {
    const { userId, headers } = await authed('cancel');
    const asked = await say(headers, 'Потратил 500 на такси');
    // Иначе тест пустой: «0 расходов» было бы и без всякого предложения.
    expect((asked.json() as { pendingAction: { action: string } | null }).pendingAction?.action).toBe('add_expense');
    const no = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: false } });
    expect(no.statusCode).toBe(200);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  });

  it('задача: пишет СЕРВЕР, на локальное «завтра» юзера; без pendingAction', async () => {
    const { userId, headers } = await authed('task');
    const res = await say(headers, 'Создай задачу купить хлеб завтра');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { intent: { action: string }; pendingAction: unknown };
    expect(body.intent.action).toBe('create_task');
    expect(body.pendingAction).toBeNull();
    const task = await prisma.task.findFirstOrThrow({ where: { userId } });
    expect(task.date.toISOString().slice(0, 10)).toBe(civilDayRefs('Asia/Almaty').tomorrow);
  });

  it('кризис: safety-ответ, ничего не создано', async () => {
    const { userId, headers } = await authed('crisis');
    const res = await say(headers, 'Не хочу больше жить');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { intent: { action: string } }).intent.action).toBe('safety_crisis');
    expect(await prisma.task.count({ where: { userId } })).toBe(0);
    // Кризисный ход помечен crisis=true (изоляция от LLM-контекста, retention).
    expect(await prisma.chatMessage.count({ where: { userId, crisis: true } })).toBeGreaterThan(0);
  });

  describe('эмоция робота в ответе (Часть 2)', () => {
    it('расход ждёт подтверждения → thinking; «да» (confirm-action) → happy', async () => {
      const { headers } = await authed('emo-exp');
      const res = await say(headers, 'Потратил 3000 на еду');
      expect((res.json() as { emotion: string }).emotion).toBe('thinking');
      const ok = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
      expect((ok.json() as { emotion: string }).emotion).toBe('happy');
    });
    it('задача создана → happy', async () => {
      const { headers } = await authed('emo-task');
      const res = await say(headers, 'Создай задачу купить хлеб завтра');
      expect((res.json() as { emotion: string }).emotion).toBe('happy');
    });
    it('кризис → caring', async () => {
      const { headers } = await authed('emo-crisis');
      const res = await say(headers, 'Не хочу больше жить');
      expect((res.json() as { emotion: string }).emotion).toBe('caring');
    });
    it('слот-вопрос («потратил 3000» без категории) → confused; «отмена» → neutral', async () => {
      const { headers } = await authed('emo-slot');
      const res = await say(headers, 'Потратил 3000');
      expect((res.json() as { emotion: string }).emotion).toBe('confused');
      const cancel = await say(headers, 'отмена');
      expect((cancel.json() as { emotion: string }).emotion).toBe('neutral');
    });
    it('/voice/chat тоже отдаёт эмоцию', async () => {
      const { headers } = await authed('emo-chat');
      const res = await app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text: 'Создай задачу полить цветы' } });
      expect((res.json() as { emotion: string }).emotion).toBe('happy');
    });
  });
});
