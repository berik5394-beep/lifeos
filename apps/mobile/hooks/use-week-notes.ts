import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/services/storage';

export interface WeekNotes {
  notes: string;
  improve: string;
  gratitude: string;
}

const EMPTY: WeekNotes = { notes: '', improve: '', gratitude: '' };
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
