import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import { isFriendship, type Friendship } from '@/services/friendship';
import type { Surface } from '@/services/room-geometry';
import {
  applyPlacements,
  defaultSpot,
  isRoomItemKey,
  placedItems,
  spotOf,
  type RoomSlot,
  type OwnedItem,
  type Placement,
  type RoomItem,
  type RoomVariant,
} from '@/services/room-catalog';

/**
 * Робот-эпик, Части 4–6: комната робота. Предметы покупаются за монеты
 * (POST /room/buy); мебель ставится КУДА УГОДНО на пол/стены (Berik
 * 2026-11-09: «каждый сам дизайнер») — точка на поверхности; отделка — в свою
 * ячейку. Убрал — в кладовку, вернуть бесплатно. Перестановки видны сразу (оптимистично),
 * на сервер (PUT /room { placements }) уходят строго по очереди; сбой —
 * перечитываем комнату с сервера (там правда).
 */

export type BuyResult = { ok: true; item: OwnedItem } | { ok: false; error: string };

interface RoomState {
  /** Все купленные предметы (в ячейках и в кладовке). */
  owned: OwnedItem[];
  /** То, что стоит в ячейках, с координатами — для рисунка комнаты. */
  items: RoomItem[];
  catalog: RoomVariant[];
  /** Баланс монет (null — ещё не загружен). */
  coins: number | null;
  /** Последнее начисление (+N) — всплывашка у счётчика. */
  coinGain: { amount: number; seq: number } | null;
  /** Робот-друг №4: уровень дружбы (null — ещё не загружен). */
  friendship: Friendship | null;
  fetchRoom: () => Promise<void>;
  /** Уровень дружбы; новый уровень робот скажет облачком (один раз). */
  fetchFriendship: () => Promise<void>;
  fetchCatalog: () => Promise<void>;
  fetchCoins: () => Promise<void>;
  buy: (variantKey: string) => Promise<BuyResult>;
  /** Отпустил предмет: точка на поверхности (доли). */
  moveItem: (id: string, surface: Surface, u: number, v: number) => void;
  /** Долгое нажатие → в кладовку. */
  storeItem: (id: string) => void;
  /** Из кладовки — на свободное привычное место (дальше двигай куда хочешь). */
  placeFromStorage: (id: string) => boolean;
  /** Выход из аккаунта: чужая комната не должна достаться следующему юзеру. */
  reset: () => void;
}

const sanitize = (rows: OwnedItem[]): OwnedItem[] => rows.filter((r) => isRoomItemKey(r.itemKey));
const withOwned = (owned: OwnedItem[]) => ({ owned, items: placedItems(owned) });

let queue: Promise<unknown> = Promise.resolve();
let gainSeq = 0;
/**
 * Порядок ответов. rev растёт на каждую локальную правку (перестановка,
 * покупка) и на выход из аккаунта: ответ GET /room, начатый до правки, уже
 * устарел — не применяем (иначе предмет «отпрыгивает» назад). pending — сколько
 * перестановок ещё в очереди: ответ PUT применяем, только если он последний.
 */
let rev = 0;
let pending = 0;
/** Эпоха монет: ответ GET /coins, начатый до покупки/выхода, — старый баланс. */
let coinsEpoch = 0;
/** Сессия: выход из аккаунта — ответы прошлого юзера не применяем. */
let session = 0;

export const useRoomStore = create<RoomState>((set, get) => {
  /** Покупки и перестановки — строго по очереди (как их сделал юзер). */
  const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  const place = (placements: Placement[]) => {
    if (placements.length === 0) return;
    rev += 1;
    const myRev = rev;
    set(withOwned(applyPlacements(get().owned, placements)));
    const token = useAuthStore.getState().token;
    if (!token) return;
    pending += 1;
    void enqueue(async () => {
      try {
        const res = await api.put<{ items: OwnedItem[] }>('/room', { placements }, token, { queueOffline: false });
        pending -= 1;
        // Новее этой правки уже есть (или вышли из аккаунта) — не перетираем.
        if (pending === 0 && rev === myRev && Array.isArray(res?.items)) {
          set(withOwned(sanitize(res.items)));
        }
      } catch {
        pending -= 1;
        if (pending === 0) await get().fetchRoom();
      }
    });
  };

  return {
    owned: [],
    items: [],
    catalog: [],
    coins: null,
    coinGain: null,
    friendship: null,

    fetchRoom: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      const myRev = rev;
      try {
        const res = await api.get<{ items: OwnedItem[] }>('/room', token);
        if (myRev !== rev || pending > 0) return; // пока летел — были правки
        if (Array.isArray(res?.items)) set(withOwned(sanitize(res.items)));
      } catch {
        // Без сети — показываем то, что есть.
      }
    },

    fetchCatalog: async () => {
      const token = useAuthStore.getState().token;
      if (!token || get().catalog.length > 0) return;
      try {
        const res = await api.get<{ variants: RoomVariant[] }>('/room/catalog', token);
        if (Array.isArray(res?.variants)) set({ catalog: res.variants.filter((v) => isRoomItemKey(v.kind)) });
      } catch {
        // Магазин откроется, когда будет сеть.
      }
    },

    fetchFriendship: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      const mySession = session;
      try {
        const res = await api.get<unknown>('/robot/friendship', token);
        if (mySession !== session || !isFriendship(res)) return; // вышел из аккаунта, пока летел
        set({ friendship: res });
        if (res.levelUp) useChatStore.getState().showNudge(`friend-level-${res.level}`, res.levelUp);
      } catch {
        // Без сети — покажем в следующий раз.
      }
    },

    fetchCoins: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      const myEpoch = coinsEpoch;
      try {
        const res = await api.get<{ balance: number }>('/coins', token);
        if (myEpoch !== coinsEpoch || typeof res?.balance !== 'number') return; // начат до покупки — старый
        const prev = get().coins;
        // Всплывашка «+N» только за заработанное (не за первый показ и не за покупку).
        if (prev != null && res.balance > prev) {
          gainSeq += 1;
          set({ coins: res.balance, coinGain: { amount: res.balance - prev, seq: gainSeq } });
        } else {
          set({ coins: res.balance });
        }
      } catch {
        // Без сети — старый баланс.
      }
    },

    buy: (variantKey) => {
      const token = useAuthStore.getState().token;
      if (!token) return Promise.resolve({ ok: false, error: 'Нужно войти в аккаунт' } as BuyResult);
      rev += 1;
      coinsEpoch += 1;
      const mySession = session;
      return enqueue(async (): Promise<BuyResult> => {
        try {
          const res = await api.post<{ item: OwnedItem; balance: number }>('/room/buy', { variantKey }, token, {
            queueOffline: false,
          });
          if (!res?.item) return { ok: false, error: 'Нет связи — покупка не прошла. Попробуй позже.' };
          if (mySession !== session) return { ok: false, error: 'Нужно войти в аккаунт' };
          // Сервер мог убрать в кладовку то, что стояло в этой ячейке (или старую
          // отделку) — показываем сразу, правду потом сверим с сервером.
          // Новая отделка вытесняет старую в кладовку (мебель ничего не вытесняет).
          const fin = spotOf(res.item.itemKey) === 'finish' ? res.item.slot : null;
          const owned = get().owned.map((o) => (fin && o.slot === fin ? { ...o, slot: null } : o));
          set({ ...withOwned([...owned, res.item]), coins: res.balance });
          void get().fetchRoom();
          void get().fetchCoins(); // свежий кэш баланса (офлайн-кэш не покажет старый)
          return { ok: true, item: res.item };
        } catch (err) {
          // Таймаут/обрыв: сервер мог успеть списать — сверяемся.
          if ((err as { status?: number }).status === 0) {
            void get().fetchRoom();
            void get().fetchCoins();
          }
          const msg = err instanceof Error && err.message ? err.message : 'Не получилось купить';
          return { ok: false, error: msg };
        }
      });
    },

    moveItem: (id, surface, u, v) => place([{ id, surface, x: Math.round(u * 1000) / 1000, y: Math.round(v * 1000) / 1000 }]),

    storeItem: (id) => {
      const me = get().owned.find((o) => o.id === id);
      if (!me) return;
      place([spotOf(me.itemKey) === 'finish' ? { id, slot: null } : { id, surface: null }]);
    },

    placeFromStorage: (id) => {
      const me = get().owned.find((o) => o.id === id);
      if (!me) return false;
      // Отделка (стены/пол): меняется с текущей — та уходит в кладовку.
      if (spotOf(me.itemKey) === 'finish') {
        const fin = `finish-${me.itemKey}` as RoomSlot;
        const cur = get().owned.find((o) => o.slot === fin);
        place([...(cur ? [{ id: cur.id, slot: null }] : []), { id, slot: fin }]);
        return true;
      }
      const spot = defaultSpot(get().owned, me.itemKey);
      if (!spot) return false;
      place([{ id, ...spot }]);
      return true;
    },

    reset: () => {
      // Ответы, летящие от прошлого юзера, больше не применятся (rev/эпоха).
      rev += 1;
      coinsEpoch += 1;
      session += 1;
      pending = 0;
      queue = Promise.resolve();
      set({ owned: [], items: [], coins: null, coinGain: null, friendship: null });
    },
  };
});
