import { create } from 'zustand';

/** «Показать подсказки в комнате ещё раз» из «Как пользоваться»: комната ловит счётчик. */
interface RoomIntroState {
  request: number;
  ask: () => void;
}

export const useRoomIntroStore = create<RoomIntroState>((set) => ({
  request: 0,
  ask: () => set((s) => ({ request: s.request + 1 })),
}));
