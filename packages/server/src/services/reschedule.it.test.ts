import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from '../routes/tasks.js';
import { chatRoutes } from '../routes/chat.js';
import { eventRoutes } from '../routes/events.js';
import { createEventTool } from '../tools/create-event.js';
import { completeHabitTool } from '../tools/complete-habit.js';
import { completeTaskTool } from '../tools/complete-task.js';
import { buildNotFoundMessage } from '../tools/_habit-match.js';
import { createTaskTool } from '../tools/create-task.js';
import { civilDayRefs, addCivilDays } from '../lib/tz.js';
import { setPendingAction } from './pending-actions.js';
import { proposeReschedule } from './reschedule.js';
import { createDeal } from './deals/service.js';

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
  app = await buildTestApp([taskRoutes, chatRoutes, eventRoutes]);
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
    const { userId, mail, bank, headers } = await overloadedTomorrow('rest');
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
    // предложение из карточки — в истории чата (облачко робота, контекст для «да»)
    const last = await prisma.chatMessage.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(last).toMatchObject({ role: 'assistant', content: body.proposal?.text });

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

describe('этап 2: встречи съедают время дня', () => {
  // Завтра без встречи: «Почта» + «Банк» по 30 мин — влезает. Встреча 09:00–19:30 → 30 мин свободно.
  async function freeTomorrow(tag: string) {
    const u = await prisma.user.create({
      data: { email: `rs2-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: TZ },
    });
    const base = { userId: u.id, category: 'personal', date: d(tomorrow), estimatedMinutes: 30 };
    const mail = await prisma.task.create({ data: { ...base, title: 'Почта', priority: 'low' } });
    await prisma.task.create({ data: { ...base, title: 'Банк', priority: 'medium' } });
    return { userId: u.id, mail, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
  }

  it('create_event на весь день → предложение сдвинуть задачи (все двигаемы)', async () => {
    const { userId, mail } = await freeTomorrow('ev-tool');
    const out = (await createEventTool.handler(
      { title: 'Выезд на объект', date: tomorrow, startTime: '09:00', endTime: '19:30' },
      { userId },
    )) as { message: string; rescheduleStaged?: boolean };
    expect(out.message).toContain('Завтра день перегружен');
    expect(out.message).toContain('«Почта» → на');
    expect(out.rescheduleStaged).toBe(true);
    expect((await prisma.pendingAction.findUnique({ where: { userId } }))?.inputJson).toMatchObject({
      moves: [{ taskId: mail.id }],
    });
  });

  it('встреча без конца времени не занимает → без предложения', async () => {
    const { userId } = await freeTomorrow('ev-open');
    const out = (await createEventTool.handler({ title: 'Звонок', date: tomorrow, startTime: '10:00' }, { userId })) as { message: string };
    expect(out.message).not.toContain('перегружен');
  });

  it('POST /events → proposal в ответе; PUT /events, удлинили встречу → proposal', async () => {
    const a = await freeTomorrow('ev-rest');
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: a.headers,
      payload: { title: 'Выезд', date: tomorrow, startTime: '09:00', endTime: '19:30' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().proposal).toMatchObject({ staged: true });

    // импорт календаря телефона — без предложений (не спамим чат пачкой)
    const imp = await freeTomorrow('ev-import');
    const imported = await app.inject({
      method: 'POST',
      url: '/events',
      headers: imp.headers,
      payload: { title: 'Из телефона', date: tomorrow, startTime: '09:00', endTime: '19:30', source: 'imported' },
    });
    expect(imported.json().proposal).toBeUndefined();
    expect(await prisma.chatMessage.count({ where: { userId: imp.userId } })).toBe(0);

    const b = await freeTomorrow('ev-put');
    const ev = await app.inject({
      method: 'POST',
      url: '/events',
      headers: b.headers,
      payload: { title: 'Созвон', date: tomorrow, startTime: '09:00', endTime: '10:00' },
    });
    expect(ev.json().proposal).toBeUndefined();
    const put = await app.inject({ method: 'PUT', url: `/events/${ev.json().id}`, headers: b.headers, payload: { endTime: '19:30' } });
    expect(put.json().proposal?.text).toContain('«Почта» → на');
    // правка без смены времени — без предложения
    const rename = await app.inject({ method: 'PUT', url: `/events/${ev.json().id}`, headers: b.headers, payload: { title: 'Созвон 2' } });
    expect(rename.json().proposal).toBeUndefined();
  });
});

describe('этап 2: «сделал X» — привычка или задача, без пересечений', () => {
  async function u(tag: string) {
    return (await prisma.user.create({ data: { email: `rs3-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: TZ } })).id;
  }

  it('complete_habit «отчёт»: привычки нет, задача есть → закрыта задача', async () => {
    const userId = await u('h2t');
    await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily' } });
    const t = await prisma.task.create({ data: { userId, title: 'Квартальный отчёт', category: 'work', priority: 'medium', date: d(tomorrow) } });
    const out = (await completeHabitTool.handler({ name: 'квартальный отчёт' }, { userId })) as { message: string };
    expect(out.message).toContain('выполнена');
    expect((await prisma.task.findUnique({ where: { id: t.id } }))?.completed).toBe(true);
  });

  it('не гадаем: «йогу» ≠ «Купить йогурт», две задачи «отчёт» → ничего не закрыто', async () => {
    const userId = await u('strict');
    const y = await prisma.task.create({ data: { userId, title: 'Купить йогурт', category: 'home', priority: 'low', date: d(tomorrow) } });
    await expect(completeHabitTool.handler({ name: 'йогу' }, { userId })).rejects.toThrow();
    const base = { userId, category: 'work', priority: 'medium', date: d(tomorrow) };
    await prisma.task.create({ data: { ...base, title: 'Отчёт для банка' } });
    await prisma.task.create({ data: { ...base, title: 'Отчёт по продажам' } });
    await expect(completeHabitTool.handler({ name: 'отчёт' }, { userId })).rejects.toThrow();
    expect(await prisma.task.count({ where: { userId, completed: true } })).toBe(0);
    expect((await prisma.task.findUnique({ where: { id: y.id } }))?.completed).toBe(false);
  });

  it('через реестр: монеты один раз, задача закрыта, «complete_task» в аудите', async () => {
    const userId = await u('reg');
    const t = await prisma.task.create({ data: { userId, title: 'Квартальный отчёт', category: 'work', priority: 'medium', date: d(tomorrow) } });
    const { runRegistryTool } = await import('../tools/index.js');
    const out = (await runRegistryTool('complete_habit', { name: 'квартальный отчёт' }, { userId })) as { completedTask?: boolean };
    expect(out.completedTask).toBe(true);
    expect((await prisma.task.findUnique({ where: { id: t.id } }))?.completed).toBe(true);
    expect(await prisma.coinTransaction.count({ where: { userId, refKey: `task:${t.id}` } })).toBe(1);
    expect(await prisma.toolCall.count({ where: { userId, toolName: 'complete_task' } })).toBe(1);
  });

  it('complete_task «зарядка» (это привычка) → честно «Задача не найдена», привычку не трогаем', async () => {
    const userId = await u('t2h');
    const h = await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    const out = (await completeTaskTool.handler({ title: 'зарядка' }, { userId })) as { message: string };
    expect(out.message).toBe('Задача не найдена');
    expect(await prisma.habitLog.count({ where: { habitId: h.id } })).toBe(0);
  });

  it('флаг выкл. → как раньше: «привычка не найдена» / «Задача не найдена»', async () => {
    process.env.FEATURE_V2_RESCHEDULE = '';
    const userId = await u('off2');
    await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily' } });
    await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'medium', date: d(tomorrow) } });
    const habits = await prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } });
    await expect(completeHabitTool.handler({ name: 'отчёт' }, { userId })).rejects.toThrow(buildNotFoundMessage('отчёт', habits));
    expect(await prisma.task.count({ where: { userId, completed: true } })).toBe(0);
  });
});

describe('шаги по сделкам × перегруз дня', () => {
  const ORIG_DEALS = process.env.FEATURE_V2_DEALS;
  afterAll(() => {
    if (ORIG_DEALS === undefined) delete process.env.FEATURE_V2_DEALS;
    else process.env.FEATURE_V2_DEALS = ORIG_DEALS;
  });

  // Завтра: свободно 60 мин, «Почта»+«Банк» = 60 (влезает). Шаг по сделке +20 → 80.
  it('шаг по сделке грузит день: двигаем только задачи, шаг остаётся', async () => {
    process.env.FEATURE_V2_DEALS = 'all';
    const { userId, mail } = await overloadedTomorrow('deal-step');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', nextStepDate: tomorrow, nextStepText: 'связаться' });
    const p = await proposeReschedule(userId, tomorrow, null);
    expect(p?.text).toContain('дел на ~1,5 ч');
    expect(p?.moves).toEqual([{ taskId: mail.id, title: 'Почта', fromDate: tomorrow, toDate: dayAfter }]);
    expect(p?.text).not.toContain('Ахмет');
    expect(p?.text).toContain('Звонки/шаги по сделкам (1) не двигаю');
    const pending = await prisma.pendingAction.findUnique({ where: { userId } });
    expect(JSON.stringify(pending?.inputJson)).not.toContain('deal:');
  });

  it('флаг сделок выкл. → как раньше: день влезает, предложения нет', async () => {
    process.env.FEATURE_V2_DEALS = '';
    const { userId } = await overloadedTomorrow('deal-off');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', nextStepDate: tomorrow, nextStepText: 'связаться' });
    expect(await proposeReschedule(userId, tomorrow, null)).toBeNull();
    process.env.FEATURE_V2_DEALS = 'all';
  });
});
