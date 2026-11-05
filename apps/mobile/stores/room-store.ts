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
 * чтобы перетаскивание не слало запрос на каждый кадр. Сбой сети — правки
 * остаются (dirty), уйдут при следующем изменении.
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
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let localSeq = 0;

export const useRoomStore = create<RoomState>((set, get) => {
  const save = async () => {
    saveTimer = null;
    const token = useAuthStore.getState().token;
    if (!token) return;
    const snapshot = get().items;
    try {
      await api.put('/room', { items: snapshot.map(({ itemKey, x, y }) => ({ itemKey, x, y })) }, token);
      // Пока запрос летел, юзер мог подвинуть ещё — тогда остаёмся dirty.
      if (get().items === snapshot) set({ dirty: false });
    } catch {
      // Офлайн/сбой: правки остаются локально, повтор при следующем изменении.
    }
  };

  const change = (items: RoomItem[]) => {
    set({ items, dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, ROOM_SAVE_DELAY_MS);
  };

  return {
    items: [],
    dirty: false,

    fetchRoom: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      try {
        const res = await api.get<{ items: RoomItem[] }>('/room', token);
        // Несохранённые локальные правки важнее серверной копии.
        if (get().dirty) return;
        set({ items: res.items.filter((i) => isRoomItemKey(i.itemKey)) });
      } catch {
        // Без сети — показываем то, что есть.
      }
    },

    addItem: (key) => {
      const { items } = get();
      if (items.length >= ROOM_MAX_ITEMS) return false;
      localSeq += 1;
      change([...items, { id: `local-${Date.now()}-${localSeq}`, itemKey: key, x: 0.5, y: 0.5 }]);
      return true;
    },

    moveItem: (id, x, y) => {
      const pos = clampToRoom(x, y);
      change(get().items.map((i) => (i.id === id ? { ...i, ...pos } : i)));
    },

    removeItem: (id) => {
      change(get().items.filter((i) => i.id !== id));
    },
  };
});
