import { create } from 'zustand';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';
import { isOpenStage, type Deal, type DealStage, type DealWithEvents, type PlanStatus } from '@/services/deals';

/**
 * Сделки (спека 2026-11-05-deals, этап 2). Правки — только онлайн (queueOffline:false):
 * офлайн-очередь вернула бы `{}` вместо сделки, а деньги «потом без ведома» недопустимы.
 */
export type IncomeResult =
  | { kind: 'recorded'; already: boolean; amount: number }
  /** 409: похожий доход уже есть — переспросить и при «да» повторить с force. */
  | { kind: 'duplicate'; message: string }
  /** 422: нет суммы / сделка не выиграна. */
  | { kind: 'refused'; message: string };

export interface NewDealInput {
  personName: string;
  title?: string | null;
  amount?: number | null;
}

export interface DealPatch {
  amount?: number | null;
  nextStepDate?: string | null;
  nextStepText?: string | null;
  note?: string | null;
}

interface DealState {
  /** Открытые сделки. */
  deals: Deal[];
  /** Закрытые за 90 дней (грузятся по раскрытию «Закрытые»). */
  closed: Deal[];
  plan: PlanStatus | null;
  /**
   * false — сервер ответил 404 (функция выключена) → инструмента «Сделки» нет;
   * null — ещё не знаем (инструмент тоже прячем: не мигать). Последний ответ запоминаем.
   */
  available: boolean | null;
  isLoading: boolean;
  /** Открытые сделки хоть раз загрузились (до этого пустой список — не «сделок нет»). */
  loaded: boolean;
  /** Последняя загрузка открытых упала (сеть/сервер) — панель честно говорит и даёт «Повторить». */
  loadError: boolean;
  closedLoaded: boolean;
  closedError: boolean;
  /** Сервер ответил про план (plan:null = не задан). false — не знаем, «Задать план» не предлагаем. */
  planKnown: boolean;
  /**
   * Растёт на каждой правке сделок/плана из приложения (стадия, сумма, шаг, новая сделка,
   * план, записанный доход). Комната по нему прячет устаревшее объяснение робота.
   */
  revision: number;
  fetch: () => Promise<void>;
  fetchClosed: () => Promise<void>;
  fetchOne: (id: string) => Promise<DealWithEvents | null>;
  create: (input: NewDealInput) => Promise<Deal>;
  update: (id: string, patch: DealPatch) => Promise<{ deal: Deal; incomeOffer: boolean }>;
  moveStage: (id: string, stage: DealStage, lostReason?: string) => Promise<{ deal: Deal; incomeOffer: boolean }>;
  recordIncome: (id: string, force?: boolean) => Promise<IncomeResult>;
  setPlan: (amount: number) => Promise<void>;
  /** Выход / удаление аккаунта: следующий пользователь не увидит чужих сделок. */
  reset: () => void;
}

const ONLINE = { queueOffline: false } as const;
const token = () => useAuthStore.getState().token ?? undefined;
const is404 = (err: unknown) => err instanceof ApiError && err.status === 404;

const AVAILABLE_KEY = 'deals_available';
function rememberedAvailable(): boolean | null {
  const v = storage.getString(AVAILABLE_KEY);
  return v === 'true' ? true : v === 'false' ? false : null;
}
function rememberAvailable(v: boolean): void {
  storage.set(AVAILABLE_KEY, String(v));
}

type MutationReply = { deal: Deal; incomeOffer: boolean };

export const useDealStore = create<DealState>((set, get) => {
  /** Ответ сервера по сделке → открытые/закрытые списки. */
  const applyDeal = (deal: Deal) =>
    set((s) => {
      const others = s.deals.filter((d) => d.id !== deal.id);
      const closedOthers = s.closed.filter((d) => d.id !== deal.id);
      const revision = s.revision + 1;
      return isOpenStage(deal.stage)
        ? {
            deals: s.deals.some((d) => d.id === deal.id) ? s.deals.map((d) => (d.id === deal.id ? deal : d)) : [deal, ...others],
            closed: closedOthers,
            revision,
          }
        : { deals: others, closed: [deal, ...closedOthers], revision };
    });
  const bumpRevision = () => set((s) => ({ revision: s.revision + 1 }));

  const refreshPlan = async () => {
    try {
      const { plan } = await api.get<{ plan: PlanStatus | null }>('/sales-plan', token());
      set({ plan: plan ?? null, planKnown: true });
    } catch {
      // план — вторичен: оставляем прежний
    }
  };

  const initial = {
    deals: [] as Deal[],
    closed: [] as Deal[],
    plan: null,
    isLoading: false,
    revision: 0,
    loaded: false,
    loadError: false,
    closedLoaded: false,
    closedError: false,
    planKnown: false,
  };

  return {
    ...initial,
    // Хранилище на старте может быть ещё не загружено — fetch досеет запомненное.
    available: rememberedAvailable(),

    fetch: async () => {
      if (!token()) return;
      set((s) => ({ isLoading: true, ...(s.available === null ? { available: rememberedAvailable() } : {}) }));
      const [dealsRes, planRes] = await Promise.allSettled([
        api.get<{ deals: Deal[] }>('/deals?status=open', token()),
        api.get<{ plan: PlanStatus | null }>('/sales-plan', token()),
      ]);
      const planPart = planRes.status === 'fulfilled' ? { plan: planRes.value.plan ?? null, planKnown: true } : {};
      if (dealsRes.status === 'rejected') {
        const off = is404(dealsRes.reason);
        if (off) rememberAvailable(false);
        set({ isLoading: false, ...(off ? { available: false } : { loadError: true, ...planPart }) });
        return;
      }
      rememberAvailable(true);
      set({
        deals: dealsRes.value.deals ?? [],
        available: true,
        isLoading: false,
        loaded: true,
        loadError: false,
        ...planPart,
      });
    },

    fetchClosed: async () => {
      try {
        const { deals } = await api.get<{ deals: Deal[] }>('/deals?status=closed', token());
        set({ closed: deals ?? [], closedLoaded: true, closedError: false });
      } catch (err) {
        if (is404(err)) {
          rememberAvailable(false);
          set({ available: false });
        } else {
          set({ closedError: true });
        }
      }
    },

    fetchOne: async (id) => {
      try {
        const { deal } = await api.get<{ deal: DealWithEvents }>(`/deals/${id}`, token());
        return deal;
      } catch {
        return null;
      }
    },

    create: async (input) => {
      const title = input.title?.trim();
      const body = {
        personName: input.personName.trim(),
        ...(title ? { title } : {}),
        ...(input.amount != null ? { amount: input.amount } : {}),
      };
      const { deal } = await api.post<{ deal: Deal }>('/deals', body, token(), ONLINE);
      bumpRevision();
      await get().fetch();
      return deal;
    },

    update: async (id, patch) => {
      const r = await api.put<MutationReply>(`/deals/${id}`, patch, token(), ONLINE);
      applyDeal(r.deal);
      if (patch.amount !== undefined) await refreshPlan();
      return { deal: r.deal, incomeOffer: r.incomeOffer };
    },

    moveStage: async (id, stage, lostReason) => {
      const before = { deals: get().deals, closed: get().closed };
      set((s) => ({
        deals: s.deals.map((d) => (d.id === id ? { ...d, stage } : d)),
        closed: s.closed.map((d) => (d.id === id ? { ...d, stage } : d)),
      }));
      let r: MutationReply;
      try {
        r = await api.put<MutationReply>(`/deals/${id}`, { stage, ...(lostReason ? { lostReason } : {}) }, token(), ONLINE);
      } catch (err) {
        set(before);
        throw err;
      }
      applyDeal(r.deal);
      await refreshPlan();
      return { deal: r.deal, incomeOffer: r.incomeOffer };
    },

    recordIncome: async (id, force = false) => {
      try {
        const r = await api.post<{ ok: true; already: boolean; amount: number }>(
          `/deals/${id}/income${force ? '?force=true' : ''}`,
          {},
          token(),
          ONLINE,
        );
        // wonIncomeId сервер не отдаёт — перечитаем закрытые, чтобы кнопка «Записать доход» ушла.
        if (!r.already) bumpRevision();
        void get().fetchClosed();
        return { kind: 'recorded', already: r.already, amount: r.amount };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) return { kind: 'duplicate', message: err.message };
        if (err instanceof ApiError && err.status === 422) return { kind: 'refused', message: err.message };
        throw err;
      }
    },

    setPlan: async (amount) => {
      const { plan } = await api.put<{ plan: PlanStatus | null }>('/sales-plan', { amount }, token(), ONLINE);
      set((s) => ({ plan, planKnown: true, revision: s.revision + 1 }));
    },

    reset: () => {
      storage.remove(AVAILABLE_KEY);
      set({ ...initial, available: null });
    },
  };
});
