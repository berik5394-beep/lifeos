import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherOpenLoops } from './open-loops.js';
import { localDateOnlyUTC, localDayStartUTC } from '../lib/tz.js';

// Pattern from mem-graph.it.test.ts: own PrismaClient, disconnect in afterAll.
// Каждый it-блок стартует на чистой БД (setup.ts → beforeEach → resetDb).
const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

// Asia/Almaty = +5 → convA (localDateOnlyUTC = T00:00Z самой календарной даты)
// ≠ convB (localDayStartUTC = реальный UTC-инстант локальной полуночи = вчера 19:00Z).
// Привычка, отмеченная convB (как пишет complete-habit), должна распознаваться
// как «отмечена сегодня» — иначе TZ-баг.
const TZ = 'Asia/Almaty';

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `it-loops-${tag}@it.local`,
      name: 'IT',
      passwordHash: 'x',
      timezone: TZ,
    },
  });
  return u.id;
}

const now = new Date();
const taskToday = localDateOnlyUTC(TZ, now); // @db.Date — задачи (как пишут задачи)
const taskYesterday = new Date(taskToday.getTime() - 86_400_000); // просрочка (date < taskToday)
const habitToday = localDayStartUTC(TZ, now); // HabitLog — ровно как пишет complete-habit

describe('open-loops gather — реальные счётчики + TZ', () => {
  it('3 просрочки + 4 привычки (2 отмечены сегодня convB) → overdue=3, unchecked=2; отмеченная НЕ в unchecked', async () => {
    const uid = await mkUser(`g-${Date.now()}`);
    for (let i = 0; i < 3; i++) {
      await prisma.task.create({
        data: {
          userId: uid,
          title: `задача ${i}`,
          category: 'personal',
          priority: 'medium',
          date: taskYesterday,
          completed: false,
        },
      });
    }
    const hs = [];
    for (let i = 0; i < 4; i++) {
      hs.push(
        await prisma.habit.create({
          data: {
            userId: uid,
            name: `привычка ${i}`,
            category: 'health',
            frequency: 'daily',
            active: true,
          },
        }),
      );
    }
    // 2 отмечены СЕГОДНЯ той же конвенцией, что complete-habit (localDayStartUTC)
    await prisma.habitLog.create({
      data: { userId: uid, habitId: hs[0].id, date: habitToday, completed: true },
    });
    await prisma.habitLog.create({
      data: { userId: uid, habitId: hs[1].id, date: habitToday, completed: true },
    });

    const l = await gatherOpenLoops(uid, now);
    expect(l.overdueCount).toBe(3);
    expect(l.habitsActive).toBe(4);
    expect(l.habitsUnchecked).toBe(2); // ← TZ-фикс: convB-лог распознан как отмеченный
    expect(l.uncheckedHabitNames).not.toContain(hs[0].name);
    expect(l.uncheckedHabitNames).not.toContain(hs[1].name);
    expect(l.overdueTitles.length).toBeGreaterThan(0);
  });

  it('PendingAction → pendingText непустой; нет → null', async () => {
    const uid = await mkUser(`p-${Date.now()}`);
    let l = await gatherOpenLoops(uid, now);
    expect(l.pendingText).toBeNull();
    await prisma.pendingAction.create({
      data: {
        userId: uid,
        action: 'add_expense',
        inputJson: {},
        confirmationText: 'подтвердить расход 3000',
      },
    });
    l = await gatherOpenLoops(uid, now);
    expect(l.pendingText).toContain('подтвердить');
  });

  it('cross-user: чужие задачи/привычки не считаются', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    const u2 = await mkUser(`x2-${Date.now()}`);
    await prisma.task.create({
      data: {
        userId: u2,
        title: 'чужая',
        category: 'personal',
        priority: 'medium',
        date: taskYesterday,
        completed: false,
      },
    });
    await prisma.habit.create({
      data: {
        userId: u2,
        name: 'чужая привычка',
        category: 'health',
        frequency: 'daily',
        active: true,
      },
    });
    const l = await gatherOpenLoops(u1, now);
    expect(l.overdueCount).toBe(0);
    expect(l.habitsActive).toBe(0);
  });
});
