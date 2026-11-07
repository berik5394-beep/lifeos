import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/services/storage';

export interface WeekNotes {
  notes: string;
  improve: string;
  gratitude: string;
  /** «Что получилось на этой неделе?» (рефлексия в «Привычках»). */
  wins: string;
}

const EMPTY: WeekNotes = { notes: '', improve: '', gratitude: '', wins: '' };

/** Понедельник недели даты — ключ заметок (тот же, что в планере «Задач»). */
export function mondayKey(d: Date = new Date()): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = m.getDay();
  m.setDate(m.getDate() + (wd === 0 ? -6 : 1 - wd));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}
export const weekNotesKey = (weekStart: string) => `week_notes:${weekStart}`;

export function loadWeekNotes(weekStart: string): WeekNotes {
  const raw = storage.getString(weekNotesKey(weekStart));
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<WeekNotes>) };
  } catch {
    return EMPTY;
  }
}

/**
 * Заметки недели в планере. Раньше — только состояние экрана: уходишь —
 * написанное пропадало. Теперь хранятся на телефоне по неделям (ключ —
 * понедельник), каждое изменение сохраняется сразу.
 */
export function useWeekNotes(weekStart: string): [WeekNotes, (field: keyof WeekNotes, value: string) => void] {
  const [notes, setNotes] = useState<WeekNotes>(() => loadWeekNotes(weekStart));
  useEffect(() => setNotes(loadWeekNotes(weekStart)), [weekStart]);
  const update = useCallback(
    (field: keyof WeekNotes, value: string) => {
      setNotes((prev) => {
        const next = { ...prev, [field]: value };
        storage.set(weekNotesKey(weekStart), JSON.stringify(next));
        return next;
      });
    },
    [weekStart],
  );
  return [notes, update];
}
