import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * «Активность за год» — % выполнения по каждому дню года с сервера.
 * Раньше карта строилась по задачам одной загруженной недели: остальной год
 * выглядел пустым. `refreshKey` — перечитать после отметки задачи.
 */
export function useYearActivity(refreshKey: string, year: number = new Date().getFullYear()): Record<string, number> {
  const token = useAuthStore((s) => s.token);
  const [days, setDays] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api
      .get<{ days: Record<string, number> }>(`/tasks/activity?year=${year}`, token)
      .then((r) => {
        if (alive && r?.days) setDays(r.days);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, year, refreshKey]);
  return days;
}
