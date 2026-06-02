import { prisma } from '../lib/prisma.js';
import { parseGoalDeadline } from './goal-deadline.js';
import { decideGoalWrite } from './goal-write.js';

/**
 * Запись цели ПОСЛЕ подтверждения «да». Вызывается из runConfirmedAction
 * (action='commit_goal'), которую ставит suggest_goal-предложитель. То
 * есть друг СПРАШИВАЕТ (suggest_goal → pending+вопрос), а реально пишет
 * только здесь, на «да» — как деньги (propose → confirm → write).
 *
 * create-OR-update (decideGoalWrite): не плодит дубли, закрывает правку.
 * Срок: ISO как есть, иначе относительная фраза → parseGoalDeadline.
 * Пишет числовой target + targetDate, которые читает коуч по накоплениям.
 */
export interface CommitGoalInput {
  area: string;
  goalText: string;
  target?: number | null;
  targetDate?: string | null; // ISO 'YYYY-MM-DD' или относительная фраза
  goalId?: string;
}

export async function commitGoal(
  userId: string,
  input: CommitGoalInput,
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();

  let targetDate: Date | null = null;
  const rawDate =
    typeof input.targetDate === 'string' ? input.targetDate.trim() : '';
  if (rawDate) {
    targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? new Date(rawDate + 'T12:00:00Z')
      : parseGoalDeadline(rawDate, now);
  }
  const target =
    typeof input.target === 'number' && Number.isFinite(input.target)
      ? input.target
      : null;

  const existing = await prisma.yearlyGoal.findMany({
    where: { userId, year, area: input.area },
    select: { id: true, goalText: true },
  });
  const decision = decideGoalWrite(existing, {
    goalId: input.goalId,
    goalText: input.goalText,
  });

  const fields = {
    goalText: input.goalText,
    ...(target !== null ? { target } : {}),
    ...(targetDate !== null ? { targetDate } : {}),
  };

  let verb: string;
  if (decision.mode === 'update') {
    await prisma.yearlyGoal.update({ where: { id: decision.goalId }, data: fields });
    verb = 'обновлена';
  } else {
    await prisma.yearlyGoal.create({
      data: { userId, year, area: input.area, ...fields },
    });
    verb = 'записана';
  }

  const parts = [`«${input.goalText}»`];
  if (target !== null) {
    parts.push(`${Math.round(target)}${input.area === 'finance' ? '₸' : ''}`);
  }
  if (targetDate) parts.push(`к ${targetDate.toISOString().slice(0, 10)}`);
  return `Цель ${verb}: ${parts.join(' ')} (${input.area}). Буду вести.`;
}
