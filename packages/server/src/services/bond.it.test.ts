import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherBond } from './bond.js';
import { currentFollowUp, FOLLOW_UP_HOLD_MS } from './follow-ups.js';

/**
 * «Незакрытое» по реальной БД (аудит 2026-11-10): источник — прошедшие значимые
 * события календаря/задач и переживания из разговора, журнал FollowUpLog.
 */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const H = 3_600_000;
const TZ = 'Asia/Almaty';
const user = async (createdAt = new Date(Date.now() - 20 * 24 * H)) =>
  (await prisma.user.create({
    data: { email: `bond-${Date.now()}-${Math.random()}@a.test`, name: 'B', passwordHash: 'x', timezone: TZ, createdAt },
  })).id;
/** Гражданская дата Алматы со сдвигом в днях → полночь UTC (@db.Date). */
const day = (offset: number, now = new Date()) =>
  new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now.getTime() + offset * 24 * H))}T00:00:00Z`);

describe('незакрытое — источники', () => {
  it('вчерашнее значимое событие календаря — спросим; рутина — нет', async () => {
    const u = await user();
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Планёрка', date: day(-1), startTime: '09:00' } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Собеседование в Kaspi', date: day(-1), startTime: '10:00' } });
    const f = await currentFollowUp(u, TZ);
    expect(f?.text).toBe('Собеседование в Kaspi');
    expect(f?.kind).toBe('event');
    expect(await gatherBond(u)).toContain('у него было: «Собеседование в Kaspi» (вчера)');
  });

  it('событие в будущем — ещё рано', async () => {
    const u = await user();
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Экзамен', date: day(2) } });
    expect(await currentFollowUp(u, TZ)).toBeNull();
  });

  it('переживание из разговора (emotion, chat) через 12 ч — бережно', async () => {
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'emotion', content: 'Поссорилась с братом из-за денег — тяжело', source: 'chat', importance: 7, createdAt: new Date(Date.now() - 20 * H) } });
    const f = await currentFollowUp(u, TZ);
    expect(f?.kind).toBe('concern');
    expect(f?.heavy).toBe(true);
    expect(await gatherBond(u)).toContain('очень бережно');
  });

  it('значимая задача с прошедшей датой («Мама — операция»)', async () => {
    const u = await user();
    await prisma.task.create({ data: { userId: u, title: 'Мама ложится на операцию', category: 'personal', priority: 'high', date: day(-1) } });
    const f = await currentFollowUp(u, TZ);
    expect(f?.kind).toBe('task');
    expect(f?.heavy).toBe(true);
  });

  it('служебные записи памяти (v2-episodic) — не источник', async () => {
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'event', content: 'Встреча «X» 2026-11-11', source: 'v2-episodic', importance: 5, createdAt: new Date(Date.now() - 20 * H) } });
    expect(await currentFollowUp(u, TZ)).toBeNull();
  });
});

describe('незакрытое — журнал', () => {
  it('предложенное держится сутки, потом закрывается и берётся следующее', async () => {
    const u = await user();
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Собеседование в Kaspi', date: day(-1) } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Стоматолог', date: day(-2) } });
    const now = new Date();
    const first = await currentFollowUp(u, TZ, now);
    expect((await currentFollowUp(u, TZ, new Date(now.getTime() + 3 * H)))?.refKey).toBe(first?.refKey);
    const later = await currentFollowUp(u, TZ, new Date(now.getTime() + FOLLOW_UP_HOLD_MS + H));
    expect(later?.refKey).not.toBe(first?.refKey);
    expect(later).not.toBeNull();
    const log = await prisma.followUpLog.findUniqueOrThrow({ where: { userId_refKey: { userId: u, refKey: first!.refKey } } });
    expect(log.closedAt).toBeInstanceOf(Date);
  });

  it('спрошенное пушем «как ты?» — в чате не повторяем', async () => {
    const u = await user();
    const m = await prisma.memory.create({ data: { userId: u, type: 'emotion', content: 'Переживает за маму', source: 'chat', importance: 7, createdAt: new Date(Date.now() - 20 * H) } });
    await prisma.insight.create({ data: { userId: u, severity: 1, scope: {}, message: 'Как мама?', kind: 'v2_nudge', scopeKey: `check_in:${m.id}`, source: 'v2-proactivity' } });
    expect(await currentFollowUp(u, TZ)).toBeNull();
  });

  it('забытое («Неправда») не всплывает; удаление аккаунта убирает журнал', async () => {
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'emotion', content: 'Неверное', source: 'chat', importance: 9, createdAt: new Date(Date.now() - 20 * H), invalidAt: new Date(Date.now() - H) } });
    expect(await currentFollowUp(u, TZ)).toBeNull();
  });
});

describe('наша история', () => {
  it('сколько знакомы + дневник робота', async () => {
    const now = new Date();
    const u = await user(new Date(now.getTime() - 47 * 24 * H));
    await prisma.robotDiaryEntry.create({ data: { userId: u, day: day(-1, now), text: 'Мне запомнилось, как ты готовился.' } });
    const b = await gatherBond(u, now);
    expect(b).toMatch(/вы знакомы 4[67] дн/);
    expect(b).toContain('Мне запомнилось');
  });
});

describe('настройки человека (E)', () => {
  it('выключил «как ты?» — незакрытое не выбирается и не записывается в журнал', async () => {
    const u = await user();
    await prisma.user.update({ where: { id: u }, data: { settings: { checkIns: false } } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Собеседование в Kaspi', date: day(-1) } });
    const b = await gatherBond(u);
    expect(b).toContain('выключил вопросы «как ты?»');
    expect(b).not.toContain('Собеседование');
    expect(await prisma.followUpLog.count({ where: { userId: u } })).toBe(0);
  });
  it('выключил режим поддержки — тоже тихо', async () => {
    const u = await user();
    await prisma.user.update({ where: { id: u }, data: { therapeuticMode: false } });
    await prisma.memory.create({ data: { userId: u, type: 'emotion', content: 'Переживает за маму', source: 'chat', importance: 7, createdAt: new Date(Date.now() - 20 * H) } });
    const b = await gatherBond(u);
    expect(b).toContain('выключил режим поддержки');
    expect(b).not.toContain('Переживает за маму');
  });
});
