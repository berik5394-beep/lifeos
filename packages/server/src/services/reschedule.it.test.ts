import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from '../routes/tasks.js';
import { chatRoutes } from '../routes/chat.js';
import { createTaskTool } from '../tools/create-task.js';
import { civilDayRefs, addCivilDays } from '../lib/tz.js';
import { setPendingAction } from './pending-actions.js';

/**
 * Перегруз дня → робот предлагает сдвинуть график одним касанием
 * (спека 2026-11-05-day-overload-reschedule). Реальная БД, реальные роуты.
 *
 * Сценарий: завтра встреча 09:00–19:00 → свободно 60 мин. Уже есть «Почта»
 * (low, 30 мин) и «Банк» (medium, 30 мин). Новая задача на 30 мин → 90 > 60 →
 * предложение сдвинуть «Почту» (наименее важную) на послезавтра.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
const ORIG = process.env.FEATURE_V2_RESCHEDULE;
beforeAll(async () => {
  app = await buildTestApp([taskRoutes, chatRoutes]);
});
afterEach(() => {
  process.env.FEATURE_V2_RESCHEDULE = 'all';
});
afterAll(async () => {
  if (ORIG === undefined) delete process.env.FEATURE_V2_RESCHEDULE;
  else process.env.FEATURE_V2_RESCHEDULE = ORIG;
  await app.close();
  await prisma.$disconnect();
});
process.env.FEATURE_V2_RESCHEDULE = 'all';

const TZ = 'Asia/Almaty';
const { tomorrow } = civilDayRefs(TZ);
const dayAfter = addCivilDays(tomorrow, 1);
const d = (s: string) => new Date(s + 'T00:00:00Z');

async function overloadedTomorrow(tag: string) {
  const u = await prisma.user.create({
    data: { email: `rs-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: TZ },
  });
  const userId = u.id;
  await prisma.calendarEvent.create({ data: { userId, title: 'Выездная встреча', date: d(tomorrow), startTime: '09:00', endTime: '19:00' } });
  const base = { userId, category: 'personal', date: d(tomorrow), estimatedMinutes: 30 };
  const mail = await prisma.task.create({ data: { ...base, title: 'Почта', priority: 'low' } });
  const bank = await prisma.task.create({ data: { ...base, title: 'Банк', priority: 'medium' } });
  return { userId, mail, bank, headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` } };
}

const confirm = (headers: Record<string, string>, yes = true) =>
  app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: yes } });

describe('перегруз дня → предложение сдвинуть график', () => {
  it('create_task на перегруженное ЗАВТРА → предложение (регресс: раньше проверялся только сегодня)', async () => {
    const { userId, mail } = await overloadedTomorrow('tool');
    const out = (await createTaskTool.handler(
      { title: 'Отчёт', date: tomorrow, priority: 'medium' },
      { userId },
    )) as { message: string; rescheduleStaged?: boolean };
    expect(out.message).toContain('Завтра день перегружен');
    expect(out.message).toContain('«Почта» → на');
    expect(out.rescheduleStaged).toBe(true);
    const pending = await prisma.pendingAction.findUnique({ where: { userId } });
    expect(pending?.action).toBe('apply_reschedule');
    expect(pending?.inputJson).toMatchObject({ moves: [{ taskId: mail.id, fromDate: tomorrow, toDate: dayAfter }] });
    // ничего не сдвинуто без касания
    expect((await prisma.task.findUnique({ where: { id: mail.id } }))?.date.toISOString().slice(0, 10)).toBe(tomorrow);
  });

  it('POST /tasks → proposal в ответе; «Подтвердить» двигает; повторный confirm → 409', async () => {
    const { mail, bank, headers } = await overloadedTomorrow('rest');
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; proposal?: { text: string; staged: boolean } };
    expect(body.proposal?.staged).toBe(true);
    expect(body.proposal?.text).toContain('Подтвердить перенос?');

    const ok = await confirm(headers);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().message).toContain('Готово, график сдвинут: «Почта» → на');
    const after = await prisma.task.findMany({ where: { id: { in: [mail.id, bank.id, body.id] } } });
    const dateOf = (id: string) => after.find((t) => t.id === id)?.date.toISOString().slice(0, 10);
    expect(dateOf(mail.id)).toBe(dayAfter);
    expect(dateOf(bank.id)).toBe(tomorrow);
    expect(dateOf(body.id)).toBe(tomorrow); // новую не трогаем

    expect((await confirm(headers)).statusCode).toBe(409);
  });

  it('юзер успел передвинуть задачу сам → пропуск и честная строка', async () => {
    const { mail, headers } = await overloadedTomorrow('manual');
    await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    const far = addCivilDays(tomorrow, 5);
    await prisma.task.update({ where: { id: mail.id }, data: { date: d(far) } });
    const res = await confirm(headers);
    expect(res.json().message).toContain('«Почта» уже передвинута или закрыта');
    expect((await prisma.task.findUnique({ where: { id: mail.id } }))?.date.toISOString().slice(0, 10)).toBe(far);
  });

  it('«Отмена» → ничего не сдвинуто', async () => {
    const { mail, headers } = await overloadedTomorrow('cancel');
    await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    expect((await confirm(headers, false)).statusCode).toBe(200);
    expect((await prisma.task.findUnique({ where: { id: mail.id } }))?.date.toISOString().slice(0, 10)).toBe(tomorrow);
  });

  it('PUT /tasks/:id со сменой даты на перегруженный день → proposal', async () => {
    const { userId, headers } = await overloadedTomorrow('put');
    const t = await prisma.task.create({
      data: { userId, title: 'Отчёт', category: 'work', priority: 'medium', date: d(addCivilDays(tomorrow, 3)), estimatedMinutes: 30 },
    });
    const res = await app.inject({ method: 'PUT', url: `/tasks/${t.id}`, headers, payload: { date: tomorrow } });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposal?.text).toContain('«Почта» → на');
    // та же дата (без переноса) → без предложения
    const same = await app.inject({ method: 'PUT', url: `/tasks/${t.id}`, headers, payload: { title: 'Отчёт 2', date: tomorrow } });
    expect(same.json().proposal).toBeUndefined();
  });

  it('шаг к цели года → предупреждение «цель меняется»', async () => {
    const { userId, mail, headers } = await overloadedTomorrow('goal');
    const goal = await prisma.yearlyGoal.create({
      data: { userId, year: Number(tomorrow.slice(0, 4)), area: 'education', goalText: 'Английский B2' },
    });
    await prisma.task.update({ where: { id: mail.id }, data: { planParentId: goal.id, planParentType: 'YearlyGoal' } });
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    expect(res.json().proposal?.text).toContain('⚠️ «Почта» — шаг к цели года «Английский B2» — сдвигается на 1 дн.');
  });

  it('чат «Создай задачу … завтра» → облачко с кнопками (pendingAction в ответе)', async () => {
    const { headers } = await overloadedTomorrow('chat');
    const res = await app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text: 'Создай задачу написать отчёт завтра' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { message: string; pendingAction: { action: string } | null };
    expect(body.message).toContain('Завтра день перегружен');
    expect(body.pendingAction?.action).toBe('apply_reschedule');
  });

  it('карточка «Задачи» НЕ перетирает ожидающее «Записать 5000₸?»; кнопка не подтвердит чужое', async () => {
    const { userId, mail, headers } = await overloadedTomorrow('money');
    await setPendingAction(userId, 'add_expense', { amount: 5000, category: 'food' }, 'Записать 5000₸?');
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    expect(res.json().proposal).toMatchObject({ staged: false });
    expect(res.json().proposal.text).toContain('Сначала ответь на прошлое подтверждение');
    expect((await prisma.pendingAction.findUnique({ where: { userId } }))?.action).toBe('add_expense');

    // кнопка переноса при ожидающем расходе → 409, ничего не съедено и не сдвинуто
    const wrong = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true, action: 'apply_reschedule' } });
    expect(wrong.statusCode).toBe(409);
    expect((await prisma.pendingAction.findUnique({ where: { userId } }))?.action).toBe('add_expense');
    expect((await prisma.task.findUnique({ where: { id: mail.id } }))?.date.toISOString().slice(0, 10)).toBe(tomorrow);
  });

  it('флаг выкл. → всё как раньше: без proposal и без pending', async () => {
    process.env.FEATURE_V2_RESCHEDULE = '';
    const { userId, headers } = await overloadedTomorrow('off');
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers,
      payload: { title: 'Отчёт', category: 'work', priority: 'medium', date: tomorrow, estimatedMinutes: 30 },
    });
    expect(res.json().proposal).toBeUndefined();
    const out = (await createTaskTool.handler({ title: 'Ещё', date: tomorrow }, { userId })) as { message: string; rescheduleStaged?: boolean };
    expect(out.message).not.toContain('перегружен: дел');
    expect(out.rescheduleStaged).toBeUndefined();
    expect(await prisma.pendingAction.findUnique({ where: { userId } })).toBeNull();
  });
});
