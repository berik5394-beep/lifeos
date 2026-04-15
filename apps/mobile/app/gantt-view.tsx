import React, { useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useTaskStore } from '@/stores/task-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Theme } from '@/constants/themes';

const CATEGORY_COLORS: Record<string, string> = {
  work: '#3B82F6',
  personal: '#8B5CF6',
  health: '#22C55E',
  finance: '#F59E0B',
  education: '#06B6D4',
  home: '#F97316',
};

function getWeekDays(): Date[] {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_WIDTH = 100;

export default function GanttViewScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) fetchTasks();
  }, [token, fetchTasks]);

  const weekDays = useMemo(() => getWeekDays(), []);

  const todayStr = new Date().toISOString().split('T')[0];

  const weekTasks = useMemo(() => {
    const start = weekDays[0].toISOString().split('T')[0];
    const end = weekDays[6].toISOString().split('T')[0];
    return tasks.filter((t) => {
      const d = typeof t.date === 'string' ? t.date.split('T')[0] : '';
      return d >= start && d <= end;
    });
  }, [tasks, weekDays]);

  const getDayIndex = (dateStr: string): number => {
    const d = dateStr.split('T')[0];
    return weekDays.findIndex((wd) => wd.toISOString().split('T')[0] === d);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Таймлайн</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.ganttContainer}>
          {/* Day headers */}
          <View style={styles.dayRow}>
            {weekDays.map((day, i) => {
              const dateStr = day.toISOString().split('T')[0];
              const isToday = dateStr === todayStr;
              return (
                <View
                  key={i}
                  style={[styles.dayCell, isToday && styles.dayCellToday]}
                >
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                    {DAY_LABELS[i]}
                  </Text>
                  <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
                    {day.getDate()}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Task bars */}
          <View style={styles.barsContainer}>
            {weekTasks.map((task) => {
              const dateStr = typeof task.date === 'string' ? task.date : '';
              const dayIdx = getDayIndex(dateStr);
              if (dayIdx < 0) return null;

              const barColor = CATEGORY_COLORS[task.category] || '#6B7280';
              const estimatedHours = (task.estimatedMinutes ?? 60) / 60;
              const barWidth = Math.max(DAY_WIDTH * 0.8, DAY_WIDTH * estimatedHours / 8);

              return (
                <View key={task.id} style={styles.barRow}>
                  <View
                    style={[
                      styles.bar,
                      {
                        marginLeft: dayIdx * DAY_WIDTH + 10,
                        width: Math.min(barWidth, (7 - dayIdx) * DAY_WIDTH - 20),
                        backgroundColor: barColor,
                      },
                    ]}
                  >
                    <Text style={styles.barText} numberOfLines={1}>
                      {task.title}
                    </Text>
                    {task.time && (
                      <Text style={styles.barTime}>{task.time}</Text>
                    )}
                  </View>
                </View>
              );
            })}

            {weekTasks.length === 0 && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  Нет задач на эту неделю
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    backButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    ganttContainer: { minWidth: DAY_WIDTH * 7, paddingBottom: spacing.xl },
    dayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border },
    dayCell: {
      width: DAY_WIDTH,
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    dayCellToday: { backgroundColor: `${c.primary}15` },
    dayLabel: { fontSize: fontSize.xs, color: c.textMuted, fontWeight: '500' },
    dayLabelToday: { color: c.primary },
    dayNumber: { fontSize: fontSize.md, color: c.text, fontWeight: '600', marginTop: 2 },
    dayNumberToday: { color: c.primary },
    barsContainer: { paddingTop: spacing.sm },
    barRow: { height: 36, justifyContent: 'center', marginBottom: spacing.xs },
    bar: {
      height: 28,
      borderRadius: borderRadius.sm,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      gap: spacing.xs,
    },
    barText: { fontSize: fontSize.xs, color: '#FFF', fontWeight: '600', flex: 1 },
    barTime: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
    emptyContainer: { padding: spacing.xl, alignItems: 'center' },
    emptyText: { fontSize: fontSize.md, color: c.textMuted },
  });
}
