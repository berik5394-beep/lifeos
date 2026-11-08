import { create } from 'zustand';
import { expenseCategories } from '@/constants';
import type { RobotEmotion } from '@/services/robot-emotion';

/**
 * Реакция робота на действие С ЭКРАНА (тап, не разговор): закрыл задачу,
 * отметил привычку, записал трату сверх лимита. Раньше робот узнавал об этом
 * только в следующий тик/бриф/разговор — теперь отвечает сразу, на обоих экранах.
 */
export interface RobotReaction {
  id: string;
  /** Когда случилось (мс): экран, открытый позже, не «проигрывает» старую реакцию. */
  at: number;
  emotion: RobotEmotion;
  /** Облачко робота; без текста — только эмоция. */
  text?: string;
  /** Сколько держать облачко (мс); нет — обычное время экрана. */
  holdMs?: number;
}

interface RobotReactionState {
  reaction: RobotReaction | null;
  react: (emotion: RobotEmotion, text?: string, holdMs?: number) => void;
}

let seq = 0;

export const useRobotReactionStore = create<RobotReactionState>((set) => ({
  reaction: null,
  react: (emotion, text, holdMs) => {
    seq += 1;
    const at = Date.now();
    set({
      reaction: { id: `screen-${at}-${seq}`, at, emotion, ...(text ? { text } : {}), ...(holdMs ? { holdMs } : {}) },
    });
  },
}));

/** То, что сервер возвращает к трате, если на категорию есть лимит. */
export interface BudgetInfo {
  limit: number;
  spent: number;
  percentage: number;
  warning?: string;
}

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

/**
 * Облачко после траты: только когда сервер предупредил (≥80% лимита). Числа —
 * из ответа сервера, категория — по-русски (в `warning` сервера она ключом: "food").
 */
export function budgetReactionText(category: string, info: BudgetInfo | undefined): string | null {
  if (!info?.warning || !(info.limit > 0)) return null;
  const label = expenseCategories[category as keyof typeof expenseCategories]?.label ?? category;
  if (info.percentage >= 100) {
    return `Лимит на «${label}» превышен: ${money(info.spent)} из ${money(info.limit)}.`;
  }
  return `На «${label}» ушло ${info.percentage}% лимита — осталось ${money(info.limit - info.spent)}.`;
}
