import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { persistStoreData } from '@/services/store-persist';

interface Expense {
  id: string;
  userId: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  createdAt: string;
}

interface Income {
  id: string;
  userId: string;
  date: string;
  source: string;
  amount: number;
  createdAt: string;
}

interface TopCategory {
  category: string;
  amount: number;
}

interface Summary {
  totalExpenses: number;
  totalIncomes: number;
  balance: number;
  expenseCount: number;
  incomeCount: number;
  topCategories: TopCategory[];
}

interface CreateExpenseData {
  date: string;
  category: string;
  description: string;
  amount: number;
}

interface CreateIncomeData {
  date: string;
  source: string;
  amount: number;
}

interface FinanceState {
  expenses: Expense[];
  incomes: Income[];
  summary: Summary | null;
  isLoading: boolean;
  _loadingCount: number;
  fetchSummary: (month: string) => Promise<void>;
  fetchExpenses: (month?: string) => Promise<void>;
  fetchIncomes: (month?: string) => Promise<void>;
  createExpense: (data: CreateExpenseData) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  createIncome: (data: CreateIncomeData) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
}

/** Helpers to track parallel loading correctly */
function startLoading(set: (fn: (s: FinanceState) => Partial<FinanceState>) => void) {
  set((s) => ({ _loadingCount: s._loadingCount + 1, isLoading: true }));
}
function stopLoading(set: (fn: (s: FinanceState) => Partial<FinanceState>) => void) {
  set((s) => {
    const next = Math.max(0, s._loadingCount - 1);
    return { _loadingCount: next, isLoading: next > 0 };
  });
}

export const useFinanceStore = create<FinanceState>((set) => ({
  expenses: [],
  incomes: [],
  summary: null,
  isLoading: false,
  _loadingCount: 0,

  fetchSummary: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    startLoading(set);
    try {
      const summary = await api.get<Summary>(`/finance/summary/${month}`, token);
      set({ summary });
      persistStoreData('finance_summary', summary).catch(() => {});
    } catch {
      // Summary fetch failed silently
    } finally {
      stopLoading(set);
    }
  },

  fetchExpenses: async (month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    startLoading(set);
    try {
      const query = month ? `?month=${month}` : '';
      const expenses = await api.get<Expense[]>(`/finance/expenses${query}`, token);
      set({ expenses });
      persistStoreData('finance_expenses', expenses).catch(() => {});
    } catch {
      // Expenses fetch failed silently
    } finally {
      stopLoading(set);
    }
  },

  fetchIncomes: async (month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    startLoading(set);
    try {
      const query = month ? `?month=${month}` : '';
      const incomes = await api.get<Income[]>(`/finance/incomes${query}`, token);
      set({ incomes });
    } catch {
      // Incomes fetch failed silently
    } finally {
      stopLoading(set);
    }
  },

  createExpense: async (data: CreateExpenseData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const expense = await api.post<Expense>('/finance/expenses', data, token);
      set((state) => ({ expenses: [expense, ...state.expenses] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при добавлении расхода';
      throw new Error(msg);
    }
  },

  deleteExpense: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/finance/expenses/${id}`, token);
      set((state) => ({
        expenses: state.expenses.filter((e) => e.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении расхода';
      throw new Error(msg);
    }
  },

  createIncome: async (data: CreateIncomeData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const income = await api.post<Income>('/finance/incomes', data, token);
      set((state) => ({ incomes: [income, ...state.incomes] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при добавлении дохода';
      throw new Error(msg);
    }
  },

  deleteIncome: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/finance/incomes/${id}`, token);
      set((state) => ({
        incomes: state.incomes.filter((i) => i.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении дохода';
      throw new Error(msg);
    }
  },
}));
