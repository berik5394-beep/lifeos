import { api } from '@/services/api';
import { useDebtStore, parseDueDate, pickMoneyGoal } from '@/stores/debt-store';

const mocked = api as jest.Mocked<typeof api>;
beforeEach(() => {
  jest.clearAllMocks();
  useDebtStore.setState({ debts: [] });
});

describe('долги — с сервера, не из памяти экрана', () => {
  it('загрузка и добавление идут в /obligations', async () => {
    mocked.get.mockResolvedValueOnce({ obligations: [{ id: 'o1', personName: 'Ахмет', direction: 'owed_to_me', amount: 500000, dueDate: null, description: 'должен мне' }] });
    await useDebtStore.getState().fetchDebts();
    expect(useDebtStore.getState().debts.map((d) => d.personName)).toEqual(['Ахмет']);
    mocked.post.mockResolvedValueOnce({ obligation: { id: 'o2', personName: 'Банк', direction: 'i_owe', amount: 300000, dueDate: '2026-12-31', description: 'долг' } });
    await useDebtStore.getState().addDebt({ personName: 'Банк', direction: 'i_owe', amount: 300000, dueDate: '2026-12-31' });
    expect(mocked.post).toHaveBeenCalledWith('/obligations', { personName: 'Банк', direction: 'i_owe', amount: 300000, dueDate: '2026-12-31' }, 'test-token-123');
    expect(useDebtStore.getState().debts).toHaveLength(2);
  });

  it('«вернули» закрывает на сервере и убирает из списка', async () => {
    useDebtStore.setState({ debts: [{ id: 'o1', personName: 'X', direction: 'i_owe', amount: 1, dueDate: null, description: '' }] });
    mocked.post.mockResolvedValueOnce({});
    await useDebtStore.getState().settleDebt('o1');
    expect(mocked.post).toHaveBeenCalledWith('/obligations/o1/settle', {}, 'test-token-123');
    expect(useDebtStore.getState().debts).toEqual([]);
  });

  it('ошибка сервера — долг не пропадает', async () => {
    useDebtStore.setState({ debts: [{ id: 'o1', personName: 'X', direction: 'i_owe', amount: 1, dueDate: null, description: '' }] });
    mocked.delete.mockRejectedValueOnce(new Error('Ошибка сервера'));
    await expect(useDebtStore.getState().removeDebt('o1')).rejects.toThrow();
    expect(useDebtStore.getState().debts).toHaveLength(1);
  });
});

describe('срок и цель накоплений', () => {
  it('срок: ДД.ММ.ГГГГ и ГГГГ-ММ-ДД; пусто — без срока; 31.02 — ошибка', () => {
    expect(parseDueDate('31.12.2026')).toEqual({ ok: true, date: '2026-12-31' });
    expect(parseDueDate('2026-12-31')).toEqual({ ok: true, date: '2026-12-31' });
    expect(parseDueDate('')).toEqual({ ok: true, date: null });
    expect(parseDueDate('31.02.2026').ok).toBe(false);
    expect(parseDueDate('завтра').ok).toBe(false);
  });
  it('цель — только финансовая с суммой; самая крупная; нет — null (без выдуманных 500 000)', () => {
    const g = (area: string, target: number | null, goalText = 't') => ({ area, target, goalText, progress: 0 });
    expect(pickMoneyGoal([g('career', 9e9), g('finance', null)])).toBeNull();
    expect(pickMoneyGoal([g('finance', 1e6, 'Миллион'), g('finance', 2e5, 'Отпуск')])?.goalText).toBe('Миллион');
  });
});
