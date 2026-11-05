import { useDealStore } from '@/stores/deal-store';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';
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
  useDealStore.setState({
    deals: [], closed: [], plan: null, available: true, isLoading: false, revision: 0,
    loaded: false, loadError: false, closedLoaded: false, closedError: false, planKnown: false,
  });
  storage.remove('deals_available');
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

  describe('available — не мигать инструментом и не тащить чужие сделки', () => {
    it('ответ сервера запоминаем: 200 → true, 404 → false (переживает перезапуск)', async () => {
      mocked.get.mockResolvedValue({ deals: [], plan: null } as never);
      await useDealStore.getState().fetch();
      expect(storage.getString('deals_available')).toBe('true');
      mocked.get.mockRejectedValue(new ApiError(404, 'Не найдено'));
      await useDealStore.getState().fetch();
      expect(storage.getString('deals_available')).toBe('false');
    });

    it('не знаем (null) → до ответа берём запомненное', async () => {
      storage.set('deals_available', 'false');
      useDealStore.setState({ available: null });
      let release: (v: unknown) => void = () => undefined;
      const answer = new Promise((r) => { release = r; });
      mocked.get.mockImplementation(() => answer as never);
      const p = useDealStore.getState().fetch();
      expect(useDealStore.getState().available).toBe(false);
      release({ deals: [], plan: null });
      await p;
      expect(useDealStore.getState().available).toBe(true);
    });

    it('reset (выход/удаление аккаунта): сделки, план и запомненное — прочь, available неизвестно', () => {
      storage.set('deals_available', 'true');
      useDealStore.setState({ deals: [deal], closed: [deal], plan, available: true, revision: 5 });
      useDealStore.getState().reset();
      const st = useDealStore.getState();
      expect(st.deals).toEqual([]);
      expect(st.closed).toEqual([]);
      expect(st.plan).toBeNull();
      expect(st.available).toBeNull();
      expect(storage.getString('deals_available')).toBeUndefined();
    });
  });

  describe('честные состояния загрузки', () => {
    it('сеть упала → loadError; потом удалось → loaded, ошибки нет', async () => {
      mocked.get.mockRejectedValue(new ApiError(0, 'Нет интернета'));
      await useDealStore.getState().fetch();
      expect(useDealStore.getState().loadError).toBe(true);
      expect(useDealStore.getState().loaded).toBe(false);
      mocked.get.mockImplementation(async (url: string) => (url.startsWith('/deals') ? { deals: [deal] } : { plan: null }) as never);
      await useDealStore.getState().fetch();
      expect(useDealStore.getState().loadError).toBe(false);
      expect(useDealStore.getState().loaded).toBe(true);
    });

    it('план: «не задан» (plan:null с сервера) ≠ «не знаем» (запрос упал)', async () => {
      mocked.get.mockImplementation(async (url: string) => {
        if (url.startsWith('/deals')) return { deals: [] } as never;
        throw new ApiError(0, 'сеть');
      });
      await useDealStore.getState().fetch();
      expect(useDealStore.getState().planKnown).toBe(false);
      mocked.get.mockImplementation(async (url: string) => (url.startsWith('/deals') ? { deals: [] } : { plan: null }) as never);
      await useDealStore.getState().fetch();
      expect(useDealStore.getState().planKnown).toBe(true);
      expect(useDealStore.getState().plan).toBeNull();
    });

    it('закрытые: ошибка → closedError (не «за 90 дней нет»); успех → closedLoaded', async () => {
      mocked.get.mockRejectedValueOnce(new ApiError(0, 'сеть'));
      await useDealStore.getState().fetchClosed();
      expect(useDealStore.getState().closedError).toBe(true);
      expect(useDealStore.getState().closedLoaded).toBe(false);
      mocked.get.mockResolvedValueOnce({ deals: [] } as never);
      await useDealStore.getState().fetchClosed();
      expect(useDealStore.getState().closedError).toBe(false);
      expect(useDealStore.getState().closedLoaded).toBe(true);
    });

    it('задал план руками → план известен', async () => {
      mocked.put.mockResolvedValueOnce({ plan } as never);
      await useDealStore.getState().setPlan(10_000_000);
      expect(useDealStore.getState().planKnown).toBe(true);
    });

    it('reset сбрасывает и состояния загрузки', () => {
      useDealStore.setState({ loaded: true, loadError: true, closedLoaded: true, closedError: true, planKnown: true });
      useDealStore.getState().reset();
      const st = useDealStore.getState();
      expect([st.loaded, st.loadError, st.closedLoaded, st.closedError, st.planKnown]).toEqual([false, false, false, false, false]);
    });
  });

  describe('гонки: старый fetch не затирает свежую правку', () => {
    const deferred = <T,>() => {
      let resolve: (v: T) => void = () => undefined;
      let reject: (e: unknown) => void = () => undefined;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };

    it('fetch ушёл до смены стадии, вернулся после — устаревший список не применяем', async () => {
      useDealStore.setState({ deals: [deal] });
      const slow = deferred<unknown>();
      mocked.get.mockImplementation((url: string) => (url.startsWith('/deals') ? slow.promise : Promise.resolve({ plan })) as never);
      const f = useDealStore.getState().fetch();
      mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'talks' }, step: null, incomeOffer: false } as never);
      await useDealStore.getState().moveStage('d1', 'talks');
      slow.resolve({ deals: [deal] }); // снимок сервера ДО смены стадии
      await f;
      expect(useDealStore.getState().deals[0].stage).toBe('talks');
      expect(useDealStore.getState().isLoading).toBe(false);
    });

    it('откат возвращает только свою сделку, чужую свежую правку не трогает', async () => {
      const d2: Deal = { ...deal, id: 'd2', personName: 'Серик', amount: 1_000_000 };
      useDealStore.setState({ deals: [deal, d2] });
      const slowPut = deferred<unknown>();
      mocked.put.mockImplementationOnce(() => slowPut.promise as never);
      const move = useDealStore.getState().moveStage('d1', 'talks');
      mocked.put.mockResolvedValueOnce({ deal: { ...d2, amount: 5_000_000 }, step: null, incomeOffer: false } as never);
      mocked.get.mockResolvedValue({ plan } as never);
      await useDealStore.getState().update('d2', { amount: 5_000_000 });
      slowPut.reject(new ApiError(0, 'сеть'));
      await expect(move).rejects.toThrow();
      const st = useDealStore.getState();
      expect(st.deals.find((d) => d.id === 'd1')?.stage).toBe('new');
      expect(st.deals.find((d) => d.id === 'd2')?.amount).toBe(5_000_000);
    });

    it('выход во время загрузки: сделки прошлого аккаунта не возвращаются', async () => {
      const slow = deferred<unknown>();
      mocked.get.mockImplementation(() => slow.promise as never);
      const f = useDealStore.getState().fetch();
      useDealStore.getState().reset();
      slow.resolve({ deals: [deal], plan });
      await f;
      expect(useDealStore.getState().deals).toEqual([]);
      expect(useDealStore.getState().plan).toBeNull();
    });

    it('закрытые: старый ответ после выигрыша сделки не затирает её', async () => {
      useDealStore.setState({ deals: [deal], closed: [] });
      const slow = deferred<unknown>();
      mocked.get.mockImplementation((url: string) => (url.includes('closed') ? slow.promise : Promise.resolve({ plan })) as never);
      const f = useDealStore.getState().fetchClosed();
      mocked.put.mockResolvedValueOnce({ deal: { ...deal, stage: 'won' }, step: null, incomeOffer: true } as never);
      await useDealStore.getState().moveStage('d1', 'won');
      slow.resolve({ deals: [] });
      await f;
      expect(useDealStore.getState().closed.map((d) => d.id)).toEqual(['d1']);
    });
  });
});
