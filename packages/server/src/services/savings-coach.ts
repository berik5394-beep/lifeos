import type { SavingsStatus } from './savings-pace.js';

/**
 * Чистый гейт реактивного коуча: после расхода говорить ТОЛЬКО когда он
 * «бьёт по цели». Защищает от занудства (см. spec §7a).
 */
export interface NudgeGateInput {
  status: SavingsStatus;
  monthToDateExpense: number;
  monthlyIncome: number;
  requiredMonthly: number;
  expenseAmount: number;
  alreadyCoachedToday: boolean;
}

export function shouldNudgeOnExpense(g: NudgeGateInput): boolean {
  if (g.alreadyCoachedToday) return false;
  if (g.status !== 'behind' && g.status !== 'stalled') return false;
  const goalBudget = g.monthlyIncome - g.requiredMonthly; // макс. трат/мес чтобы успевать
  const monthOverBudget = g.monthToDateExpense > goalBudget;
  const largeSingle = g.monthlyIncome > 0 && g.expenseAmount >= 0.1 * g.monthlyIncome;
  return monthOverBudget || largeSingle;
}
