import { create } from 'zustand';
import { isToolKey, type ToolKey } from '@/services/room-tools';

/**
 * Робот-эпик, Часть 5: какой инструмент робот должен достать. Комната
 * подписана и проигрывает сцену «подошёл → достал → показал». Сюда же
 * приходят запросы из пушей, голоса и ответов мозга (openPanel) — вместо
 * navigate('Tasks').
 */
interface RoomToolState {
  /** Запрос на инструмент; комната забирает его (take) и обнуляет. */
  requested: ToolKey | null;
  /** Счётчик запросов — повторный запрос того же инструмента тоже срабатывает. */
  seq: number;
  openTool: (tool: string | null | undefined) => boolean;
  take: () => ToolKey | null;
}

export const useRoomToolStore = create<RoomToolState>((set, get) => ({
  requested: null,
  seq: 0,
  openTool: (tool) => {
    if (!isToolKey(tool)) return false;
    set((s) => ({ requested: tool, seq: s.seq + 1 }));
    return true;
  },
  take: () => {
    const t = get().requested;
    if (t) set({ requested: null });
    return t;
  },
}));
