import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Pressable } from 'react-native';
import { ScreenSafeArea } from '@/components/shared/screen-safe-area';
import { Feather } from '@expo/vector-icons';
import { Card } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useRobotDodge } from '@/hooks/use-robot-dodge';
import { getMonthKey, RU_MONTHS } from '@/utils/dates';
import { useTaskStore } from '@/stores/task-store';
import { useEventStore } from '@/stores/event-store';
import { useScheduleStore } from '@/stores/schedule-store';
import { MonthGrid } from '@/components/calendar/month-grid';
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet';
import { computeDayStats, dayKey, dayPriorityColors, nextPriority, parseEventLine } from '@/components/calendar/calendar-logic';

export default function CalendarScreen() {
  const colors = useColors();
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const isLoadingTasks = useTaskStore((s) => s.isLoading);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const toggleComplete = useTaskStore((s) => s.toggleComplete);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const events = useEventStore((s) => s.events);
  const fetchEvents = useEventStore((s) => s.fetchEvents);
  // Перегруз дня: «Подтвердить» сдвинул график → перечитать месяц.
  const scheduleRevision = useScheduleStore((s) => s.revision);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthKey = getMonthKey(cursor);

  useEffect(() => {
    fetchTasks(undefined, undefined, monthKey).catch(() => {});
    fetchEvents({ month: monthKey }).catch(() => {});
  }, [monthKey, fetchTasks, fetchEvents, scheduleRevision]);

  const dayStats = useMemo(() => computeDayStats(tasks), [tasks]);
  const eventDays = useMemo(() => new Set(events.map((e) => dayKey(e.date))), [events]);
  const dayColors = useMemo(() => dayPriorityColors(tasks), [tasks]);

  const dayTasks = useMemo(
    () => (selectedDay ? tasks.filter((t) => dayKey(t.date) === selectedDay) : []),
    [selectedDay, tasks],
  );
  const dayEvents = useMemo(
    () => (selectedDay ? events.filter((e) => dayKey(e.date) === selectedDay) : []),
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
  // Тап по числу → окно дня: добавить задачу прямо на эту дату, сменить цвет, отметить.
  const fail = (err: unknown) => Alert.alert('Ошибка', err instanceof Error ? err.message : 'Не получилось');
  const addTask = useCallback(
    async (title: string) => {
      if (!selectedDay) return;
      // Ошибку покажет сама строка «Новая задача» (текст не пропадёт).
      await createTask({ title, category: 'personal', priority: 'medium', date: selectedDay });
    },
    [selectedDay, createTask],
  );
  // Событие на выбранный день прямо из окна дня (время из строки).
  const addEvent = useCallback(
    async (line: string) => {
      if (!selectedDay) return;
      const p = parseEventLine(line);
      if (!p) throw new Error('Напиши, что за событие: «14:00 встреча с Ахметом».');
      await useEventStore.getState().createEvent({ title: p.title, date: selectedDay, startTime: p.startTime, endTime: p.endTime });
    },
    [selectedDay],
  );
  const cycleColor = useCallback(
    (t: { id: string; priority?: string | null }) => {
      void updateTask(t.id, { priority: nextPriority(t.priority) }).catch(fail);
    },
    [updateTask],
  );
  const toggle = useCallback((t: { id: string }) => void Promise.resolve(toggleComplete(t.id)).catch(fail), [toggleComplete]);
  const remove = useCallback((t: { id: string }) => void deleteTask(t.id).catch(fail), [deleteTask]);

  const dodge = useRobotDodge();

  return (
    // Внутри дома мини-робот висит в углу поверх — снизу место под него
    // (календарь не листается, поэтому отступ, а не пустое место в прокрутке).
    <ScreenSafeArea style={[styles.container, { backgroundColor: colors.background, paddingBottom: dodge?.inset ?? 0 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={prevMonth} hitSlop={12} accessibilityRole="button" accessibilityLabel="Предыдущий месяц">
          <Feather name="chevron-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Pressable onPress={() => setCursor(new Date())} accessibilityRole="button" accessibilityLabel="Вернуться к текущему месяцу">
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {RU_MONTHS[month]} {year}
            </Text>
          </Pressable>
          {/* Сбоку от заголовка, не сдвигая его: месяц всегда ровно по центру. */}
          {isLoadingTasks && <ActivityIndicator size="small" color={colors.primary} style={styles.headerSpinner} />}
        </View>
        <TouchableOpacity onPress={nextMonth} hitSlop={12} accessibilityRole="button" accessibilityLabel="Следующий месяц">
          <Feather name="chevron-right" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <Card style={styles.gridCard}>
        <MonthGrid
          year={year}
          month={month}
          dayStats={dayStats}
          eventDays={eventDays}
          dayColors={dayColors}
          onDayPress={setSelectedDay}
        />
      </Card>

      <DayDetailSheet
        dateKey={selectedDay}
        tasks={dayTasks}
        events={dayEvents}
        onClose={() => setSelectedDay(null)}
        onAddTask={addTask}
        onAddEvent={addEvent}
        onCycleColor={cycleColor}
        onToggle={toggle}
        onDelete={remove}
      />
      <Text style={[styles.legend, { color: colors.textSecondary }]}>
        Нажми на число, чтобы добавить задачу или событие на этот день
      </Text>
    </ScreenSafeArea>
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
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerSpinner: { position: 'absolute', right: -(spacing.sm + 20) },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  gridCard: { margin: spacing.md, padding: spacing.sm },
  legend: { textAlign: 'center', fontSize: fontSize.sm, paddingHorizontal: spacing.lg },
});
