import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Долги «Финансов» — серверные обязательства (Obligation, kind money).
 * Раньше экран держал долги в памяти и терял при выходе; голосом
 * «Ахмет должен мне 500 000» они писались в другое место и на экран не попадали.
 */
export interface Debt {
  id: string;
  personName: string;
  direction: 'i_owe' | 'owed_to_me';
  amount: number | null;
  dueDate: string | null;
  description: string;
}

interface DebtState {
  debts: Debt[];
  fetchDebts: () => Promise<void>;
  addDebt: (d: { personName: string; direction: Debt['direction']; amount: number; dueDate?: string | null }) => Promise<void>;
  /** Вернули / отдал — долг закрыт. */
  settleDebt: (id: string) => Promise<void>;
  /** Убрать (ошибся) — отмена, история на сервере остаётся. */
  removeDebt: (id: string) => Promise<void>;
}

const token = () => useAuthStore.getState().token;

export const useDebtStore = create<DebtState>((set) => ({
  debts: [],

  fetchDebts: async () => {
    if (!token()) return;
    const { obligations } = await api.get<{ obligations: Debt[] }>('/obligations', token());
    set({ debts: obligations });
  },

  addDebt: async (d) => {
    if (!token()) throw new Error('Войди в аккаунт.');
    const { obligation } = await api.post<{ obligation: Debt }>('/obligations', d, token());
    set((s) => ({ debts: [...s.debts, obligation] }));
  },

  settleDebt: async (id) => {
    await api.post(`/obligations/${id}/settle`, {}, token());
    set((s) => ({ debts: s.debts.filter((x) => x.id !== id) }));
  },

  removeDebt: async (id) => {
    await api.delete(`/obligations/${id}`, token());
    set((s) => ({ debts: s.debts.filter((x) => x.id !== id) }));
  },
}));

/** «31.12.2026», «2026-12-31» или пусто → ГГГГ-ММ-ДД / null; иначе — ошибка с подсказкой. */
export function parseDueDate(raw: string): { ok: true; date: string | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: true, date: null };
  let y: number, m: number, d: number;
  const ru = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ru) [d, m, y] = [Number(ru[1]), Number(ru[2]), Number(ru[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return { ok: false, error: 'Срок в виде ДД.ММ.ГГГГ, например 31.12.2026.' };
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return { ok: false, error: 'Такой даты нет.' };
  return { ok: true, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/** Денежная годовая цель (сумма задана) — для «Накоплений». Нет — null (экран честно скажет). */
export function pickMoneyGoal<G extends { area: string; target?: number | null; goalText: string; progress: number }>(
  goals: G[],
): G | null {
  const money = goals.filter((g) => g.area === 'finance' && (g.target ?? 0) > 0);
  if (money.length === 0) return null;
  return money.reduce((a, b) => ((b.target ?? 0) > (a.target ?? 0) ? b : a));
}
