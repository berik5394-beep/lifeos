import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { matchHabit } from './_habit-match.js';
import { MAX_AUTO_STEPS, MIN_AUTO_STEPS } from '../services/habit-auto.js';

/**
 * Завести новую привычку из чата (аудит-фикс MISSING — раньше можно было
 * только отмечать). Кросс-домен привычка↔цель: если передано имя цели,
 * резолвим в YearlyGoal и привязываем (goalId) → уже-построенный
 * detectGoalHabitStall + текст-связка в complete_habit подхватывают.
 * Дедуп по имени (matchHabit) — не плодим дубли, иначе матч становится
 * неоднозначным. needsConfirm:false (обратимо, не деньги).
 */
const CATEGORIES = ['health', 'work', 'personal'];

/** Свободная частота модели → ключ экрана (аудит 2026-11-09). */
export function normalizeFrequency(raw?: string): 'daily' | 'weekly' | 'monthly' {
  const t = (raw ?? '').toLowerCase();
  if (!t || /daily|ежеднев|каждый\s+день|каждое\s+утро|каждый\s+вечер|в\s+день/.test(t)) return 'daily';
  if (/month|месяц|ежемесяч/.test(t)) return 'monthly';
  if (/week|недел|выходн|по\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)/.test(t)) return 'weekly';
  return 'daily';
}

export const createHabitTool = defineTool({
  name: 'create_habit',
  description:
    'Завести НОВУЮ привычку («заведи привычку зарядка», «новая привычка ' +
    'чтение»). Можно привязать к годовой цели (передай goal) — тогда буду ' +
    'напоминать, если будешь её забрасывать. frequency: daily | weekly | monthly. autoSteps — отмечать саму по шагам ' +
    '(«ходьба 8000 шагов, отмечай сама»). Категории: health, work, personal.',
  category: 'habit',
  aliases: { habit: 'name', title: 'name', habitName: 'name', habit_name: 'name', goalName: 'goal', goalText: 'goal', goal_text: 'goal' },
  schema: z.object({
    name: z.string().min(1).max(120),
    category: z.string().max(40).optional(),
    frequency: z.string().max(40).optional(),
    goal: z.string().max(200).optional(),
    // Отмечать саму по шагам из «Здоровья» («ходьба, отмечай сама от 8000 шагов»).
    autoSteps: z.coerce.number().int().min(MIN_AUTO_STEPS).max(MAX_AUTO_STEPS).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['заведи привычку зарядка', 'новая привычка чтение к цели 50 книг'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // Дедуп: не плодим одинаковые привычки (иначе complete_habit станет неоднозначным).
    const active = await prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    });
    // Дубль — только то же название (без регистра/ё). Раньше нечёткое совпадение по
    // одному слову: «вечерняя пробежка» при «Утренней пробежке», «Чтение Корана» при
    // «Чтении» → «уже есть», новая не заводилась (аудит 2026-11-09).
    const norm = (x: string) => x.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    const existing = active.find((h) => norm(h.name) === norm(input.name)) ?? null;
    if (existing) {
      return { message: `Привычка «${existing.name}» уже есть — отмечать её можно сразу.`, habitId: existing.id, existed: true };
    }
    // Кросс-домен привычка↔цель: привязка к годовой цели по имени.
    let goalId: string | undefined;
    let goalText: string | undefined;
    if (input.goal) {
      const year = new Date().getUTCFullYear();
      const goals = await prisma.yearlyGoal.findMany({
        where: { userId, year },
        select: { id: true, goalText: true },
      });
      const matched = matchHabit(input.goal, goals.map((g) => ({ id: g.id, name: g.goalText })));
      if (matched) {
        goalId = matched.id;
        goalText = matched.name;
      }
    }
    const category = input.category && CATEGORIES.includes(input.category) ? input.category : 'personal';
    // Экран делит строго на daily/weekly/monthly — «3 раза в неделю» иначе не видно нигде.
    const frequency = normalizeFrequency(input.frequency);
    const maxOrder = await prisma.habit.aggregate({ where: { userId }, _max: { order: true } });
    const habit = await prisma.habit.create({
      data: {
        userId,
        name: input.name,
        category,
        frequency,
        goalId,
        order: (maxOrder._max.order ?? -1) + 1,
        ...(input.autoSteps ? { autoComplete: { type: 'steps', min: input.autoSteps } } : {}),
      },
    });
    const suffix =
      (goalText ? ` — привязал к цели «${goalText}», буду напоминать, если забросишь` : '') +
      (input.autoSteps ? `; отмечу сама, когда пройдёшь ${input.autoSteps.toLocaleString('ru-RU')} шагов (по «Здоровью»)` : '');
    return { message: `Завёл привычку «${habit.name}»${suffix}. Отмечай — буду считать серию.`, habitId: habit.id, goalId };
  },
});
