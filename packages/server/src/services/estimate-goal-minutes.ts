import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import { isV2MonthLoadEnabled } from '../lib/feature-flags.js';

export const DEFAULT_GOAL_MINUTES = 120; // 2 ч/нед
const MIN_GOAL_MINUTES = 15;
const MAX_GOAL_MINUTES = 1200; // 20 ч/нед

/**
 * Минуты усилия/нед из ответа модели. Чистая.
 * `0` → 0 (цель не про время, напр. накопить денег). Иначе кламп
 * [15, 1200]. Нет числа → DEFAULT.
 */
export function parseGoalMinutes(text: string): number {
  const m = text.match(/\d+/);
  if (!m) return DEFAULT_GOAL_MINUTES;
  const n = Number(m[0]);
  if (n === 0) return 0;
  return Math.min(MAX_GOAL_MINUTES, Math.max(MIN_GOAL_MINUTES, Math.round(n)));
}

/**
 * Оценка усилия недельной цели (минуты/нед). Best-effort haiku;
 * на любой сбой → DEFAULT_GOAL_MINUTES. Без БД.
 */
export async function estimateWeeklyGoalMinutes(goalText: string): Promise<number> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return DEFAULT_GOAL_MINUTES;
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 16,
      system:
        'Оцени, сколько МИНУТ усилия в НЕДЕЛЮ среднему человеку нужно ' +
        'на эту недельную цель. Если цель не про затраты времени ' +
        '(например, накопить денег) — верни 0. ' +
        'Верни ТОЛЬКО целое число минут, без слов.',
      messages: [{ role: 'user', content: `Недельная цель: «${goalText}»` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? parseGoalMinutes(block.text) : DEFAULT_GOAL_MINUTES;
  } catch {
    return DEFAULT_GOAL_MINUTES;
  }
}

/**
 * Фоновая оценка недельной цели (только если ещё не задана). Гейт флагом
 * FEATURE_V2_MONTH_LOAD. Fire-and-forget — не блокирует создание цели.
 */
export async function estimateWeeklyGoalMinutesInBackground(
  goalId: string,
  goalText: string,
  userId: string,
): Promise<void> {
  if (!isV2MonthLoadEnabled(userId)) return;
  try {
    const minutes = await estimateWeeklyGoalMinutes(goalText);
    await prisma.weeklyGoal.updateMany({
      where: { id: goalId, estimatedMinutes: null },
      data: { estimatedMinutes: minutes },
    });
  } catch {
    /* best-effort */
  }
}
