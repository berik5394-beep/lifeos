import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { matchHabit, buildNotFoundMessage } from './_habit-match.js';

/**
 * SSOT Step 5 — write-tool. Консолидирует прежний loop из
 * jarvis-orchestrator (резолв имён → complete_habit) В САМ tool.
 * Принимает имена (что даёт парсер) и/или id; считает успешные.
 */
export const completeMultipleHabitsTool = defineTool({
  name: 'complete_multiple_habits',
  description:
    'Отметить несколько привычек выполненными сегодня. Вызывай на ' +
    '«отметь бег и чтение», «закрой все утренние привычки».',
  category: 'habit',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { names: 'habitNames', habits: 'habitNames', habit_names: 'habitNames', ids: 'habitIds' },
  schema: z.object({
    habitNames: z.array(z.string().max(120)).max(30).optional(),
    habitIds: z.array(z.string().max(60)).max(30).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отметь бег и чтение', 'я сделал медитацию и зарядку'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // R9 TZ-aware: «сегодня» в локальной TZ юзера.
    const tz = await getUserTimezone(userId);
    const today = localDayStartUTC(tz);

    // R9 honesty #16 fix: name resolution параллельно (раньше N
    // sequential roundtrips к Prisma для каждого имени).
    const active = (input.habitNames ?? []).length
      ? await prisma.habit.findMany({
          where: { userId, active: true },
          select: { id: true, name: true },
        })
      : [];
    const nameResolves = (input.habitNames ?? []).map((name) => ({
      requestedName: name,
      habit: matchHabit(name, active),
    }));
    const notFound = nameResolves
      .filter((r) => !r.habit)
      .map((r) => r.requestedName);
    const resolvedIds = nameResolves
      .filter((r) => r.habit)
      .map((r) => r.habit!.id);
    const allIds = [...new Set([...(input.habitIds ?? []), ...resolvedIds])];

    // SECURITY (IDOR): модель управляет аргументом habitIds. Без проверки
    // владения чужой/несуществующий habitId создал бы HabitLog под чужой
    // привычкой. Оставляем только id, реально принадлежащие userId; чужие →
    // в failedIds (не пишем). resolvedIds уже свои — пройдут фильтр.
    const ownedRows = allIds.length
      ? await prisma.habit.findMany({
          where: { userId, id: { in: allIds } },
          select: { id: true },
        })
      : [];
    const ownedSet = new Set(ownedRows.map((h) => h.id));
    const ownedIds = allIds.filter((id) => ownedSet.has(id));
    const unownedIds = allIds.filter((id) => !ownedSet.has(id));

    // R9 honesty #16 fix: upsert параллельно через Promise.allSettled +
    // per-habit status (раньше sequential + silent console.warn skip;
    // юзер видел «Отмечено: N» без понимания которые именно failed).
    const results = await Promise.allSettled(
      ownedIds.map(async (habitId) => {
        const log = await prisma.habitLog.upsert({
          where: { habitId_date: { habitId, date: today } },
          update: { completed: true },
          create: { habitId, userId, date: today, completed: true },
          select: { habitId: true },
        });
        return log.habitId;
      }),
    );
    const succeededIds: string[] = [];
    // Чужие/несуществующие id — сразу провал (ничего не записано).
    const failedIds: string[] = [...unownedIds];
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') succeededIds.push(r.value);
      else {
        failedIds.push(ownedIds[idx]);
        console.warn(
          `[complete_multiple_habits] upsert failed habitId=${ownedIds[idx]}:`,
          r.reason instanceof Error ? r.reason.message : r.reason,
        );
      }
    });

    if (succeededIds.length === 0 && (input.habitIds ?? []).length === 0) {
      // НИ одной привычки не отмечено → честный провал (модель не врёт «отметил»).
      throw new Error(buildNotFoundMessage((input.habitNames ?? []).join(', '), active));
    }

    const parts: string[] = [`Отмечено привычек: ${succeededIds.length} ✅`];
    if (failedIds.length > 0) {
      parts.push(`Не удалось: ${failedIds.length}`);
    }
    if (notFound.length > 0) {
      parts.push(`Не найдено: ${notFound.join(', ')}`);
    }

    return {
      message: parts.join('. '),
      count: succeededIds.length,
      // R9 honesty: per-habit status array — агент видит правду
      succeededIds,
      failedIds,
      notFoundNames: notFound,
    };
  },
});
