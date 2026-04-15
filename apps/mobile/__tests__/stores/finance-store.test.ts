import { api } from '@/services/api';
import { useFinanceStore } from '@/stores/finance-store';

const mockApi = api as jest.Mocked<typeof api>;

const MOCK_EXPENSE = {
  id: 'exp-1',
  userId: 'user-1',
  date: '2026-04-01',
  category: 'food',
  description: 'Обед',
  amount: 3000,
  createdAt: '2026-04-01T12:00:00Z',
};

const MOCK_EXPENSE_2 = {
  ...MOCK_EXPENSE,
  id: 'exp-2',
  description: 'Ужин',
  amount: 5000,
};

const MOCK_INCOME = {
  id: 'inc-1',
  userId: 'user-1',
  date: '2026-04-01',
  source: 'Зарплата',
  amount: 350000,
  createdAt: '2026-04-01T00:00:00Z',
};

const MOCK_SUMMARY = {
  totalExpenses: 8000,
  totalIncomes: 350000,
  balance: 342000,
  expenseCount: 2,
  incomeCount: 1,
  topCategories: [{ category: 'food', amount: 8000 }],
};

const INITIAL_STATE = {
  expenses: [],
  incomes: [],
  summary: null,
  isLoading: false,
  _loadingCount: 0,
};

beforeEach(() => {
  useFinanceStore.setState(INITIAL_STATE);
  jest.clearAllMocks();
});

describe('useFinanceStore', () => {
  it('has correct initial state', () => {
    const state = useFinanceStore.getState();
    expect(state.expenses).toEqual([]);
    expect(state.incomes).toEqual([]);
    expect(state.summary).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  describe('fetchSummary', () => {
    it('fetches and stores summary', async () => {
      mockApi.get.mockResolvedValueOnce(MOCK_SUMMARY);

      await useFinanceStore.getState().fetchSummary('2026-04');

      expect(mockApi.get).toHaveBeenCalledWith('/finance/summary/2026-04', 'test-token-123');
      expect(useFinanceStore.getState().summary).toEqual(MOCK_SUMMARY);
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void;
      const promise = new Promise((r) => { resolve = r; });
      mockApi.get.mockReturnValueOnce(promise as Promise<never>);

      const fetchPromise = useFinanceStore.getState().fetchSummary('2026-04');
      expect(useFinanceStore.getState().isLoading).toBe(true);

      resolve!(MOCK_SUMMARY);
      await fetchPromise;
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });

    it('handles API error gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network error'));

      await useFinanceStore.getState().fetchSummary('2026-04');

      expect(useFinanceStore.getState().summary).toBeNull();
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchExpenses', () => {
    it('fetches expenses with month param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_EXPENSE, MOCK_EXPENSE_2]);

      await useFinanceStore.getState().fetchExpenses('2026-04');

      expect(mockApi.get).toHaveBeenCalledWith('/finance/expenses?month=2026-04', 'test-token-123');
      expect(useFinanceStore.getState().expenses).toHaveLength(2);
    });

    it('fetches expenses without month param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_EXPENSE]);

      await useFinanceStore.getState().fetchExpenses();

      expect(mockApi.get).toHaveBeenCalledWith('/finance/expenses', 'test-token-123');
      expect(useFinanceStore.getState().expenses).toHaveLength(1);
    });

    it('handles error gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('fail'));

      await useFinanceStore.getState().fetchExpenses('2026-04');

      expect(useFinanceStore.getState().expenses).toEqual([]);
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchIncomes', () => {
    it('fetches incomes with month param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_INCOME]);

      await useFinanceStore.getState().fetchIncomes('2026-04');

      expect(mockApi.get).toHaveBeenCalledWith('/finance/incomes?month=2026-04', 'test-token-123');
      expect(useFinanceStore.getState().incomes).toHaveLength(1);
    });

    it('fetches incomes without month param', async () => {
      mockApi.get.mockResolvedValueOnce([]);

      await useFinanceStore.getState().fetchIncomes();

      expect(mockApi.get).toHaveBeenCalledWith('/finance/incomes', 'test-token-123');
    });
  });

  describe('createExpense', () => {
    it('adds expense to the list', async () => {
      mockApi.post.mockResolvedValueOnce(MOCK_EXPENSE);

      await useFinanceStore.getState().createExpense({
        date: '2026-04-01',
        category: 'food',
        description: 'Обед',
        amount: 3000,
      });

      expect(mockApi.post).toHaveBeenCalledWith(
        '/finance/expenses',
        { date: '2026-04-01', category: 'food', description: 'Обед', amount: 3000 },
        'test-token-123',
      );
      expect(useFinanceStore.getState().expenses).toHaveLength(1);
      expect(useFinanceStore.getState().expenses[0].id).toBe('exp-1');
    });

    it('prepends new expense to existing list', async () => {
      useFinanceStore.setState({ expenses: [MOCK_EXPENSE_2] });
      mockApi.post.mockResolvedValueOnce(MOCK_EXPENSE);

      await useFinanceStore.getState().createExpense({
        date: '2026-04-01',
        category: 'food',
        description: 'Обед',
        amount: 3000,
      });

      const expenses = useFinanceStore.getState().expenses;
      expect(expenses).toHaveLength(2);
      expect(expenses[0].id).toBe('exp-1'); // new one first
    });

    it('throws on API error', async () => {
      mockApi.post.mockRejectedValueOnce(new Error('Server error'));

      await expect(
        useFinanceStore.getState().createExpense({
          date: '2026-04-01',
          category: 'food',
          description: 'Обед',
          amount: 3000,
        }),
      ).rejects.toThrow('Server error');
    });
  });

  describe('createIncome', () => {
    it('adds income to the list', async () => {
      mockApi.post.mockResolvedValueOnce(MOCK_INCOME);

      await useFinanceStore.getState().createIncome({
        date: '2026-04-01',
        source: 'Зарплата',
        amount: 350000,
      });

      expect(useFinanceStore.getState().incomes).toHaveLength(1);
      expect(useFinanceStore.getState().incomes[0].source).toBe('Зарплата');
    });

    it('throws on API error', async () => {
      mockApi.post.mockRejectedValueOnce(new Error('Fail'));

      await expect(
        useFinanceStore.getState().createIncome({
          date: '2026-04-01',
          source: 'Зарплата',
          amount: 350000,
        }),
      ).rejects.toThrow('Fail');
    });
  });

  describe('deleteExpense', () => {
    it('removes expense from list', async () => {
      useFinanceStore.setState({ expenses: [MOCK_EXPENSE, MOCK_EXPENSE_2] });
      mockApi.delete.mockResolvedValueOnce(undefined);

      await useFinanceStore.getState().deleteExpense('exp-1');

      const expenses = useFinanceStore.getState().expenses;
      expect(expenses).toHaveLength(1);
      expect(expenses[0].id).toBe('exp-2');
    });
  });

  describe('deleteIncome', () => {
    it('removes income from list', async () => {
      useFinanceStore.setState({ incomes: [MOCK_INCOME] });
      mockApi.delete.mockResolvedValueOnce(undefined);

      await useFinanceStore.getState().deleteIncome('inc-1');

      expect(useFinanceStore.getState().incomes).toHaveLength(0);
    });
  });

  describe('reference-counted loading', () => {
    it('stays loading when multiple fetches overlap', async () => {
      let resolveSummary: (v: unknown) => void;
      let resolveExpenses: (v: unknown) => void;
      const summaryPromise = new Promise((r) => { resolveSummary = r; });
      const expensesPromise = new Promise((r) => { resolveExpenses = r; });

      mockApi.get.mockReturnValueOnce(summaryPromise as Promise<never>);
      mockApi.get.mockReturnValueOnce(expensesPromise as Promise<never>);

      const p1 = useFinanceStore.getState().fetchSummary('2026-04');
      const p2 = useFinanceStore.getState().fetchExpenses('2026-04');

      expect(useFinanceStore.getState().isLoading).toBe(true);
      expect(useFinanceStore.getState()._loadingCount).toBe(2);

      resolveSummary!(MOCK_SUMMARY);
      await p1;
      // Still loading because expenses fetch is pending
      expect(useFinanceStore.getState().isLoading).toBe(true);
      expect(useFinanceStore.getState()._loadingCount).toBe(1);

      resolveExpenses!([MOCK_EXPENSE]);
      await p2;
      expect(useFinanceStore.getState().isLoading).toBe(false);
      expect(useFinanceStore.getState()._loadingCount).toBe(0);
    });
  });
});
