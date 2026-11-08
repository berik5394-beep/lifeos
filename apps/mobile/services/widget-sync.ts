import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Виджет «Сегодня» (сборка №15+): сводка дня с сервера (/widget/today) →
 * общая App Group (ключ "today", JSON) → виджет перерисовывается. Только iOS.
 * Модуль нативный — грузим лениво: на старых сборках и Android его нет.
 */
const APP_GROUP = 'group.kz.lifeos.app';
const MIN_INTERVAL_MS = 60_000;

export interface WidgetToday {
  date: string;
  tasksDone: number;
  tasksTotal: number;
  habitsDone: number;
  habitsTotal: number;
  next: { time: string; title: string } | null;
  topTask: string | null;
}

/** Плоский вид для Swift (TodayData в targets/widget/index.swift). Чистая. */
export function widgetPayload(d: WidgetToday): string {
  return JSON.stringify({
    date: d.date,
    tasksDone: d.tasksDone,
    tasksTotal: d.tasksTotal,
    habitsDone: d.habitsDone,
    habitsTotal: d.habitsTotal,
    nextTime: d.next?.time ?? null,
    nextTitle: d.next?.title ?? null,
    topTask: d.topTask,
  });
}

type Storage = { set: (k: string, v: string) => void };
type StorageCtor = { new (group: string): Storage; reloadWidget: (name?: string) => void };

function extensionStorage(): StorageCtor | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@bacons/apple-targets') as { ExtensionStorage: StorageCtor }).ExtensionStorage;
  } catch {
    return null;
  }
}

let last = 0;

/** Обновить виджет. force — сразу (после изменения дел), иначе не чаще раза в минуту. */
export async function syncWidget(force = false): Promise<void> {
  const ES = extensionStorage();
  const token = useAuthStore.getState().token;
  if (!ES || !token) return;
  const now = Date.now();
  if (!force && now - last < MIN_INTERVAL_MS) return;
  last = now;
  try {
    const d = await api.get<WidgetToday>('/widget/today', token);
    new ES(APP_GROUP).set('today', widgetPayload(d));
    ES.reloadWidget();
  } catch (err) {
    console.warn('[widget] sync failed:', err instanceof Error ? err.message : err);
  }
}
