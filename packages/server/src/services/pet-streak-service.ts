import { prisma } from '../lib/prisma.js';

/**
 * A.1 — оживление Pet.streak.
 *
 * Раньше `Pet.streak` читался в 8+ местах (костюмы 3/7/14/30/60/100,
 * бейдж iron_will, powerScore-бонус, инсайты), но НИ ОДНА функция в
 * него не писала — вся мета-игра со стриком была мертва.
 *
 * Теперь раз в день оцениваем ЗАВЕРШЁННЫЙ предыдущий день: если
 * выполнение дня (привычки 50% + задачи 50%) > 60% — стрик +1, иначе
 * сброс в 0. Идемпотентность — через `Pet.streakDate` (за какой день
 * стрик уже зачтён). Мёртвые питомцы пропускаются (воскрешение само
 * обнуляет стрик).
 *
 * TZ: используем серверную дату, как и весь остальной код. Сквозная
 * проблема таймзон (аудит 2.7) — отдельная большая задача, тут её не
 * решаем, чтобы не плодить несогласованность.
 */

export const STREAK_DAY_THRESHOLD = 60; // % выполнения дня для +1

/**
 * Чистое решение: каким станет стрик. Тестируется без БД.
 *
 * `hadActivity` — было ли вчера ВООБЩЕ что оценивать (хоть одна
 * задача или активная привычка). Пустой день (0 задач, 0 привычек)
 * НЕ повод рвать серию: считать «нечего было делать → провалил» —
 * это ложь bug-#1 класса (мета-игра наказывает за несуществующий
 * провал). Пустой день → стрик НЕ меняется (ни +1, ни сброс).
 * CLAUDE.md: серия = «дней подряд здоровье > 60%», пустой день
 * здоровье не роняет.
 */
export function streakDecision(
  prevStreak: number,
  dayPercent: number,
  hadActivity: boolean,
): number {
  if (!hadActivity) return prevStreak;
  return dayPercent >= STREAK_DAY_THRESHOLD ? prevStreak + 1 : 0;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Выполнение дня в % (привычки 50 + задачи 50) — как в goodnight-итоге.
 * `hadActivity` — был ли день вообще «оцениваемым» (хоть одна задача
 * ИЛИ активная привычка); пустой день стрик не трогает (см.
 * streakDecision).
 */
async function dayCompletion(
  userId: string,
  day: Date,
): Promise<{ pct: number; hadActivity: boolean }> {
  const [tasks, habits, habitLogs] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: day }, select: { completed: true } }),
    prisma.habit.count({ where: { userId, active: true } }),
    prisma.habitLog.count({ where: { userId, date: day, completed: true } }),
  ]);
  const tasksDone = tasks.filter((t) => t.completed).length;
  const tasksPart = (tasksDone / Math.max(tasks.length, 1)) * 50;
  const habitsPart = (habitLogs / Math.max(habits, 1)) * 50;
  return {
    pct: Math.round(tasksPart + habitsPart),
    hadActivity: tasks.length > 0 || habits > 0,
  };
}

/**
 * Оценивает стрик одного юзера за вчера (идемпотентно). Возвращает
 * новый стрик или null если пропущено (нет/мёртв/уже оценён).
 */
export async function evaluatePetStreak(userId: string): Promise<number | null> {
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const pet = await prisma.pet.findUnique({
    where: { userId },
    select: { streak: true, isAlive: true, streakDate: true },
  });
  if (!pet || !pet.isAlive) return null;
  // Уже зачтено за вчера (или позже) — идемпотентно пропускаем.
  if (pet.streakDate && startOfDay(pet.streakDate) >= yesterday) return null;

  const { pct, hadActivity } = await dayCompletion(userId, yesterday);
  const next = streakDecision(pet.streak, pct, hadActivity);

  // streakDate ставим всегда (день финализирован — идемпотентно не
  // переоценим), но при пустом дне streak не меняется (next===prev).
  await prisma.pet.update({
    where: { userId },
    data: { streak: next, streakDate: yesterday },
  });
  return next;
}

/**
 * Дневной проход: оценить стрик всем живым питомцам, у кого ещё не
 * зачтён вчерашний день. Бережёт нагрузку — фильтр по streakDate.
 * Зовётся из планировщика (он и так тикает).
 */
export async function runPetStreakSweep(): Promise<number> {
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const pets = await prisma.pet.findMany({
    where: {
      isAlive: true,
      OR: [{ streakDate: null }, { streakDate: { lt: yesterday } }],
    },
    select: { userId: true },
    take: 1000,
  });

  let updated = 0;
  for (const p of pets) {
    try {
      const r = await evaluatePetStreak(p.userId);
      if (r !== null) updated++;
    } catch (err) {
      console.warn(
        `[pet-streak] eval failed user=${p.userId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (updated > 0) console.log(`[pet-streak] sweep: ${updated} pets updated`);
  return updated;
}
