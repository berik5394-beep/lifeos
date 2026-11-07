import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '@/services/storage';
import { api, QUEUE_OFFLINE } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface WeekNotes {
  notes: string;
  improve: string;
  gratitude: string;
  /** «Что получилось на этой неделе?» (рефлексия в «Привычках»). */
  wins: string;
}

const EMPTY: WeekNotes = { notes: '', improve: '', gratitude: '', wins: '' };
const FIELDS: (keyof WeekNotes)[] = ['notes', 'improve', 'gratitude', 'wins'];
/** Пауза после ввода перед отправкой на сервер (не слать каждую букву). */
const SYNC_MS = 1200;

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
 * Слияние телефона и сервера по полям. Набранное на телефоне главнее (офлайн-
 * правка не теряется), сервер заполняет пустые поля (новый телефон, вход после
 * выхода). Поля, которых на сервере нет или они другие, — отправить наверх
 * (так заметки, написанные до синхронизации, уезжают к мозгу).
 */
export function mergeWeekNotes(local: WeekNotes, remote: Partial<WeekNotes> | null): { merged: WeekNotes; toPush: Partial<WeekNotes> } {
  const merged = { ...EMPTY };
  const toPush: Partial<WeekNotes> = {};
  for (const f of FIELDS) {
    const l = local[f] ?? '';
    const r = remote?.[f] ?? '';
    if (l.trim()) {
      merged[f] = l;
      if (l !== r) toPush[f] = l;
    } else {
      merged[f] = r;
    }
  }
  return { merged, toPush };
}

/**
 * Заметки недели в планере и рефлексия в «Привычках». Хранятся на телефоне
 * (работают без сети) и синхронизируются с сервером — мозг видит, что человек
 * сам написал про неделю. Раньше жили только на телефоне.
 */
export function useWeekNotes(weekStart: string): [WeekNotes, (field: keyof WeekNotes, value: string) => void] {
  const token = useAuthStore((s) => s.token);
  const [notes, setNotes] = useState<WeekNotes>(() => loadWeekNotes(weekStart));
  const pending = useRef<Partial<WeekNotes>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    (week: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const body = pending.current;
      pending.current = {};
      if (!token || Object.keys(body).length === 0) return;
      // Без сети запись встанет в очередь и уйдёт позже (как дневник).
      api.put(`/week-notes/${week}`, body, token, QUEUE_OFFLINE).catch(() => {});
    },
    [token],
  );

  useEffect(() => {
    const local = loadWeekNotes(weekStart);
    setNotes(local);
    if (!token) return;
    let alive = true;
    api
      .get<Partial<WeekNotes>>(`/week-notes/${weekStart}`, token)
      .then((remote) => {
        if (!alive) return;
        const { merged, toPush } = mergeWeekNotes(loadWeekNotes(weekStart), remote);
        storage.set(weekNotesKey(weekStart), JSON.stringify(merged));
        setNotes(merged);
        if (Object.keys(toPush).length > 0) {
          api.put(`/week-notes/${weekStart}`, toPush, token, QUEUE_OFFLINE).catch(() => {});
        }
      })
      .catch(() => {
        /* нет сети — работаем с локальными, синхронизируем позже */
      });
    return () => {
      alive = false;
      flush(weekStart); // ушли со страницы / сменили неделю — не теряем набранное
    };
  }, [weekStart, token, flush]);

  const update = useCallback(
    (field: keyof WeekNotes, value: string) => {
      setNotes((prev) => {
        const next = { ...prev, [field]: value };
        storage.set(weekNotesKey(weekStart), JSON.stringify(next));
        return next;
      });
      pending.current[field] = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(weekStart), SYNC_MS);
    },
    [weekStart, flush],
  );
  return [notes, update];
}
