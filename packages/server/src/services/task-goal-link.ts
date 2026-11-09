/**
 * Задача ↔ годовая цель. Детектор «цель стоит» (strategic-view) засчитывает
 * цели шагами только закрытые задачи с planParentType='YearlyGoal' — а
 * обычная задача «прочитать главу» к цели «24 книги» не привязывалась, и
 * робот мог решить, что цель стоит, хотя по ней работают.
 *
 * Фоном после создания задачи: haiku выбирает цель, ТОЛЬКО если задача —
 * явный шаг к ней (корни слов тут опасны: «купить хлеб» ≠ «купить квартиру»).
 * Не уверен → не привязываем. Обратимо (planParentId), уже привязанные
 * (план-разбивка) не трогаем. Факт привязки — в память (робот знает).
 */
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { captureActivity } from './tool-activity-summary.js';

const MAX_GOALS = 12;

/**
 * Номер цели из ответа модели (1..n) или null: «0», нет числа, вне диапазона,
 * несколько чисел (модель колеблется) — не привязываем.
 */
export function parseGoalPick(text: string, n: number): number | null {
  const nums = text.match(/\d+/g);
  if (!nums || nums.length !== 1) return null;
  const k = Number(nums[0]);
  return Number.isInteger(k) && k >= 1 && k <= n ? k - 1 : null;
}

export function goalPickPrompt(taskTitle: string, goals: Array<{ goalText: string }>): string {
  const list = goals.map((g, i) => `${i + 1}. ${g.goalText}`).join('\n');
  return `Задача: «${taskTitle}»\n\nЦели:\n${list}`;
}

async function pickGoal(taskTitle: string, goals: Array<{ goalText: string }>): Promise<number | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  const client = createAnthropic(apiKey);
  const resp = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 8,
    system:
      'Определи, является ли задача ЯВНЫМ шагом к одной из целей человека. ' +
      'Совпадение слов не считается («купить хлеб» не шаг к «купить квартиру»). ' +
      'Если задача явно двигает к цели — верни ТОЛЬКО её номер. ' +
      'Если не уверен или ни к одной — верни 0. Только число, без слов.',
    messages: [{ role: 'user', content: goalPickPrompt(taskTitle, goals) }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? parseGoalPick(block.text, goals.length) : null;
}

/**
 * Привязать только что созданную задачу к годовой цели, если она явно шаг к ней.
 * Best-effort, НИКОГДА не бросает. Возвращает текст цели (для тестов/логов) или null.
 */
export async function linkTaskToGoal(
  userId: string,
  taskId: string,
  taskTitle: string,
  now: Date = new Date(),
  pick: (title: string, goals: Array<{ goalText: string }>) => Promise<number | null> = pickGoal,
): Promise<string | null> {
  try {
    const goals = await prisma.yearlyGoal.findMany({
      where: { userId, year: now.getUTCFullYear(), progress: { lt: 100 } }, // UTC — как strategic-view
      select: { id: true, goalText: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_GOALS,
    });
    if (goals.length === 0) return null;
    const k = await pick(taskTitle, goals);
    if (k == null) return null;
    const goal = goals[k];
    // Только свою и только ещё не привязанную (план-разбивку не перетираем).
    const r = await prisma.task.updateMany({
      where: { id: taskId, userId, planParentId: null },
      data: { planParentId: goal.id, planParentType: 'YearlyGoal' },
    });
    if (r.count === 0) return null;
    captureActivity(userId, {
      type: 'task_goal_linked',
      content: `Задачу «${taskTitle}» засчитаю шагом к цели «${goal.goalText}»`,
    });
    return goal.goalText;
  } catch (err) {
    console.warn('[task-goal-link] failed:', err);
    return null;
  }
}

/** Фоном (не задерживает ответ на создание задачи). */
export function linkTaskToGoalInBackground(userId: string, taskId: string, taskTitle: string): void {
  void linkTaskToGoal(userId, taskId, taskTitle);
}
