import { create } from 'zustand';

/**
 * Перегруз дня: сигнал «график сдвинут» (после «Подтвердить» на предложение
 * робота). Экраны задач/календаря/сегодня держат revision в зависимостях
 * загрузки — и перечитывают свои данные с теми же параметрами.
 */
interface ScheduleState {
  revision: number;
  bump: () => void;
}

export const useScheduleStore = create<ScheduleState>((set) => ({
  revision: 0,
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));

/** Предложение сервера после сохранения задачи/встречи (см. reschedule.ts). */
export interface RescheduleProposal {
  text: string;
  /** true — ждёт «Подтвердить» (лежит в PendingAction на сервере). */
  staged: boolean;
}

export const RESCHEDULE_ACTION = 'apply_reschedule';
