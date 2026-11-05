import { useDealStore } from '@/stores/deal-store';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import type { Deal, PlanStatus } from '@/services/deals';

// Глобальный мок api (setup.ts) без ApiError — берём настоящий класс, чтобы проверять 404/409/422.
jest.mock('@/services/api', () => {
  const actual = jest.requireActual('@/services/api');
  return { ApiError: actual.ApiError, api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } };
});
const mocked = api as jest.Mocked<typeof api>;

const deal: Deal = {
  id: 'd1',
  personEntityId: null,
  personName: 'Ахмет',
  title: 'оборудование',
  amount: 2_000_000,
  currency: '₸',
  stage: 'new',
  stageChangedAt: '',
  nextStepAt: null,
  nextStepText: null,
  lastActivityAt: '',
  closedAt: null,
  lostReason: null,
  wonIncomeId: null,
  createdAt: '',
  updatedAt: '',
};
const plan: PlanStatus = {
  plan: 10_000_000, won: 4_000_000, open: 2_000_000, noAmount: 0,
  pace: { behind: false, expected: 3_000_000, gap: 6_000_000, coverable: false }, covering: [],
};

beforeEach(() => {
  jest.resetAllMocks();
  // resetAllMocks обнуляет и глобальный мок auth-store — возвращаем токен.
  (useAuthStore.getState as jest.Mock).mockReturnValue({ token: 'test-token-123' });
  useDealStore.setState({ deals: [], closed: [], plan: null, available: true, isLoading: false, revision: 0 });
});

describe('deal-store', () => {
  it('fetch: открытые сделки и план месяца', async () => {
    mocked.get.mockImplementation(async (url: string) => (url.startsWith('/deals') ? { deals: [deal] } : { plan }) as never);
    await useDealStore.getState().fetch();
    expect(mocked.get).toHaveBeenCalledWith('/deals?status=open', 'test-token-123');
    expect(mocked.get).toHaveBeenCalledWith('/sales-plan', 'test-token-123');
    expect(useDealStore.getState().deals).toHaveLength(1);
    expect(useDealStore.getState().plan?.plan).toBe(10_000_000);
    expect(useDealStore.getState().available).toBe(true);
  });

  it('404 (флаг выключен) → инструмент недоступен', async () => {
    mocked.get.mockRejectedValue(new ApiError(404, 'Не найдено'));
    await useDealStore.getState().fetch();
    expect(useDealStore.getState().available).toBe(false);
  });

  it('сеть упала → инструмент не прячем, сделки не теряем', async () => {
    useDealStore.setState({ deals: [deal] });
    mocked.get.mockRejectedValue(new ApiError(0, 'Нет интернета'));
    await useDealStore.getState().fetch();
    expect(useDealStore.getState().available).toBe(true);
    expect(useDealStore.getState().deals).toHaveLength(1);
  });

  it('план не загрузился — сделки всё равно показываем', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/deals')) return { deals: [deal] } as never;
      throw new ApiError(0, 'сеть');
    });
    await useDealStore.getState().fetch();
    expect(useDealStore.getState().deals).toHaveLength(1);
  });

  it('смена стадии оптимистично, ошибка — откат', async () => {
    useDealStore.setState({ deals: [deal] });
    mocked.put.mockRejectedValueOnce(new ApiError(0, 'сеть'));
    await expect(useDealStore.getState().moveStage('d1', 'talks')).rejects.toThrow();
    expect(useDealStore.getState().deals[0].stage).toBe('new');
  });

  it('смена стадии не уходит в офлайн-очередь (иначе сервер вернёт {} и откат не сработает)', async () => {
    useDealStore.setState({ deals: [deal] });
    mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'talks' }, step: null, incomeOffer: false } as never);
    mocked.get.mockResolvedValueOnce({ plan } as never);
    await useDealStore.getState().moveStage('d1', 'talks');
    expect(mocked.put).toHaveBeenCalledWith('/deals/d1', { stage: 'talks' }, 'test-token-123', { queueOffline: false });
    expect(useDealStore.getState().deals[0].stage).toBe('talks');
  });

  it('won → сделка уходит из открытых, приходит предложение дохода с суммой сервера', async () => {
    useDealStore.setState({ deals: [deal] });
    mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'won', amount: 2_345_678 }, step: null, incomeOffer: true } as never);
    mocked.get.mockResolvedValueOnce({ plan } as never);
    const r = await useDealStore.getState().moveStage('d1', 'won');
    expect(r.incomeOffer).toBe(true);
    expect(r.deal.amount).toBe(2_345_678);
    expect(useDealStore.getState().deals).toHaveLength(0);
    expect(useDealStore.getState().plan).toEqual(plan);
  });

  it('проиграна — причина уходит на сервер', async () => {
    useDealStore.setState({ deals: [deal] });
    mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'lost' }, step: null, incomeOffer: false } as never);
    mocked.get.mockResolvedValueOnce({ plan: null } as never);
    await useDealStore.getState().moveStage('d1', 'lost', 'дорого');
    expect(mocked.put).toHaveBeenCalledWith('/deals/d1', { stage: 'lost', lostReason: 'дорого' }, 'test-token-123', { queueOffline: false });
  });

  it('доход записан', async () => {
    mocked.post.mockResolvedValueOnce({ ok: true, already: false, amount: 2_000_000 } as never);
    const r = await useDealStore.getState().recordIncome('d1');
    expect(r).toEqual({ kind: 'recorded', already: false, amount: 2_000_000 });
    expect(mocked.post).toHaveBeenCalledWith('/deals/d1/income', {}, 'test-token-123', { queueOffline: false });
  });

  it('409 possible_duplicate → переспрос с текстом сервера; force=true пишет', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(409, 'Похоже, доход 2 000 000 ₸ от Ахмета уже записан 05.11. Записать ещё раз?'));
    const r = await useDealStore.getState().recordIncome('d1');
    expect(r).toEqual({ kind: 'duplicate', message: 'Похоже, доход 2 000 000 ₸ от Ахмета уже записан 05.11. Записать ещё раз?' });
    mocked.post.mockResolvedValueOnce({ ok: true, already: false, amount: 2_000_000 } as never);
    await useDealStore.getState().recordIncome('d1', true);
    expect(mocked.post).toHaveBeenLastCalledWith('/deals/d1/income?force=true', {}, 'test-token-123', { queueOffline: false });
  });

  it('422 (нет суммы / не выиграна) → отказ с текстом сервера', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(422, 'У сделки нет суммы'));
    expect(await useDealStore.getState().recordIncome('d1')).toEqual({ kind: 'refused', message: 'У сделки нет суммы' });
  });

  it('новая сделка руками: пустые поля не шлём, список перечитываем', async () => {
    mocked.post.mockResolvedValueOnce({ deal, step: null, taggedClient: true, incomeOffer: false } as never);
    mocked.get.mockImplementation(async (url: string) => (url.startsWith('/deals') ? { deals: [deal] } : { plan: null }) as never);
    await useDealStore.getState().create({ personName: ' Ахмет ', title: '', amount: null });
    expect(mocked.post).toHaveBeenCalledWith('/deals', { personName: 'Ахмет' }, 'test-token-123', { queueOffline: false });
    expect(useDealStore.getState().deals).toHaveLength(1);
  });

  it('план месяца: PUT /sales-plan → новый статус', async () => {
    mocked.put.mockResolvedValueOnce({ plan } as never);
    await useDealStore.getState().setPlan(10_000_000);
    expect(mocked.put).toHaveBeenCalledWith('/sales-plan', { amount: 10_000_000 }, 'test-token-123', { queueOffline: false });
    expect(useDealStore.getState().plan).toEqual(plan);
  });

  it('закрытые грузятся отдельно', async () => {
    mocked.get.mockResolvedValueOnce({ deals: [{ ...deal, stage: 'won' }] } as never);
    await useDealStore.getState().fetchClosed();
    expect(mocked.get).toHaveBeenCalledWith('/deals?status=closed', 'test-token-123');
    expect(useDealStore.getState().closed).toHaveLength(1);
  });

  describe('revision — сделки поменялись руками (робот-объяснение устарело)', () => {
    const rev = () => useDealStore.getState().revision;

    it('смена стадии: успех → +1, ошибка (откат) → без изменений', async () => {
      useDealStore.setState({ deals: [deal] });
      mocked.put.mockRejectedValueOnce(new ApiError(0, 'сеть'));
      await expect(useDealStore.getState().moveStage('d1', 'talks')).rejects.toThrow();
      expect(rev()).toBe(0);
      mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'won' }, step: null, incomeOffer: true } as never);
      mocked.get.mockResolvedValueOnce({ plan } as never);
      await useDealStore.getState().moveStage('d1', 'won');
      expect(rev()).toBe(1);
    });

    it('правка суммы/шага, новая сделка, план → +1 на каждую', async () => {
      useDealStore.setState({ deals: [deal] });
      mocked.put.mockResolvedValueOnce({ deal: { ...deal, amount: 3_000_000 }, step: null, incomeOffer: false } as never);
      mocked.get.mockResolvedValue({ plan } as never);
      await useDealStore.getState().update('d1', { amount: 3_000_000 });
      expect(rev()).toBe(1);
      mocked.post.mockResolvedValueOnce({ deal: { ...deal, id: 'd2' }, step: null, taggedClient: true, incomeOffer: false } as never);
      await useDealStore.getState().create({ personName: 'Серик' });
      expect(rev()).toBe(2);
      mocked.put.mockResolvedValueOnce({ plan } as never);
      await useDealStore.getState().setPlan(10_000_000);
      expect(rev()).toBe(3);
    });

    it('доход: записан → +1; переспрос 409 / отказ 422 → без изменений', async () => {
      mocked.get.mockResolvedValue({ deals: [] } as never);
      mocked.post.mockRejectedValueOnce(new ApiError(409, 'дубль'));
      await useDealStore.getState().recordIncome('d1');
      mocked.post.mockRejectedValueOnce(new ApiError(422, 'нет суммы'));
      await useDealStore.getState().recordIncome('d1');
      expect(rev()).toBe(0);
      mocked.post.mockResolvedValueOnce({ ok: true, already: false, amount: 2_000_000 } as never);
      await useDealStore.getState().recordIncome('d1', true);
      expect(rev()).toBe(1);
      mocked.post.mockResolvedValueOnce({ ok: true, already: true, amount: 2_000_000 } as never);
      await useDealStore.getState().recordIncome('d1');
      expect(rev()).toBe(1); // «уже был записан» — ничего не поменялось
    });
  });
});
