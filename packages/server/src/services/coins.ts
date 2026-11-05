import { prisma } from '../lib/prisma.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateOnlyUTC, localDateStr, localDayStartUTC } from '../lib/tz.js';

/**
 * Робот-эпик, Часть 6: монеты за дела — на них покупается ремонт комнаты.
 * Одна точка начислений и из приложения (REST), и из мозга (инструменты).
 * Идемпотентно (одно дело — одно начисление, снятие отметки не возвращает
 * монеты), лимит в сутки против «фарма». Best-effort: сбой не ломает дело.
 */
export const COIN_REWARD = {
  task: 10,
  habit: 5,
  journal: 5,
  day100: 30,
  start: 200,
} as const;

export const DAILY_COIN_CAP = 300;

/** Ключи идемпотентности: одно дело — одно начисление. */
export const coinKey = {
  task: (taskId: string) => `task:${taskId}`,
  habit: (habitId: string, civilDate: string) => `habit:${habitId}:${civilDate}`,
  journal: (civilDate: string) => `journal:${civilDate}`,
  day100: (civilDate: string) => `day100:${civilDate}`,
  start: () => 'start',
};

/** Сколько можно начислить сейчас с учётом лимита (чистая). */
export function cappedAmount(amount: number, earnedToday: number, cap = DAILY_COIN_CAP): number {
  return Math.max(0, Math.min(amount, cap - earnedToday));
}

export async function coinBalance(userId: string): Promise<number> {
  const r = await prisma.coinTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/**
 * Начислить монеты за дело. Возвращает начисленное (0 — уже было, лимит
 * исчерпан или сбой). Стартовый подарок лимитом не ограничен.
 */
export async function awardCoins(
  userId: string,
  refKey: string,
  amount: number,
  reason: string,
  now: Date = new Date(),
): Promise<number> {
  try {
    // Часовой пояс — ДО транзакции: внутри держим замок, а запрос через общий
    // клиент взял бы второе соединение → при гонке пул исчерпан → дедлок.
    const dayStart = refKey === coinKey.start() ? null : localDayStartUTC(await getUserTimezone(userId), now);
    return await prisma.$transaction(async (tx) => {
      // Пер-юзерный замок: параллельные начисления не пробьют дневной лимит.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coins:' + userId}))`;
      const exists = await tx.coinTransaction.findUnique({ where: { userId_refKey: { userId, refKey } } });
      if (exists) return 0;
      let give = amount;
      if (dayStart) {
        const earned = await tx.coinTransaction.aggregate({
          where: {
            userId,
            amount: { gt: 0 },
            refKey: { not: coinKey.start() },
            createdAt: { gte: dayStart },
          },
          _sum: { amount: true },
        });
        give = cappedAmount(amount, earned._sum.amount ?? 0);
      }
      if (give <= 0) return 0;
      await tx.coinTransaction.create({ data: { userId, refKey, amount: give, reason } });
      return give;
    });
  } catch (err) {
    console.warn('[coins] award failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Стартовый подарок (один раз). */
export function grantStartBonus(userId: string): Promise<number> {
  return awardCoins(userId, coinKey.start(), COIN_REWARD.start, 'Подарок на новоселье');
}

/** Бонус за день на 100%: все задачи на сегодня и все привычки выполнены. */
export async function maybeAwardFullDay(userId: string, now: Date = new Date()): Promise<number> {
  try {
    const tz = await getUserTimezone(userId);
    const today = localDateOnlyUTC(tz, now);
    const [tasksTotal, tasksOpen, habits, habitsDone] = await Promise.all([
      prisma.task.count({ where: { userId, date: today, cancelled: false } }),
      prisma.task.count({ where: { userId, date: today, cancelled: false, completed: false } }),
      prisma.habit.count({ where: { userId, active: true } }),
      prisma.habitLog.count({ where: { userId, date: today, completed: true, habit: { active: true } } }),
    ]);
    if (tasksTotal + habits === 0 || tasksOpen > 0 || habitsDone < habits) return 0;
    return awardCoins(userId, coinKey.day100(localDateStr(tz, now)), COIN_REWARD.day100, 'День на 100%', now);
  } catch {
    return 0;
  }
}

/** Задача выполнена → монеты (+ проверка «день на 100%»). Не бросает. */
export async function onTaskCompleted(userId: string, taskId: string, title: string): Promise<void> {
  await awardCoins(userId, coinKey.task(taskId), COIN_REWARD.task, `Задача «${title}»`);
  await maybeAwardFullDay(userId);
}

/**
 * Привычка отмечена на дату → монеты (+ «день на 100%»). Только за СЕГОДНЯ —
 * отметки задним числом монет не дают (иначе «фарм» прошлыми днями). Не бросает.
 */
export async function onHabitDone(
  userId: string,
  habitId: string,
  civilDate: string,
  name: string,
  now: Date = new Date(),
): Promise<void> {
  const today = localDateStr(await getUserTimezone(userId), now);
  if (civilDate !== today) return;
  await awardCoins(userId, coinKey.habit(habitId, today), COIN_REWARD.habit, `Привычка «${name}»`, now);
  await maybeAwardFullDay(userId, now);
}

/** Запись в дневнике → монеты раз в день (за сегодня, какую бы дату ни правили). Не бросает. */
export async function onJournalWritten(userId: string, now: Date = new Date()): Promise<void> {
  const today = localDateStr(await getUserTimezone(userId), now);
  await awardCoins(userId, coinKey.journal(today), COIN_REWARD.journal, 'Запись в дневнике', now);
}
