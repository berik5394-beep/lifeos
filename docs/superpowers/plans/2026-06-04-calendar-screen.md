# Экран календаря (мобайл) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline)
> или subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Самодостаточный экран месячного календаря в мобильном приложении —
сетка дней закрашена по % выполнения, маркеры ✓/✗/•, тап по дню → панель с
задачами и событиями.

**Architecture:** Чистые хелперы (`calendar-logic.ts`, jest-тесты) + два
presentational-компонента (`MonthGrid`, `DayDetailSheet`) + экран
(`app/calendar.tsx`), вход с дашборда. Данные из `task-store` + `event-store`,
% считается на клиенте. Ноль новых нативных зависимостей (веб-PWA соберётся).

**Tech Stack:** React Native + Expo, TypeScript strict, jest (jest-expo),
expo-router, zustand stores.

**Rollout:** Mobile-only, серверных изменений ноль. Коммит на шаг (trailer
`Co-Authored-By: Claude Opus 4.8 (1M context)`). Все пути относительно
`apps/mobile/`. tsc = `npx tsc --noEmit` в `apps/mobile`. Тесты = `npm test`.

---

## File Structure
| Файл | Ответственность |
|---|---|
| `utils/dates.ts` (modify) | + экспорт `RU_MONTHS`, `RU_MONTHS_GENITIVE`, `RU_DAYS_SHORT` (канон RU-меток, чтобы не дублировать). |
| `components/calendar/calendar-logic.ts` (create) | Чистые хелперы + типы: `buildMonthMatrix`, `computeDayStats`, `dayMarker`, `heatColor`. |
| `components/calendar/month-grid.tsx` (create) | Presentational сетка 7×6. |
| `components/calendar/day-detail-sheet.tsx` (create) | Modal-панель дня. |
| `app/calendar.tsx` (create) | Экран: шапка + данные + сетка + панель. |
| `app/(tabs)/index.tsx` (modify) | Кнопка-вход «Календарь». |
| `__tests__/components/calendar/calendar-logic.test.ts` (create) | jest-тесты чистых хелперов. |

---

### Task 1: RU-метки дат в utils/dates (DRY)

**Files:** Modify `utils/dates.ts`

- [ ] **Step 1: Добавить экспортируемые константы** в конец `utils/dates.ts`

```ts
export const RU_MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

export const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

// Неделя начинается с понедельника (как везде в приложении).
export const RU_DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
```

- [ ] **Step 2: tsc.** Run: `npx tsc --noEmit` → 0 ошибок.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/utils/dates.ts
git commit -m "feat(calendar): RU date labels in utils/dates (shared)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистые хелперы calendar-logic (TDD, jest)

**Files:** Create `components/calendar/calendar-logic.ts`, Create
`__tests__/components/calendar/calendar-logic.test.ts`

- [ ] **Step 1: Падающий тест** `__tests__/components/calendar/calendar-logic.test.ts`

```ts
import {
  buildMonthMatrix,
  computeDayStats,
  dayMarker,
  heatColor,
  type DayStat,
} from '@/components/calendar/calendar-logic';

describe('buildMonthMatrix', () => {
  it('июнь 2026: 1 июня = понедельник → первая ячейка = 1 июня', () => {
    const weeks = buildMonthMatrix(2026, 5); // month 0-based: 5=июнь
    expect(weeks[0][0].dateKey).toBe('2026-06-01');
    expect(weeks[0][0].inMonth).toBe(true);
  });

  it('каждая неделя = 7 дней, все дни месяца присутствуют', () => {
    const weeks = buildMonthMatrix(2026, 5);
    for (const w of weeks) expect(w).toHaveLength(7);
    const keys = weeks.flat().filter((d) => d.inMonth).map((d) => d.dateKey);
    expect(keys).toContain('2026-06-30');
    expect(keys.filter((k) => k.startsWith('2026-06')).length).toBe(30);
  });

  it('дни соседних месяцев помечены inMonth=false', () => {
    // май 2026: 1 мая = пятница → первые 4 ячейки = дни апреля
    const weeks = buildMonthMatrix(2026, 4);
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][4].dateKey).toBe('2026-05-01');
    expect(weeks[0][4].inMonth).toBe(true);
  });
});

describe('computeDayStats', () => {
  const today = new Date(2026, 5, 15); // 15 июня 2026

  it('считает done/total/donePct по дате', () => {
    const tasks = [
      { date: '2026-06-10', completed: true },
      { date: '2026-06-10', completed: false },
      { date: '2026-06-10', completed: true },
    ];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-10']).toEqual<DayStat>({
      total: 3,
      done: 2,
      donePct: 67,
      hasOverdue: true, // прошлый день + есть невыполненная
    });
  });

  it('день без задач отсутствует в карте', () => {
    const stats = computeDayStats([], today);
    expect(stats['2026-06-10']).toBeUndefined();
  });

  it('hasOverdue=false для будущего дня с невыполненной задачей', () => {
    const tasks = [{ date: '2026-06-20', completed: false }];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-20'].hasOverdue).toBe(false);
  });

  it('hasOverdue=false если все выполнены (даже в прошлом)', () => {
    const tasks = [{ date: '2026-06-10', completed: true }];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-10'].hasOverdue).toBe(false);
  });
});

describe('dayMarker', () => {
  const full: DayStat = { total: 2, done: 2, donePct: 100, hasOverdue: false };
  const partialPast: DayStat = { total: 2, done: 1, donePct: 50, hasOverdue: true };

  it('check при 100% (приоритет над всем)', () => {
    expect(dayMarker(full, true, true)).toBe('check');
  });
  it('cross при прошлом дне с невыполненным', () => {
    expect(dayMarker(partialPast, false, true)).toBe('cross');
  });
  it('будущий частичный день → не cross', () => {
    const partialFuture: DayStat = { total: 2, done: 1, donePct: 50, hasOverdue: false };
    expect(dayMarker(partialFuture, false, false)).toBe('none');
  });
  it('dot когда есть событие и нет check/cross', () => {
    expect(dayMarker(undefined, true, false)).toBe('dot');
  });
  it('none для пустого дня без событий', () => {
    expect(dayMarker(undefined, false, true)).toBe('none');
  });
});

describe('heatColor', () => {
  it('0% → surface цвет', () => {
    expect(heatColor(0, '#1E293B')).toBe('#1E293B');
  });
  it('границы шкалы', () => {
    expect(heatColor(25, '#1E293B')).toBe('#064E3B');
    expect(heatColor(50, '#1E293B')).toBe('#059669');
    expect(heatColor(75, '#1E293B')).toBe('#34D399');
    expect(heatColor(100, '#1E293B')).toBe('#22C55E');
  });
});
```

- [ ] **Step 2: Run — упасть.** Run: `npm test -- calendar-logic` → FAIL (module not found).

- [ ] **Step 3: Реализация** `components/calendar/calendar-logic.ts`

```ts
import { formatDate } from '@/utils/dates';

export interface DayStat {
  total: number;
  done: number;
  donePct: number; // 0..100
  hasOverdue: boolean; // прошлый/сегодня день с невыполненной задачей
}

export type DayMarker = 'check' | 'cross' | 'dot' | 'none';

export interface MatrixDay {
  date: Date;
  dateKey: string; // 'YYYY-MM-DD'
  day: number; // число месяца
  inMonth: boolean; // принадлежит отображаемому месяцу
}

/** Минимальная форма задачи, нужная для расчётов (шире — из task-store). */
interface TaskLike {
  date: string;
  completed: boolean;
}

/**
 * Матрица недель месяца. Неделя начинается с понедельника. Первая/последняя
 * недели добиваются днями соседних месяцев (inMonth=false). Возвращает 4-6 недель.
 */
export function buildMonthMatrix(year: number, month: number): MatrixDay[][] {
  const first = new Date(year, month, 1);
  const firstDow = first.getDay(); // 0=вс
  const startOffset = firstDow === 0 ? -6 : 1 - firstDow; // выравнивание на пн
  const start = new Date(year, month, 1 + startOffset);

  const last = new Date(year, month + 1, 0); // последний день месяца

  const weeks: MatrixDay[][] = [];
  const cursor = new Date(start);
  // Идём неделями, пока не покрыли последний день месяца и не закрыли неделю.
  while (cursor <= last || cursor.getDay() !== 1) {
    const week: MatrixDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: new Date(cursor),
        dateKey: formatDate(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month && cursor.getFullYear() === year,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (weeks.length >= 6) break; // защита от бесконечного цикла
  }
  return weeks;
}

/** % выполнения и hasOverdue по каждой дате. День без задач — отсутствует. */
export function computeDayStats(
  tasks: TaskLike[],
  now: Date = new Date(),
): Record<string, DayStat> {
  const todayKey = formatDate(now);
  const agg: Record<string, { total: number; done: number; openCount: number }> = {};
  for (const t of tasks) {
    if (!agg[t.date]) agg[t.date] = { total: 0, done: 0, openCount: 0 };
    agg[t.date].total++;
    if (t.completed) agg[t.date].done++;
    else agg[t.date].openCount++;
  }
  const out: Record<string, DayStat> = {};
  for (const [date, a] of Object.entries(agg)) {
    const donePct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0;
    // hasOverdue: день в прошлом или сегодня И есть незакрытая задача.
    const isPastOrToday = date <= todayKey;
    out[date] = {
      total: a.total,
      done: a.done,
      donePct,
      hasOverdue: isPastOrToday && a.openCount > 0,
    };
  }
  return out;
}

/** Один маркер на ячейку. Приоритет: check > cross > dot > none. */
export function dayMarker(
  stat: DayStat | undefined,
  hasEvent: boolean,
  isPast: boolean,
): DayMarker {
  if (stat && stat.total > 0 && stat.donePct === 100) return 'check';
  if (stat && stat.total > 0 && isPast && stat.hasOverdue) return 'cross';
  if (hasEvent) return 'dot';
  return 'none';
}

/** Цветовая шкала % (та же, что в charts/heatmap). 0 → surface. */
export function heatColor(pct: number, surface: string): string {
  if (pct <= 0) return surface;
  if (pct <= 25) return '#064E3B';
  if (pct <= 50) return '#059669';
  if (pct <= 75) return '#34D399';
  return '#22C55E';
}
```

- [ ] **Step 4: Run — зелёный.** Run: `npm test -- calendar-logic` → PASS. Run: `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/calendar/calendar-logic.ts apps/mobile/__tests__/components/calendar/calendar-logic.test.ts
git commit -m "feat(calendar): pure logic — month matrix, day stats, markers, heat color

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DRY — heatmap использует общий heatColor

**Files:** Modify `components/charts/heatmap.tsx`

- [ ] **Step 1: Заменить локальный getColor на общий** — удалить локальную
функцию `getColor` и импортировать. В начало файла добавить:

```ts
import { heatColor } from '@/components/calendar/calendar-logic';
```

Заменить вызовы `getColor(value, surfaceColor)` на `heatColor(value, surfaceColor)`
и удалить локальное определение `function getColor(...) {...}`.

- [ ] **Step 2: Проверка вида не изменилась** — `heatColor` имеет идентичную
шкалу (та же по границам/цветам). Run: `npx tsc --noEmit` → 0.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/charts/heatmap.tsx
git commit -m "refactor(calendar): heatmap reuses shared heatColor (DRY, identical look)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: MonthGrid (presentational)

**Files:** Create `components/calendar/month-grid.tsx`

- [ ] **Step 1: Реализация** `components/calendar/month-grid.tsx`

```tsx
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, borderRadius, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { formatDate, isToday, RU_DAYS_SHORT } from '@/utils/dates';
import {
  buildMonthMatrix,
  dayMarker,
  heatColor,
  type DayStat,
} from './calendar-logic';

interface MonthGridProps {
  year: number;
  month: number; // 0-based
  dayStats: Record<string, DayStat>;
  eventDays: Set<string>;
  onDayPress: (dateKey: string) => void;
}

export const MonthGrid = React.memo(function MonthGrid({
  year,
  month,
  dayStats,
  eventDays,
  onDayPress,
}: MonthGridProps) {
  const colors = useColors();
  const weeks = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const todayKey = formatDate(new Date());

  return (
    <View>
      {/* Заголовки дней недели */}
      <View style={styles.weekRow}>
        {RU_DAYS_SHORT.map((d) => (
          <View key={d} style={styles.cell}>
            <Text style={[styles.dowLabel, { color: colors.textSecondary }]}>{d}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((cell) => {
            const stat = dayStats[cell.dateKey];
            const isPast = cell.dateKey <= todayKey;
            const marker = dayMarker(stat, eventDays.has(cell.dateKey), isPast);
            const bg = cell.inMonth
              ? heatColor(stat?.donePct ?? 0, colors.surface)
              : 'transparent';
            const isCellToday = isToday(cell.date);

            return (
              <Pressable
                key={cell.dateKey}
                style={styles.cell}
                onPress={() => cell.inMonth && onDayPress(cell.dateKey)}
                disabled={!cell.inMonth}
              >
                <View
                  style={[
                    styles.dayBox,
                    { backgroundColor: bg },
                    isCellToday && { borderColor: colors.primary, borderWidth: 2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      { color: cell.inMonth ? colors.text : colors.textSecondary },
                      !cell.inMonth && styles.dimmed,
                    ]}
                  >
                    {cell.day}
                  </Text>
                  <Text style={styles.marker}>
                    {marker === 'check'
                      ? '✓'
                      : marker === 'cross'
                        ? '✗'
                        : marker === 'dot'
                          ? '•'
                          : ' '}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  dowLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  dayBox: {
    width: 40,
    height: 44,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontSize: fontSize.sm, fontWeight: '600' },
  dimmed: { opacity: 0.4 },
  marker: { fontSize: 10, height: 12, color: '#F8FAFC' },
});
```

- [ ] **Step 2: tsc.** Run: `npx tsc --noEmit` → 0.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/calendar/month-grid.tsx
git commit -m "feat(calendar): MonthGrid presentational component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: DayDetailSheet (panel)

**Files:** Create `components/calendar/day-detail-sheet.tsx`

- [ ] **Step 1: Реализация** `components/calendar/day-detail-sheet.tsx`

```tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Modal, Button } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { RU_MONTHS_GENITIVE } from '@/utils/dates';

interface DayTask {
  id: string;
  title: string;
  completed: boolean;
}
interface DayEvent {
  id: string;
  title: string;
  startTime: string | null;
}

interface DayDetailSheetProps {
  dateKey: string | null; // 'YYYY-MM-DD' или null = закрыто
  tasks: DayTask[];
  events: DayEvent[];
  onClose: () => void;
  onOpenTasks: () => void;
}

function ruDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${RU_MONTHS_GENITIVE[m - 1]} ${y}`;
}

export function DayDetailSheet({
  dateKey,
  tasks,
  events,
  onClose,
  onOpenTasks,
}: DayDetailSheetProps) {
  const colors = useColors();
  const isEmpty = tasks.length === 0 && events.length === 0;

  return (
    <Modal visible={dateKey !== null} onClose={onClose}>
      <ScrollView style={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>
          {dateKey ? ruDate(dateKey) : ''}
        </Text>

        {isEmpty && (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            На этот день ничего не запланировано
          </Text>
        )}

        {tasks.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Задачи
            </Text>
            {tasks.map((t) => (
              <Text
                key={t.id}
                style={[
                  styles.row,
                  { color: colors.text },
                  t.completed && styles.doneRow,
                ]}
              >
                {t.completed ? '✓ ' : '✗ '}
                {t.title}
              </Text>
            ))}
          </View>
        )}

        {events.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              События
            </Text>
            {events.map((e) => (
              <Text key={e.id} style={[styles.row, { color: colors.text }]}>
                {e.startTime ? `${e.startTime} · ` : ''}
                {e.title}
              </Text>
            ))}
          </View>
        )}

        <Button title="Открыть в Задачах" onPress={onOpenTasks} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, maxHeight: 420 },
  title: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
  empty: { fontSize: fontSize.md, marginVertical: spacing.lg, textAlign: 'center' },
  section: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  row: { fontSize: fontSize.md, marginBottom: spacing.sm },
  doneRow: { textDecorationLine: 'none', opacity: 0.6 },
});
```

- [ ] **Step 2: tsc.** Run: `npx tsc --noEmit` → 0.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/calendar/day-detail-sheet.tsx
git commit -m "feat(calendar): DayDetailSheet panel (read-only tasks + events)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Экран app/calendar.tsx

**Files:** Create `app/calendar.tsx`

- [ ] **Step 1: Реализация** `app/calendar.tsx`

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Card } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { getMonthKey, RU_MONTHS } from '@/utils/dates';
import { useTaskStore } from '@/stores/task-store';
import { useEventStore } from '@/stores/event-store';
import { MonthGrid } from '@/components/calendar/month-grid';
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet';
import { computeDayStats } from '@/components/calendar/calendar-logic';

export default function CalendarScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const isLoadingTasks = useTaskStore((s) => s.isLoading);
  const events = useEventStore((s) => s.events);
  const fetchEvents = useEventStore((s) => s.fetchEvents);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthKey = getMonthKey(cursor);

  useEffect(() => {
    fetchTasks(undefined, undefined, monthKey).catch(() => {});
    fetchEvents({ month: monthKey }).catch(() => {});
  }, [monthKey, fetchTasks, fetchEvents]);

  const dayStats = useMemo(() => computeDayStats(tasks), [tasks]);
  const eventDays = useMemo(
    () => new Set(events.map((e) => e.date)),
    [events],
  );

  const dayTasks = useMemo(
    () => (selectedDay ? tasks.filter((t) => t.date === selectedDay) : []),
    [selectedDay, tasks],
  );
  const dayEvents = useMemo(
    () => (selectedDay ? events.filter((e) => e.date === selectedDay) : []),
    [selectedDay, events],
  );

  const prevMonth = useCallback(
    () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1)),
    [],
  );
  const nextMonth = useCallback(
    () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1)),
    [],
  );
  const openTasks = useCallback(() => {
    setSelectedDay(null);
    navigation.navigate('Tasks' as never);
  }, [navigation]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={prevMonth} hitSlop={12}>
          <Feather name="chevron-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {RU_MONTHS[month]} {year}
          </Text>
          {isLoadingTasks && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
        <TouchableOpacity onPress={nextMonth} hitSlop={12}>
          <Feather name="chevron-right" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <Card style={styles.gridCard}>
        <MonthGrid
          year={year}
          month={month}
          dayStats={dayStats}
          eventDays={eventDays}
          onDayPress={setSelectedDay}
        />
      </Card>

      <DayDetailSheet
        dateKey={selectedDay}
        tasks={dayTasks}
        events={dayEvents}
        onClose={() => setSelectedDay(null)}
        onOpenTasks={openTasks}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  gridCard: { margin: spacing.md, padding: spacing.sm },
});
```

- [ ] **Step 2: tsc.** Run: `npx tsc --noEmit` → 0. (Если `Card` не принимает
`style` — обернуть в `View` со стилем; проверить пропсы `Card` в `components/ui/card.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/calendar.tsx
git commit -m "feat(calendar): month calendar screen (grid + day panel + month nav)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Вход с дашборда

**Files:** Modify `app/(tabs)/index.tsx`

- [ ] **Step 1: Найти блок навигационных колбэков** (рядом с
`handleNavigateKanbanBoard`/`handleNavigatePet`). Run для контекста:
`grep -n "handleNavigatePet\|handleNavigateLifeInsights" apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 2: Добавить колбэк** рядом с другими `handleNavigateX`:

```ts
  const handleNavigateCalendar = useCallback(
    () => navigation.navigate('Calendar' as never),
    [navigation],
  );
```

- [ ] **Step 3: Добавить кнопку-вход** в подходящий ряд быстрых действий на
дашборде (там, где уже есть кнопки на Pet/LifeInsights/KanbanBoard — повторить их
разметку). Минимальный вариант (вставить рядом с такими же `TouchableOpacity`):

```tsx
        <TouchableOpacity
          style={styles.quickAction}
          onPress={handleNavigateCalendar}
        >
          <Feather name="calendar" size={20} color={colors.primary} />
          <Text style={[styles.quickActionLabel, { color: colors.text }]}>
            Календарь
          </Text>
        </TouchableOpacity>
```

(Использовать те же стили/обёртку, что у соседних быстрых кнопок в этом файле —
скопировать у `handleNavigateKanbanBoard`-кнопки, чтобы вид совпадал. Если у них
другие имена стилей — взять их, не вводить новые.)

- [ ] **Step 4: tsc.** Run: `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(tabs)/index.tsx
git commit -m "feat(calendar): dashboard entry button → Calendar screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Финальная верификация

- [ ] **Step 1: Юнит-тесты.** Run: `npm test -- calendar-logic` → PASS.
  Run: `npm test 2>&1 | tail -5` → весь mobile-сьют зелёный (новые + старые).

- [ ] **Step 2: tsc.** Run: `npx tsc --noEmit` → 0 ошибок.

- [ ] **Step 3: Веб-безопасность (проверка отсутствия новых нативных deps).**
  Run: `git diff --stat HEAD~7 -- apps/mobile/package.json` → пусто (package.json
  НЕ менялся — ни одной новой зависимости).

- [ ] **Step 4: Независимое ревью** — `pr-review-toolkit:code-reviewer` по диффу
  календаря: фокус (a) чистота хелперов (нет I/O в calendar-logic), (b) корректность
  buildMonthMatrix на краях года (декабрь→январь), (c) reuse heatColor (вид heatmap
  не изменился), (d) ноль новых нативных зависимостей (веб-безопасно).

---

## Self-Review
- **Spec coverage:** навигация push-с-дашборда (T7), месячная сетка+маркеры (T2,T4),
  панель дня read-only + «Открыть в Задачах» (T5), % из задач на клиенте (T2,T6),
  переиспользование heatColor (T3), русские метки (T1), чистые хелперы под jest (T2),
  не-цели (робот/привычки/редактирование) — не включены. Все секции спеки покрыты.
- **Placeholder scan:** код в каждом шаге; «проверить пропсы Card» / «скопировать
  стили соседних кнопок» — это локаторы интеграции с существующим экраном, не
  заглушки (точные файлы указаны).
- **Type consistency:** `DayStat{total,done,donePct,hasOverdue}`, `DayMarker`,
  `MatrixDay{date,dateKey,day,inMonth}` едины во всех тасках; `buildMonthMatrix(year,
  month0based)`, `computeDayStats(tasks,now?)`, `dayMarker(stat,hasEvent,isPast)`,
  `heatColor(pct,surface)` — сигнатуры совпадают между T2 (определение), T3/T4/T6
  (использование).
- **Открытый риск:** пропсы `Card` (принимает ли `style`) и имена стилей быстрых
  кнопок дашборда — досверяются grep'ом в T6 Step 2 / T7 Step 3 (интеграционные точки).

## Verification gate
1. `npm test` — calendar-logic + весь mobile-сьют зелёные.
2. `npx tsc --noEmit` → 0.
3. `package.json` не изменён (ноль новых нативных зависимостей → веб-PWA соберётся).
4. Визуально на сборке (Berik): сетка, цвета по %, маркеры ✓/✗/•, тап→панель,
   переключение месяцев, вход с дашборда.
