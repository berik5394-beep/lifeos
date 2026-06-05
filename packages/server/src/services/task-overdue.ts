import { prisma } from '../lib/prisma.js';

/**
 * Сколько НЕвыполненных и НЕотменённых задач висит с прошлых дней
 * (date < начало сегодняшнего локального дня). Фикс C: такие задачи
 * не переносятся и не видны «на сегодня» → раньше «пропадали».
 * READ-ONLY. todayStart = UTC-instant начала локального дня юзера.
 */
export async function countOverduePending(
  userId: string,
  todayStart: Date,
): Promise<number> {
  try {
    return await prisma.task.count({
      where: {
        userId,
        date: { lt: todayStart },
        completed: false,
        cancelled: false,
      },
    });
  } catch {
    return 0;
  }
}
