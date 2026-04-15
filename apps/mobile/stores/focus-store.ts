import { create } from 'zustand';
import { storage } from '@/services/storage';

const STORAGE_KEY_FOCUS_TODAY = 'focus_minutes_today';
const STORAGE_KEY_FOCUS_DATE = 'focus_date';
const STORAGE_KEY_POMODORO = 'pomodoro_minutes';
const STORAGE_KEY_BREAK = 'break_minutes';

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function loadTodayMinutes(): number {
  const savedDate = storage.getString(STORAGE_KEY_FOCUS_DATE);
  if (savedDate !== getTodayString()) return 0;
  const saved = storage.getString(STORAGE_KEY_FOCUS_TODAY);
  const val = saved ? parseInt(saved, 10) : 0;
  return isNaN(val) ? 0 : val;
}

interface FocusState {
  activeTaskId: string | null;
  activeTaskTitle: string;
  pomodoroMinutes: number;
  breakMinutes: number;
  secondsRemaining: number;
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  sessionsCompleted: number;
  totalFocusMinutesToday: number;

  startFocus: (taskId: string, title: string) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  endFocus: () => void;
  tick: () => void;
  skipBreak: () => void;
  setPomodoroMinutes: (m: number) => void;
  setBreakMinutes: (m: number) => void;
  rehydrate: () => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  activeTaskId: null,
  activeTaskTitle: '',
  pomodoroMinutes: parseInt(storage.getString(STORAGE_KEY_POMODORO) || '25', 10) || 25,
  breakMinutes: parseInt(storage.getString(STORAGE_KEY_BREAK) || '5', 10) || 5,
  secondsRemaining: 0,
  isRunning: false,
  isPaused: false,
  isBreak: false,
  sessionsCompleted: 0,
  totalFocusMinutesToday: loadTodayMinutes(),

  startFocus: (taskId: string, title: string) => {
    const state = get();
    set({
      activeTaskId: taskId,
      activeTaskTitle: title,
      secondsRemaining: state.pomodoroMinutes * 60,
      isRunning: true,
      isPaused: false,
      isBreak: false,
    });
  },

  pauseFocus: () => {
    set({ isRunning: false, isPaused: true });
  },

  resumeFocus: () => {
    set({ isRunning: true, isPaused: false });
  },

  endFocus: () => {
    const state = get();
    // Save accumulated focus time if we were in a work session
    if (!state.isBreak && state.activeTaskId) {
      const elapsedSeconds = state.pomodoroMinutes * 60 - state.secondsRemaining;
      const elapsedMinutes = Math.floor(elapsedSeconds / 60);
      if (elapsedMinutes > 0) {
        const newTotal = state.totalFocusMinutesToday + elapsedMinutes;
        storage.set(STORAGE_KEY_FOCUS_TODAY, String(newTotal));
        storage.set(STORAGE_KEY_FOCUS_DATE, getTodayString());
        set({ totalFocusMinutesToday: newTotal });
      }
    }
    set({
      activeTaskId: null,
      activeTaskTitle: '',
      secondsRemaining: 0,
      isRunning: false,
      isPaused: false,
      isBreak: false,
    });
  },

  tick: () => {
    const state = get();
    if (!state.isRunning || state.secondsRemaining <= 0) return;

    const next = state.secondsRemaining - 1;
    if (next <= 0) {
      if (!state.isBreak) {
        // Work session complete -> start break
        const focusAdded = state.pomodoroMinutes;
        const newTotal = state.totalFocusMinutesToday + focusAdded;
        storage.set(STORAGE_KEY_FOCUS_TODAY, String(newTotal));
        storage.set(STORAGE_KEY_FOCUS_DATE, getTodayString());

        set({
          secondsRemaining: state.breakMinutes * 60,
          isBreak: true,
          isRunning: true,
          totalFocusMinutesToday: newTotal,
        });
      } else {
        // Break complete -> ready for next session
        set({
          secondsRemaining: 0,
          isRunning: false,
          isPaused: false,
          isBreak: false,
          sessionsCompleted: state.sessionsCompleted + 1,
        });
      }
    } else {
      set({ secondsRemaining: next });
    }
  },

  skipBreak: () => {
    const state = get();
    if (!state.isBreak) return;
    set({
      secondsRemaining: 0,
      isRunning: false,
      isPaused: false,
      isBreak: false,
      sessionsCompleted: state.sessionsCompleted + 1,
    });
  },

  setPomodoroMinutes: (m: number) => {
    const clamped = Math.max(1, Math.min(120, m));
    storage.set(STORAGE_KEY_POMODORO, String(clamped));
    set({ pomodoroMinutes: clamped });
  },

  setBreakMinutes: (m: number) => {
    const clamped = Math.max(1, Math.min(30, m));
    storage.set(STORAGE_KEY_BREAK, String(clamped));
    set({ breakMinutes: clamped });
  },

  rehydrate: () => {
    const pomodoroMinutes = parseInt(storage.getString(STORAGE_KEY_POMODORO) || '25', 10) || 25;
    const breakMinutes = parseInt(storage.getString(STORAGE_KEY_BREAK) || '5', 10) || 5;
    const totalFocusMinutesToday = loadTodayMinutes();
    set({ pomodoroMinutes, breakMinutes, totalFocusMinutesToday });
  },
}));
