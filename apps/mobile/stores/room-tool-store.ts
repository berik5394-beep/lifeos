import { create } from 'zustand';
import { isToolKey, type ToolKey } from '@/services/room-tools';

/**
 * Какой инструмент показать. Дом (экран инструментов ↔ комната) подписан на
 * seq: переходит на экран инструментов и открывает вкладку. Сюда приходят
 * запросы из пушей, голоса, ответов мозга (openPanel) и тапа по мебели.
 */
interface RoomToolState {
  /** Запрос на инструмент; комната забирает его (take) и обнуляет. */
  requested: ToolKey | null;
  /** Счётчик запросов — повторный запрос того же инструмента тоже срабатывает. */
  seq: number;
  openTool: (tool: string | null | undefined) => boolean;
  /** Просто перейти на экран инструментов (кнопка «Инструменты» в комнате). */
  focusTools: () => void;
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
  focusTools: () => set((s) => ({ requested: null, seq: s.seq + 1 })),
  take: () => {
    const t = get().requested;
    if (t) set({ requested: null });
    return t;
  },
}));
