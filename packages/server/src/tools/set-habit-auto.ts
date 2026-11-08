import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { matchHabit } from './_habit-match.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { MAX_AUTO_STEPS, MIN_AUTO_STEPS } from '../services/habit-auto.js';

/**
 * Привычка отмечается САМА по шагам из «Здоровья» (iPhone). Включить:
 * steps = порог; выключить: off. Обратимо. Закрытие — при синке шагов
 * (routes/steps → closeHabitsBySteps), снятую вручную отметку не возвращает.
 */
const fmt = (n: number) => n.toLocaleString('ru-RU');

export const setHabitAutoTool = defineTool({
  name: 'set_habit_auto',
  description:
    'Привычка отмечается САМА по шагам из «Здоровья»: «отмечай ходьбу сама при 8000 ' +
    'шагов», «засчитывай прогулку автоматически, если пройду 10 тысяч», «закрывай ' +
    '„10 000 шагов“ по шагомеру». off: true — выключить («отмечать бег буду сам»). ' +
    'steps — порог (500–100000). Новую привычку — create_habit (у него тоже есть autoSteps).',
  category: 'habit',
  aliases: { name: 'habit', habitName: 'habit', threshold: 'steps', min: 'steps', minSteps: 'steps', disable: 'off' },
  schema: z.object({
    habit: z.string().min(1).max(120),
    steps: z.coerce.number().int().min(MIN_AUTO_STEPS).max(MAX_AUTO_STEPS).optional(),
    off: z.boolean().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отмечай ходьбу сама при 8000 шагов', 'выключи автоотметку прогулки'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const habits = await prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } });
    const hit = matchHabit(input.habit, habits);
    if (!hit) {
      const list = habits.map((h) => `«${h.name}»`).join(', ');
      return { message: list ? `Не нашёл привычку «${input.habit}». Сейчас: ${list}. Какую?` : 'Привычек пока нет — заведи, и я буду отмечать её по шагам.' };
    }
    if (input.off) {
      await prisma.habit.updateMany({ where: { id: hit.id, userId }, data: { autoComplete: Prisma.DbNull } });
      captureActivity(userId, { type: 'habit_auto_off', content: `Привычку «${hit.name}» больше не отмечаю по шагам` });
      return { message: `Ок, «${hit.name}» больше не отмечаю сама — отмечай вручную.`, habitId: hit.id };
    }
    if (!input.steps) return { message: `Сколько шагов — порог для «${hit.name}»? Например: 8000.`, habitId: hit.id };
    await prisma.habit.updateMany({ where: { id: hit.id, userId }, data: { autoComplete: { type: 'steps', min: input.steps } } });
    captureActivity(userId, { type: 'habit_auto_on', content: `«${hit.name}» отмечается сама от ${fmt(input.steps)} шагов` });
    return {
      message:
        `Готово: «${hit.name}» отметится сама, когда пройдёшь ${fmt(input.steps)} шагов — по данным «Здоровья» на iPhone. ` +
        'Снимешь галочку вручную — заново не поставлю.',
      habitId: hit.id,
    };
  },
});
