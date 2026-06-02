/**
 * Чистое решение «создать новую цель vs обновить существующую» для
 * единого захвата цели (suggest_goal стал create-or-update). Без БД:
 * хендлер передаёт уже отфильтрованных кандидатов (та же area/год),
 * helper решает. Тестируется без Prisma.
 *
 * Правило (см. спеку 2026-06-02-financial-goal-capture):
 *  1. явный goalId совпал с кандидатом → update его;
 *  2. иначе нормализованный текст совпал ИЛИ один — префикс другого
 *     (юзер дописал срок/уточнение к той же цели) → update;
 *  3. иначе → create (разные цели = разный текст: «100к к месяцу» и
 *     «3 млн за год» — две цели).
 */
export interface GoalCandidate {
  id: string;
  goalText: string;
}

export interface GoalWriteInput {
  goalId?: string;
  goalText: string;
}

export type GoalWriteDecision =
  | { mode: 'create' }
  | { mode: 'update'; goalId: string };

/** Минимальный префикс для «это та же цель, дописали хвост». */
const MIN_PREFIX = 8;

function normGoal(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decideGoalWrite(
  existing: GoalCandidate[],
  input: GoalWriteInput,
): GoalWriteDecision {
  // 1. Явный id — самый надёжный сигнал правки (бот видит цели с id).
  if (input.goalId) {
    const hit = existing.find((g) => g.id === input.goalId);
    if (hit) return { mode: 'update', goalId: hit.id };
  }
  // 2. Текстовое совпадение / расширение (переформулировал ту же цель).
  const target = normGoal(input.goalText);
  if (target) {
    for (const g of existing) {
      const cand = normGoal(g.goalText);
      if (!cand) continue;
      if (cand === target) return { mode: 'update', goalId: g.id };
      const shorter = cand.length <= target.length ? cand : target;
      const longer = cand.length <= target.length ? target : cand;
      if (shorter.length >= MIN_PREFIX && longer.startsWith(shorter)) {
        return { mode: 'update', goalId: g.id };
      }
    }
  }
  // 3. Иначе — новая цель.
  return { mode: 'create' };
}
