import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

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
  fetchSummary: (month: string) => Promise<void>;
  fetchExpenses: (month?: string) => Promise<void>;
  fetchIncomes: (month?: string) => Promise<void>;
  createExpense: (data: CreateExpenseData) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  createIncome: (data: CreateIncomeData) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set) => ({
  expenses: [],
  incomes: [],
  summary: null,
  isLoading: false,

  fetchSummary: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const summary = await api.get<Summary>(`/finance/summary/${month}`, token);
      set({ summary, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchExpenses: async (month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const query = month ? `?month=${month}` : '';
      const expenses = await api.get<Expense[]>(`/finance/expenses${query}`, token);
      set({ expenses, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchIncomes: async (month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const query = month ? `?month=${month}` : '';
      const incomes = await api.get<Income[]>(`/finance/incomes${query}`, token);
      set({ incomes, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createExpense: async (data: CreateExpenseData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const expense = await api.post<Expense>('/finance/expenses', data, token);
    set((state) => ({ expenses: [expense, ...state.expenses] }));
  },

  deleteExpense: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/finance/expenses/${id}`, token);
    set((state) => ({
      expenses: state.expenses.filter((e) => e.id !== id),
    }));
  },

  createIncome: async (data: CreateIncomeData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const income = await api.post<Income>('/finance/incomes', data, token);
    set((state) => ({ incomes: [income, ...state.incomes] }));
  },

  deleteIncome: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/finance/incomes/${id}`, token);
    set((state) => ({
      incomes: state.incomes.filter((i) => i.id !== id),
    }));
  },
}));
