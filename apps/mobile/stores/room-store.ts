import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import {
  ROOM_MAX_ITEMS,
  clampToRoom,
  isRoomItemKey,
  type RoomItem,
  type RoomItemKey,
} from '@/services/room-catalog';

/**
 * Робот-эпик, Часть 4: расстановка мебели в комнате робота. Правки сразу
 * видны локально; на сервер (PUT /room — заменяет целиком) уходят с задержкой,
 * чтобы перетаскивание не слало запрос на каждый кадр. Сохранения идут строго
 * по очереди (новое ждёт летящее — порядок на сервере = порядок правок).
 * Сбой сети — правки остаются (dirty) и уходят при следующем изменении или
 * при следующем открытии комнаты (fetchRoom).
 */
export const ROOM_SAVE_DELAY_MS = 600;

interface RoomState {
  items: RoomItem[];
  /** Есть несохранённые на сервере правки. */
  dirty: boolean;
  fetchRoom: () => Promise<void>;
  /** false — комната заполнена (лимит ROOM_MAX_ITEMS). */
  addItem: (key: RoomItemKey) => boolean;
  moveItem: (id: string, x: number, y: number) => void;
  removeItem: (id: string) => void;
  /** Выход из аккаунта: чужая комната не должна достаться следующему юзеру. */
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let localSeq = 0;

export const useRoomStore = create<RoomState>((set, get) => {
  const putOnce = async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const snapshot = get().items;
    try {
      await api.put('/room', { items: snapshot.map(({ itemKey, x, y }) => ({ itemKey, x, y })) }, token);
      // Пока запрос летел, юзер мог подвинуть ещё — тогда остаёмся dirty.
      if (get().items === snapshot) set({ dirty: false });
    } catch {
      // Офлайн/сбой: правки остаются локально (dirty), повтор позже.
    }
  };

  const save = async () => {
    saveTimer = null;
    // Строго по очереди: дождаться летящего, потом отправить свежий снимок.
    while (inFlight) await inFlight;
    if (!get().dirty) return;
    inFlight = putOnce().finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  const schedule = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, ROOM_SAVE_DELAY_MS);
  };

  const change = (items: RoomItem[]) => {
    set({ items, dirty: true });
    schedule();
  };

  return {
    items: [],
    dirty: false,

    fetchRoom: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      try {
        const res = await api.get<{ items: RoomItem[] }>('/room', token);
        // Несохранённые локальные правки важнее серверной копии — дошлём их.
        if (get().dirty) {
          schedule();
          return;
        }
        set({ items: res.items.filter((i) => isRoomItemKey(i.itemKey)) });
      } catch {
        // Без сети — показываем то, что есть.
      }
    },

    addItem: (key) => {
      const { items } = get();
      if (items.length >= ROOM_MAX_ITEMS) return false;
      localSeq += 1;
      // Чуть в стороне от центра, чтобы новые предметы не ложились стопкой.
      const jitter = () => (Math.random() - 0.5) * 0.2;
      const pos = clampToRoom(0.5 + jitter(), 0.5 + jitter());
      change([...items, { id: `local-${Date.now()}-${localSeq}`, itemKey: key, ...pos }]);
      return true;
    },

    moveItem: (id, x, y) => {
      const pos = clampToRoom(x, y);
      change(get().items.map((i) => (i.id === id ? { ...i, ...pos } : i)));
    },

    removeItem: (id) => {
      change(get().items.filter((i) => i.id !== id));
    },

    reset: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      set({ items: [], dirty: false });
    },
  };
});
