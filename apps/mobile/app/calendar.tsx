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
  const eventDays = useMemo(() => new Set(events.map((e) => e.date)), [events]);

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
