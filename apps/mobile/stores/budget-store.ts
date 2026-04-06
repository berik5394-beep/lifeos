import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface BudgetLimit {
  id: string;
  userId: string;
  category: string;
  monthlyLimit: number;
  month: number;
  year: number;
}

export interface FinanceCategoryAdvice {
  category: string;
  spent: number;
  limit: number;
  percentage: number;
  status: string;
}

export interface FinanceAdvice {
  categories: FinanceCategoryAdvice[];
  totalSpent: number;
  totalBudget: number;
  daysRemaining: number;
  dailyBudget: number;
  advice: string;
}

interface SetBudgetData {
  category: string;
  monthlyLimit: number;
  month: number;
  year: number;
}

interface BudgetState {
  budgets: BudgetLimit[];
  advice: FinanceAdvice | null;
  isLoading: boolean;
  fetchBudgets: (month: string) => Promise<void>;
  setBudget: (data: SetBudgetData) => Promise<void>;
  fetchAdvice: () => Promise<void>;
}

export const useBudgetStore = create<BudgetState>((set) => ({
  budgets: [],
  advice: null,
  isLoading: false,

  fetchBudgets: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const budgets = await api.get<BudgetLimit[]>(`/finance/budget/${month}`, token);
      set({ budgets, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setBudget: async (data: SetBudgetData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const budget = await api.post<BudgetLimit>('/finance/budget', data, token);
    set((state) => {
      const exists = state.budgets.findIndex(
        (b) => b.category === budget.category && b.month === budget.month && b.year === budget.year,
      );
      if (exists >= 0) {
        const updated = [...state.budgets];
        updated[exists] = budget;
        return { budgets: updated };
      }
      return { budgets: [...state.budgets, budget] };
    });
  },

  fetchAdvice: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const advice = await api.get<FinanceAdvice>('/finance/advice', token);
      set({ advice, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
