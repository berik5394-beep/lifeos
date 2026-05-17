import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 3 — НОВЫЙ tool. Прямой фикс бага #3: модель считала день
 * недели в уме от UTC-сдвинутой даты и уверенно поправляла правого
 * юзера («20 мая — вторник»). Теперь авторитетная дата + день недели
 * в TZ юзера (Asia/Almaty по умолчанию), плюс таблица ближайших дней
 * — модели НЕ НУЖНО считать календарь в голове.
 *
 * read-only, needsConfirm:false. Промпт (Шаг 5+) обяжет вызывать
 * этот tool перед любым упоминанием дня недели/«завтра»/«в среду».
 */

const RU_WEEKDAYS = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];

export function weekdayRu(tz: string, at: Date): string {
  // en-CA YYYY-MM-DD в зоне юзера → парсим как UTC-полдень, чтобы
  // getUTCDay() дал стабильный индекс дня недели без повторного TZ-сдвига.
  const [y, m, d] = localDateStr(tz, at).split('-').map(Number);
  return RU_WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

export const getToday = defineTool({
  name: 'get_today',
  description:
    'Авторитетные дата и день недели в часовом поясе пользователя + ' +
    'таблица ближайших 8 дней (дата→день недели). ВСЕГДА вызывай ' +
    'перед тем как назвать день недели, «сегодня/завтра/послезавтра» ' +
    'или сопоставить дату с днём недели — не считай календарь в уме.',
  category: 'info',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: [
    'какой сегодня день недели',
    'какое сегодня число',
    'среда это какое число',
    'поставь встречу в среду 20 мая',
  ],
  handler: async (_input, ctx) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const tz = user?.timezone || 'Asia/Almaty';
    const now = new Date();

    const upcoming: { date: string; weekday: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const at = new Date(now.getTime() + i * 86_400_000);
      upcoming.push({ date: localDateStr(tz, at), weekday: weekdayRu(tz, at) });
    }

    return {
      timezone: tz,
      today: localDateStr(tz, now),
      weekday: weekdayRu(tz, now),
      tomorrow: upcoming[1].date,
      dayAfterTomorrow: upcoming[2].date,
      upcoming,
    };
  },
});
