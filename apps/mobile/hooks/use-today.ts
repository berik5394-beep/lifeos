import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

/** Локальная дата устройства 'YYYY-MM-DD'. */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Сколько ждать до начала следующего локального дня (+1 с запаса). */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

/**
 * «Сегодня», которое само переходит на новый день (аудит 2026-11-09).
 *
 * Вкладки инструментов не размонтируются, поэтому `useMemo(() => new Date(), [])`
 * застывал на моменте открытия: приложение открыто с вечера → утром отметка
 * привычки уходила во ВЧЕРА, в понедельник оставалась прошлая неделя.
 * Перепроверяем в полночь и при возврате приложения на экран.
 * Возвращает Date, у которого идентичность меняется только при смене дня.
 */
export function useToday(): Date {
  const [key, setKey] = useState(dayKey);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => setKey((prev) => {
      const now = dayKey();
      return now === prev ? prev : now;
    });
    const arm = () => {
      timer = setTimeout(() => {
        check();
        arm();
      }, msUntilNextDay(new Date()));
    };
    arm();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return useMemo(() => {
    const [y, m, d] = key.split('-').map(Number);
    const now = new Date();
    // Тот же день — текущее время (часы/минуты нужны приветствию), иначе полночь дня.
    return dayKey(now) === key ? now : new Date(y, m - 1, d);
  }, [key]);
}
