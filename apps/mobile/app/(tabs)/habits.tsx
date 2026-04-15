import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
  Alert,
  TextInput,
  Animated,
  Easing,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useHabitStore } from '@/stores/habit-store';
import { useTaskStore } from '@/stores/task-store';
import { useFinanceStore } from '@/stores/finance-store';
import { useJournalStore } from '@/stores/journal-store';
import {
  Card,
  Button,
  Input,
  Modal,
  Checkbox,
  SlideTabs,
  AnimatedProgressBar,
  ProgressRing,
  StatCard,
} from '@/components/ui';
import { VoiceButton } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { spacing, borderRadius, fontSize, habitCategories } from '@/constants';
import { FadeInView } from '@/components/ui/fade-in-view';
import { hapticLight, hapticSelection } from '@/services/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const MONTH_NAMES_SHORT_RU = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];

const WEEKDAY_NAMES_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const FREQUENCY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'daily', label: 'Ежедневно' },
  { key: 'weekly', label: 'Еженедельно' },
  { key: 'monthly', label: 'Ежемесячно' },
];

const MOOD_EMOJIS = ['😢', '😕', '😐', '🙂', '😊'];
const MOOD_LABELS = ['Ужасно', 'Плохо', 'Нормально', 'Хорошо', 'Отлично'];

const CATEGORY_KEYS = Object.keys(habitCategories) as Array<keyof typeof habitCategories>;

type C = ReturnType<typeof useColors>;

// ─── Grid Cell (memoized) ─────────────────────────────────────────────────────

interface GridCellProps {
  completed: boolean;
  isFuture: boolean;
  isToday: boolean;
  onPress: () => void;
  color: string;
  emptyColor: string;
  missedColor: string;
  todayBorder: string;
}

const GridCell = React.memo(function GridCell({
  completed,
  isFuture,
  isToday,
  onPress,
  color,
  emptyColor,
  missedColor,
  todayBorder,
}: GridCellProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isFuture}
      activeOpacity={0.6}
      style={[
        gridCellStyles.cell,
        {
          backgroundColor: isFuture
            ? emptyColor
            : completed
              ? color
              : missedColor,
          opacity: isFuture ? 0.3 : 1,
        },
        isToday && { borderWidth: 2, borderColor: todayBorder },
      ]}
    >
      {!isFuture && !completed && (
        <Text style={gridCellStyles.missedText}>{'  '}</Text>
      )}
      {completed && <Text style={gridCellStyles.checkText}>{'✓'}</Text>}
    </TouchableOpacity>
  );
});

const gridCellStyles = StyleSheet.create({
  cell: {
    width: 28,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 1,
    marginVertical: 1,
  },
  missedText: { fontSize: 8, color: '#fff' },
  checkText: { fontSize: 12, color: '#fff', fontWeight: '700' },
});

// ─── Habit Card (memoized) ────────────────────────────────────────────────────

interface HabitCardProps {
  habitId: string;
  name: string;
  category: string;
  frequency: string;
  isCompleted: boolean;
  streak: number;
  onToggle: (habitId: string, completed: boolean) => void;
  onDelete: (habitId: string) => void;
  onEdit: (habitId: string) => void;
  c: C;
}

const HabitCard = React.memo(function HabitCard({
  habitId,
  name,
  category,
  frequency,
  isCompleted,
  streak,
  onToggle,
  onDelete,
  onEdit,
  c,
}: HabitCardProps) {
  const cat = habitCategories[category as keyof typeof habitCategories] ?? habitCategories.personal;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleToggle = useCallback(() => {
    Vibration.vibrate(30);
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.92,
        duration: 80,
        useNativeDriver: true,
        easing: Easing.out(Easing.quad),
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
        easing: Easing.elastic(1.2),
      }),
    ]).start();
    onToggle(habitId, !isCompleted);
  }, [habitId, isCompleted, onToggle, scaleAnim]);

  const handleLongPress = useCallback(() => {
    Alert.alert(name, 'Выберите действие', [
      { text: 'Редактировать', onPress: () => onEdit(habitId) },
      { text: 'Удалить', style: 'destructive', onPress: () => onDelete(habitId) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [habitId, name, onEdit, onDelete]);

  const frequencyLabel =
    frequency === 'daily' ? 'Каждый день' :
    frequency === 'weekly' ? 'Каждую неделю' :
    'Каждый месяц';

  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      borderLeftWidth: 4,
      borderLeftColor: cat.color,
    },
    checkArea: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2.5,
      borderColor: isCompleted ? cat.color : c.border,
      backgroundColor: isCompleted ? cat.color : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    checkMark: {
      fontSize: 18,
      color: '#fff',
      fontWeight: '700',
    },
    info: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
    icon: { fontSize: 16, marginRight: spacing.xs },
    name: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: isCompleted ? c.textSecondary : c.text,
      textDecorationLine: isCompleted ? 'line-through' : 'none',
      flex: 1,
    },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: 2,
    },
    freq: { fontSize: fontSize.xs, color: c.textSecondary },
    streak: {
      fontSize: fontSize.xs,
      color: streak > 0 ? '#F59E0B' : c.textSecondary,
      fontWeight: streak > 0 ? '600' : '400',
    },
  }), [c, cat, isCompleted, streak]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={handleLongPress}
        style={styles.container}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${isCompleted ? 'выполнено' : 'не выполнено'}${streak > 0 ? `, серия ${streak} дней` : ''}`}
        accessibilityHint="Удерживайте для редактирования или удаления"
      >
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={handleToggle}
          style={styles.checkArea}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isCompleted }}
          accessibilityLabel={`Отметить ${name}`}
        >
          {isCompleted && <Text style={styles.checkMark}>{'✓'}</Text>}
        </TouchableOpacity>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.icon}>{cat.icon}</Text>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.freq}>{frequencyLabel}</Text>
            {streak > 0 && (
              <Text style={styles.streak}>{'🔥'} {streak} дн.</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ─── Weekly Habit Row ─────────────────────────────────────────────────────────

interface WeeklyHabitRowProps {
  name: string;
  category: string;
  completedThisWeek: number;
  target: number;
  c: C;
}

const WeeklyHabitRow = React.memo(function WeeklyHabitRow({
  name,
  category,
  completedThisWeek,
  target,
  c,
}: WeeklyHabitRowProps) {
  const cat = habitCategories[category as keyof typeof habitCategories] ?? habitCategories.personal;
  const progress = target > 0 ? Math.min((completedThisWeek / target) * 100, 100) : 0;

  return (
    <View style={{
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
    }}>
      <Text style={{ fontSize: 20, marginRight: spacing.sm }}>{cat.icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: c.text, marginBottom: 4 }}>
          {name}
        </Text>
        <AnimatedProgressBar
          progress={progress}
          height={6}
          color={cat.color}
          trackColor={c.border}
        />
      </View>
      <Text style={{
        fontSize: fontSize.sm,
        fontWeight: '700',
        color: completedThisWeek >= target ? '#22C55E' : c.textSecondary,
        marginLeft: spacing.md,
        minWidth: 40,
        textAlign: 'right',
      }}>
        {completedThisWeek}/{target}
      </Text>
    </View>
  );
});

// ─── Mood Selector ────────────────────────────────────────────────────────────

interface MoodSelectorProps {
  value: number | null;
  onChange: (mood: number) => void;
  c: C;
}

const MoodSelector = React.memo(function MoodSelector({
  value,
  onChange,
  c,
}: MoodSelectorProps) {
  return (
    <View style={{
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: spacing.sm,
    }}>
      {MOOD_EMOJIS.map((emoji, index) => {
        const moodValue = index + 1;
        const isSelected = value === moodValue;
        return (
          <TouchableOpacity
            key={index}
            onPress={() => onChange(moodValue)}
            style={{
              alignItems: 'center',
              padding: spacing.sm,
              borderRadius: borderRadius.md,
              backgroundColor: isSelected ? c.primary + '20' : 'transparent',
              borderWidth: isSelected ? 2 : 0,
              borderColor: isSelected ? c.primary : 'transparent',
              minWidth: 56,
            }}
          >
            <Text style={{ fontSize: 28, marginBottom: 4 }}>{emoji}</Text>
            <Text style={{
              fontSize: fontSize.xs,
              color: isSelected ? c.primary : c.textSecondary,
              fontWeight: isSelected ? '600' : '400',
            }}>
              {MOOD_LABELS[index]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ─── Water Tracker ────────────────────────────────────────────────────────────

interface WaterTrackerProps {
  glasses: number;
  target: number;
  onAdd: () => void;
  onRemove: () => void;
  c: C;
}

const WaterTracker = React.memo(function WaterTracker({
  glasses,
  target,
  onAdd,
  onRemove,
  c,
}: WaterTrackerProps) {
  const progress = Math.min((glasses / target) * 100, 100);

  return (
    <View>
      <View style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.sm,
        gap: spacing.md,
      }}>
        <TouchableOpacity
          onPress={onRemove}
          disabled={glasses <= 0}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: glasses > 0 ? c.surface : c.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 18, color: c.text, fontWeight: '700' }}>-</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 36, fontWeight: '800', color: c.primary }}>
            {glasses}
          </Text>
          <Text style={{ fontSize: fontSize.xs, color: c.textSecondary }}>
            из {target} стаканов
          </Text>
        </View>
        <TouchableOpacity
          onPress={onAdd}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 18, color: '#fff', fontWeight: '700' }}>+</Text>
        </TouchableOpacity>
      </View>
      <AnimatedProgressBar
        progress={progress}
        height={8}
        color={'#3B82F6'}
        trackColor={c.border}
        showLabel
      />
      <View style={{
        flexDirection: 'row',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginTop: spacing.sm,
        gap: 4,
      }}>
        {Array.from({ length: target }).map((_, i) => (
          <Text key={i} style={{
            fontSize: 20,
            opacity: i < glasses ? 1 : 0.2,
          }}>
            {'💧'}
          </Text>
        ))}
      </View>
    </View>
  );
});

// ─── Sleep Input ──────────────────────────────────────────────────────────────

interface SleepInputProps {
  value: number | null;
  onChange: (hours: number) => void;
  c: C;
}

const SleepInput = React.memo(function SleepInput({
  value,
  onChange,
  c,
}: SleepInputProps) {
  const hours = value ?? 0;
  const quality = hours >= 8 ? 'Отлично' : hours >= 7 ? 'Хорошо' : hours >= 6 ? 'Нормально' : hours >= 4 ? 'Мало' : 'Критично';
  const qualityColor = hours >= 8 ? '#22C55E' : hours >= 7 ? '#3B82F6' : hours >= 6 ? '#F59E0B' : '#EF4444';

  return (
    <View>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        marginBottom: spacing.sm,
      }}>
        <TouchableOpacity
          onPress={() => onChange(Math.max(0, hours - 0.5))}
          disabled={hours <= 0}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: hours > 0 ? c.surface : c.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 18, color: c.text, fontWeight: '700' }}>-</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 36, fontWeight: '800', color: qualityColor }}>
            {hours.toFixed(1)}
          </Text>
          <Text style={{ fontSize: fontSize.xs, color: c.textSecondary }}>часов</Text>
        </View>
        <TouchableOpacity
          onPress={() => onChange(Math.min(16, hours + 0.5))}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 18, color: '#fff', fontWeight: '700' }}>+</Text>
        </TouchableOpacity>
      </View>
      <View style={{
        alignSelf: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        backgroundColor: qualityColor + '20',
      }}>
        <Text style={{ color: qualityColor, fontSize: fontSize.sm, fontWeight: '600' }}>
          {'🌙'} {quality}
        </Text>
      </View>
      <View style={{
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.sm,
        gap: 2,
      }}>
        {Array.from({ length: 16 }).map((_, i) => (
          <View
            key={i}
            style={{
              width: (SCREEN_WIDTH - 120) / 16,
              height: 8,
              borderRadius: 2,
              backgroundColor: i < hours * 2 ? qualityColor : c.border,
            }}
          />
        ))}
      </View>
    </View>
  );
});

// ─── Month Bar Chart (per-habit completion) ───────────────────────────────────

interface MonthBarChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  c: C;
}

const MonthBarChart = React.memo(function MonthBarChart({ data, c }: MonthBarChartProps) {
  if (data.length === 0) return null;
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={{ marginTop: spacing.sm }}>
      {data.map((item, index) => (
        <View key={index} style={{ marginBottom: spacing.sm }}>
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}>
            <Text
              style={{ fontSize: fontSize.xs, color: c.text, flex: 1 }}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            <Text style={{ fontSize: fontSize.xs, color: c.textSecondary, fontWeight: '600' }}>
              {Math.round(item.value)}%
            </Text>
          </View>
          <View style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: c.border,
            overflow: 'hidden',
          }}>
            <View style={{
              height: '100%',
              width: `${(item.value / maxValue) * 100}%`,
              backgroundColor: item.color,
              borderRadius: 4,
            }} />
          </View>
        </View>
      ))}
    </View>
  );
});

// ─── Weekly Mini Graph ────────────────────────────────────────────────────────

interface WeeklyMiniGraphProps {
  data: number[];
  labels: string[];
  color: string;
  c: C;
}

const WeeklyMiniGraph = React.memo(function WeeklyMiniGraph({
  data,
  labels,
  color,
  c,
}: WeeklyMiniGraphProps) {
  const maxVal = Math.max(...data, 1);

  return (
    <View style={{
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      height: 80,
      paddingTop: spacing.sm,
    }}>
      {data.map((val, i) => (
        <View key={i} style={{ alignItems: 'center', flex: 1 }}>
          <View style={{
            width: 20,
            height: Math.max((val / maxVal) * 56, 2),
            backgroundColor: val > 0 ? color : c.border,
            borderRadius: 4,
            marginBottom: 4,
          }} />
          <Text style={{ fontSize: 9, color: c.textSecondary }}>{labels[i]}</Text>
        </View>
      ))}
    </View>
  );
});

// ─── Line Chart (completion % over month) ─────────────────────────────────────

interface LineChartProps {
  data: number[];
  color: string;
  c: C;
  height?: number;
}

const SimpleLineChart = React.memo(function SimpleLineChart({
  data,
  color,
  c,
  height = 100,
}: LineChartProps) {
  if (data.length === 0) return null;
  const maxVal = Math.max(...data, 1);
  const chartWidth = SCREEN_WIDTH - spacing.lg * 4;
  const stepX = chartWidth / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => ({
    x: i * stepX,
    y: height - (v / maxVal) * (height - 10),
  }));

  return (
    <View style={{ height, position: 'relative', marginTop: spacing.sm }}>
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((pct) => (
        <View
          key={pct}
          style={{
            position: 'absolute',
            top: height - (pct / 100) * (height - 10),
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: c.border,
            opacity: 0.5,
          }}
        />
      ))}
      {/* Data points */}
      {points.map((pt, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: pt.x - 3,
            top: pt.y - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      ))}
      {/* Lines between points */}
      {points.length > 1 && points.slice(1).map((pt, i) => {
        const prev = points[i];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={`line-${i}`}
            style={{
              position: 'absolute',
              left: prev.x,
              top: prev.y,
              width: length,
              height: 2,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: 'left center',
            }}
          />
        );
      })}
      {/* Y-axis labels */}
      <Text style={{
        position: 'absolute',
        right: 0,
        top: -2,
        fontSize: 8,
        color: c.textSecondary,
      }}>100%</Text>
      <Text style={{
        position: 'absolute',
        right: 0,
        bottom: -2,
        fontSize: 8,
        color: c.textSecondary,
      }}>0%</Text>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export default function HabitsScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  // ─── Stores ───────────────────────────────────────────────────────────────
  const {
    habits,
    logs,
    stats,
    isLoading,
    fetchHabits,
    createHabit,
    updateHabit,
    deleteHabit,
    toggleHabitLog,
    fetchStats,
  } = useHabitStore();

  const {
    todayEntry,
    entries: journalEntries,
    fetchEntry: fetchJournalEntry,
    fetchMonthEntries,
    saveEntry: saveJournalEntry,
  } = useJournalStore();

  // ─── Voice ────────────────────────────────────────────────────────────────
  const {
    isRecording,
    isProcessing,
    lastResult,
    error: voiceError,
    startRecording,
    stopRecording,
    amplitude,
  } = useVoice();

  // Auto-execute voice actions when result arrives (replaces modal)
  useEffect(() => {
    if (lastResult && lastResult.intent && lastResult.intent.action !== 'unknown') {
      handleVoiceAction(lastResult.intent.action, lastResult.intent);
    }
  }, [lastResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceAction = useCallback(async (action: string, params: Record<string, unknown>) => {
    try {
      const todayFormatted = getTodayDate();
      switch (action) {
        case 'create_task':
          await useTaskStore.getState().createTask({
            title: params.title as string,
            category: (params.category as string) || 'personal',
            priority: (params.priority as string) || 'medium',
            date: (params.date as string) || todayFormatted,
          });
          Alert.alert('Готово', 'Задача создана!');
          break;
        case 'complete_task': {
          const allTasks = useTaskStore.getState().tasks;
          const found = allTasks.find(
            (t) => t.title.toLowerCase().includes((params.taskTitle as string || '').toLowerCase()),
          );
          if (found) {
            await useTaskStore.getState().toggleComplete(found.id);
            Alert.alert('Готово', 'Задача завершена!');
          } else {
            Alert.alert('Не найдено', 'Задача не найдена');
          }
          break;
        }
        case 'complete_habit': {
          const allHabits = useHabitStore.getState().habits;
          const habit = allHabits.find(
            (h) => h.name.toLowerCase().includes((params.habitName as string || '').toLowerCase()),
          );
          if (habit) {
            await useHabitStore.getState().toggleHabitLog(habit.id, todayFormatted, true);
            Alert.alert('Готово', 'Привычка отмечена!');
          } else {
            Alert.alert('Не найдено', 'Привычка не найдена');
          }
          break;
        }
        case 'add_expense':
          await useFinanceStore.getState().createExpense({
            amount: params.amount as number,
            category: (params.category as string) || 'other',
            description: (params.description as string) || '',
            date: todayFormatted,
          });
          Alert.alert('Готово', 'Расход записан!');
          break;
        case 'add_income':
          await useFinanceStore.getState().createIncome({
            amount: params.amount as number,
            source: (params.source as string) || '',
            date: todayFormatted,
          });
          Alert.alert('Готово', 'Доход записан!');
          break;
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось выполнить команду');
    }
  }, []);

  // ─── State ────────────────────────────────────────────────────────────────
  const today = useMemo(() => getTodayDate(), []);
  const todayDate = useMemo(() => new Date(), []);

  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  // Create modal fields
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('health');
  const [newFrequency, setNewFrequency] = useState('daily');

  // Edit modal fields
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('health');
  const [editFrequency, setEditFrequency] = useState('daily');

  // Calendar state (Slide 2)
  const [calMonth, setCalMonth] = useState(todayDate.getMonth());
  const [calYear, setCalYear] = useState(todayDate.getFullYear());

  // Analytics state (Slide 3)
  const [waterGlasses, setWaterGlasses] = useState(0);
  const waterTarget = 8;
  const [reflectionGood, setReflectionGood] = useState('');
  const [reflectionImprove, setReflectionImprove] = useState('');

  // ─── Computed ─────────────────────────────────────────────────────────────

  const activeHabits = useMemo(
    () => habits.filter((h) => h.active),
    [habits],
  );

  const dailyHabits = useMemo(
    () => activeHabits.filter((h) => h.frequency === 'daily'),
    [activeHabits],
  );

  const weeklyHabits = useMemo(
    () => activeHabits.filter((h) => h.frequency === 'weekly'),
    [activeHabits],
  );

  const monthlyHabits = useMemo(
    () => activeHabits.filter((h) => h.frequency === 'monthly'),
    [activeHabits],
  );

  const todayLogs = useMemo(() => logs[today] ?? [], [logs, today]);

  const todayCompleted = useMemo(() => {
    const dailyDone = dailyHabits.filter((h) =>
      todayLogs.some((l) => l.habitId === h.id && l.completed),
    ).length;
    return dailyDone;
  }, [dailyHabits, todayLogs]);

  const todayTotal = dailyHabits.length;
  const todayProgress = todayTotal > 0 ? todayCompleted / todayTotal : 0;

  // Current streak calculation
  const currentStreak = useMemo(() => {
    if (dailyHabits.length === 0) return 0;
    let streak = 0;
    const d = new Date(todayDate);

    for (let i = 0; i < 365; i++) {
      const dateKey = formatDateKey(d.getFullYear(), d.getMonth(), d.getDate());
      const dayLogs = logs[dateKey] ?? [];
      const allDone = dailyHabits.every((h) =>
        dayLogs.some((l) => l.habitId === h.id && l.completed),
      );
      if (allDone && dailyHabits.length > 0) {
        streak++;
      } else if (i > 0) {
        break;
      } else {
        // today not done yet is ok, check yesterday
      }
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }, [dailyHabits, logs, todayDate]);

  // Best streak (simplified from stats)
  const bestStreak = useMemo(() => {
    if (stats.length === 0) return currentStreak;
    return Math.max(currentStreak, ...stats.map((s) => s.streak));
  }, [stats, currentStreak]);

  // Month total completed
  const monthTotalCompleted = useMemo(() => {
    if (stats.length === 0) return 0;
    return stats.reduce((acc, s) => acc + s.completed, 0);
  }, [stats]);

  // Month completion percentage
  const monthCompletionPct = useMemo(() => {
    if (stats.length === 0) return 0;
    const total = stats.reduce((acc, s) => acc + s.total, 0);
    const completed = stats.reduce((acc, s) => acc + s.completed, 0);
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }, [stats]);

  // Weekly completion for weekly habits
  const weeklyCompletionMap = useMemo(() => {
    const map: Record<string, number> = {};
    const startOfWeek = new Date(todayDate);
    const dayOfWeek = startOfWeek.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(startOfWeek.getDate() - diff);

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      const dateKey = formatDateKey(d.getFullYear(), d.getMonth(), d.getDate());
      const dayLogs = logs[dateKey] ?? [];

      for (const log of dayLogs) {
        if (log.completed) {
          map[log.habitId] = (map[log.habitId] ?? 0) + 1;
        }
      }
    }
    return map;
  }, [logs, todayDate]);

  // Calendar grid data
  const calDaysInMonth = useMemo(
    () => getDaysInMonth(calYear, calMonth),
    [calYear, calMonth],
  );

  const calendarGridData = useMemo(() => {
    const now = new Date();
    const todayDay = now.getDate();
    const todayMonth = now.getMonth();
    const todayYear = now.getFullYear();

    return activeHabits.map((habit) => {
      const days = Array.from({ length: calDaysInMonth }, (_, i) => {
        const day = i + 1;
        const dateKey = formatDateKey(calYear, calMonth, day);
        const dayLogs = logs[dateKey] ?? [];
        const completed = dayLogs.some(
          (l) => l.habitId === habit.id && l.completed,
        );
        const isFuture =
          calYear > todayYear ||
          (calYear === todayYear && calMonth > todayMonth) ||
          (calYear === todayYear && calMonth === todayMonth && day > todayDay);
        const isToday =
          calYear === todayYear && calMonth === todayMonth && day === todayDay;

        return { day, dateKey, completed, isFuture, isToday };
      });

      // Calculate monthly completion for this habit
      const completedDays = days.filter((d) => d.completed).length;
      const pastDays = days.filter((d) => !d.isFuture).length;
      const pct = pastDays > 0 ? Math.round((completedDays / pastDays) * 100) : 0;

      return { habit, days, pct };
    });
  }, [activeHabits, logs, calYear, calMonth, calDaysInMonth]);

  // Monthly stats for bar chart
  const monthlyBarData = useMemo(() => {
    return calendarGridData.map((row) => {
      const cat = habitCategories[row.habit.category as keyof typeof habitCategories] ?? habitCategories.personal;
      return {
        label: `${cat.icon} ${row.habit.name}`,
        value: row.pct,
        color: cat.color,
      };
    });
  }, [calendarGridData]);

  // Best & worst habit
  const bestHabit = useMemo(() => {
    if (monthlyBarData.length === 0) return null;
    return monthlyBarData.reduce((best, h) => h.value > best.value ? h : best);
  }, [monthlyBarData]);

  const worstHabit = useMemo(() => {
    if (monthlyBarData.length === 0) return null;
    return monthlyBarData.reduce((worst, h) => h.value < worst.value ? h : worst);
  }, [monthlyBarData]);

  // Daily completion % for line chart (analytics slide)
  const dailyCompletionPcts = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const daysCount = getDaysInMonth(currentYear, currentMonth);
    const todayDay = now.getDate();

    return Array.from({ length: Math.min(daysCount, todayDay) }, (_, i) => {
      const day = i + 1;
      const dateKey = formatDateKey(currentYear, currentMonth, day);
      const dayLogs = logs[dateKey] ?? [];
      if (dailyHabits.length === 0) return 0;
      const done = dailyHabits.filter((h) =>
        dayLogs.some((l) => l.habitId === h.id && l.completed),
      ).length;
      return Math.round((done / dailyHabits.length) * 100);
    });
  }, [logs, dailyHabits]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const catMap: Record<string, { done: number; total: number }> = {};
    const now = new Date();
    const todayDay = now.getDate();

    for (const habit of activeHabits) {
      if (!catMap[habit.category]) {
        catMap[habit.category] = { done: 0, total: 0 };
      }
    }

    for (let day = 1; day <= todayDay; day++) {
      const dateKey = formatDateKey(now.getFullYear(), now.getMonth(), day);
      const dayLogs = logs[dateKey] ?? [];

      for (const habit of dailyHabits) {
        if (!catMap[habit.category]) continue;
        catMap[habit.category].total++;
        if (dayLogs.some((l) => l.habitId === habit.id && l.completed)) {
          catMap[habit.category].done++;
        }
      }
    }

    return Object.entries(catMap).map(([key, val]) => {
      const cat = habitCategories[key as keyof typeof habitCategories] ?? habitCategories.personal;
      return {
        label: `${cat.icon} ${cat.label}`,
        value: val.total > 0 ? Math.round((val.done / val.total) * 100) : 0,
        color: cat.color,
      };
    }).sort((a, b) => b.value - a.value);
  }, [activeHabits, dailyHabits, logs]);

  // Weekly mood data
  const weeklyMoodData = useMemo(() => {
    const data: number[] = [];
    const labels: string[] = [];
    const d = new Date(todayDate);
    const dayOfWeek = d.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setDate(d.getDate() - diff);

    for (let i = 0; i < 7; i++) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() + i);
      const dateKey = formatDateKey(dd.getFullYear(), dd.getMonth(), dd.getDate());
      const entry = journalEntries.find((e) => e.date === dateKey);
      data.push(entry?.mood ?? 0);
      labels.push(WEEKDAY_NAMES_SHORT[i]);
    }
    return { data, labels };
  }, [journalEntries, todayDate]);

  // Weekly sleep data
  const weeklySleepData = useMemo(() => {
    const data: number[] = [];
    const labels: string[] = [];
    const d = new Date(todayDate);
    const dayOfWeek = d.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setDate(d.getDate() - diff);

    for (let i = 0; i < 7; i++) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() + i);
      const dateKey = formatDateKey(dd.getFullYear(), dd.getMonth(), dd.getDate());
      const entry = journalEntries.find((e) => e.date === dateKey);
      data.push(entry?.sleepHours ?? 0);
      labels.push(WEEKDAY_NAMES_SHORT[i]);
    }
    return { data, labels };
  }, [journalEntries, todayDate]);

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchHabits();
    fetchStats(getMonthKey(todayDate.getFullYear(), todayDate.getMonth()));
    fetchJournalEntry(today);
    fetchMonthEntries(getMonthKey(todayDate.getFullYear(), todayDate.getMonth()));
  }, []);

  // ─── Callbacks ────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchHabits(),
        fetchStats(getMonthKey(todayDate.getFullYear(), todayDate.getMonth())),
        fetchJournalEntry(today),
        fetchMonthEntries(getMonthKey(todayDate.getFullYear(), todayDate.getMonth())),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchHabits, fetchStats, fetchJournalEntry, fetchMonthEntries, today, todayDate]);

  const handleToggleHabit = useCallback(
    async (habitId: string, completed: boolean) => {
      hapticLight();
      try {
        await toggleHabitLog(habitId, today, completed);
      } catch {
        Alert.alert('Ошибка', 'Не удалось отметить привычку');
      }
    },
    [toggleHabitLog, today],
  );

  const handleDeleteHabit = useCallback(
    (habitId: string) => {
      const habit = habits.find((h) => h.id === habitId);
      Alert.alert(
        'Удалить привычку',
        `Вы уверены, что хотите удалить "${habit?.name ?? 'привычку'}"?`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Удалить',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteHabit(habitId);
              } catch {
                Alert.alert('Ошибка', 'Не удалось удалить привычку');
              }
            },
          },
        ],
      );
    },
    [habits, deleteHabit],
  );

  const handleEditHabit = useCallback(
    (habitId: string) => {
      const habit = habits.find((h) => h.id === habitId);
      if (!habit) return;
      setEditingHabitId(habitId);
      setEditName(habit.name);
      setEditCategory(habit.category);
      setEditFrequency(habit.frequency);
      setShowEditModal(true);
    },
    [habits],
  );

  const handleCreateHabit = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert('Ошибка', 'Введите название привычки');
      return;
    }
    try {
      await createHabit({
        name: newName.trim(),
        category: newCategory,
        frequency: newFrequency,
      });
      setNewName('');
      setNewCategory('health');
      setNewFrequency('daily');
      setShowCreateModal(false);
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать привычку');
    }
  }, [newName, newCategory, newFrequency, createHabit]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingHabitId || !editName.trim()) return;
    try {
      await updateHabit(editingHabitId, {
        name: editName.trim(),
        category: editCategory,
        frequency: editFrequency,
      });
      setShowEditModal(false);
      setEditingHabitId(null);
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить привычку');
    }
  }, [editingHabitId, editName, editCategory, editFrequency, updateHabit]);

  const handleCalGridToggle = useCallback(
    async (habitId: string, dateKey: string, currentlyCompleted: boolean) => {
      try {
        await toggleHabitLog(habitId, dateKey, !currentlyCompleted);
      } catch {
        Alert.alert('Ошибка', 'Не удалось отметить привычку');
      }
    },
    [toggleHabitLog],
  );

  const handlePrevMonth = useCallback(() => {
    hapticSelection();
    setCalMonth((m) => {
      if (m === 0) {
        setCalYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    const now = new Date();
    if (calYear === now.getFullYear() && calMonth >= now.getMonth()) return;
    hapticSelection();
    setCalMonth((m) => {
      if (m === 11) {
        setCalYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, [calYear, calMonth]);

  const handleMoodChange = useCallback(
    async (mood: number) => {
      hapticSelection();
      await saveJournalEntry({ date: today, mood });
    },
    [saveJournalEntry, today],
  );

  const handleSleepChange = useCallback(
    async (hours: number) => {
      hapticSelection();
      await saveJournalEntry({ date: today, sleepHours: hours });
    },
    [saveJournalEntry, today],
  );

  const handleAddWater = useCallback(() => {
    hapticLight();
    setWaterGlasses((g) => Math.min(g + 1, waterTarget + 4));
  }, []);

  const handleRemoveWater = useCallback(() => {
    hapticLight();
    setWaterGlasses((g) => Math.max(g - 1, 0));
  }, []);

  const handleOpenCreateModal = useCallback(() => setShowCreateModal(true), []);
  const handleCloseCreateModal = useCallback(() => setShowCreateModal(false), []);
  const handleCloseEditModal = useCallback(() => {
    setShowEditModal(false);
    setEditingHabitId(null);
  }, []);

  // ─── SlideTabs Config ─────────────────────────────────────────────────────

  const tabs = useMemo(
    () => [
      { key: 'overview', title: '📊 Обзор' },
      { key: 'calendar', title: '📅 Календарь' },
      { key: 'analytics', title: '📈 Аналитика' },
    ],
    [],
  );

  // ─── Render Helpers ───────────────────────────────────────────────────────

  const renderHabitItem = useCallback(
    ({ item }: { item: typeof dailyHabits[number] }) => {
      const isCompleted = todayLogs.some(
        (l) => l.habitId === item.id && l.completed,
      );
      const habitStat = stats.find((s) => s.habitId === item.id);
      const streak = habitStat?.streak ?? 0;

      return (
        <HabitCard
          habitId={item.id}
          name={item.name}
          category={item.category}
          frequency={item.frequency}
          isCompleted={isCompleted}
          streak={streak}
          onToggle={handleToggleHabit}
          onDelete={handleDeleteHabit}
          onEdit={handleEditHabit}
          c={c}
        />
      );
    },
    [todayLogs, stats, handleToggleHabit, handleDeleteHabit, handleEditHabit, c],
  );

  const keyExtractor = useCallback((item: { id: string }) => item.id, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLIDE 1: Overview
  // ═══════════════════════════════════════════════════════════════════════════

  const renderOverview = useMemo(() => (
    <ScrollView
      style={styles.slide}
      contentContainerStyle={styles.slideContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={c.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Привычки</Text>
          <Text style={styles.subtitle}>
            {todayCompleted}/{todayTotal} выполнено сегодня
          </Text>
        </View>
        <View style={styles.streakBadge}>
          <Text style={styles.streakText}>{'🔥'} {currentStreak}</Text>
        </View>
      </View>

      {/* Progress Ring */}
      <View style={styles.progressSection}>
        <ProgressRing
          progress={todayProgress}
          size={140}
          strokeWidth={12}
          color={todayProgress >= 1 ? '#22C55E' : c.primary}
        />
        <View style={styles.progressLabel}>
          <Text style={styles.progressPct}>{Math.round(todayProgress * 100)}%</Text>
          <Text style={styles.progressHint}>
            {todayProgress >= 1
              ? 'Все выполнено!'
              : todayProgress >= 0.5
                ? 'Больше половины!'
                : 'Продолжай!'}
          </Text>
        </View>
      </View>

      {/* Streak Display */}
      {currentStreak > 0 && (
        <View style={styles.streakCard}>
          <Text style={{ fontSize: 32 }}>{'🔥'}</Text>
          <View style={{ marginLeft: spacing.md }}>
            <Text style={styles.streakTitle}>Серия: {currentStreak} дней</Text>
            <Text style={styles.streakDesc}>
              {currentStreak >= 30
                ? 'Невероятно! Ты машина!'
                : currentStreak >= 14
                  ? 'Отличная серия, не останавливайся!'
                  : currentStreak >= 7
                    ? 'Неделя подряд! Так держать!'
                    : 'Хорошее начало!'}
            </Text>
          </View>
        </View>
      )}

      {/* Daily Habits */}
      {dailyHabits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ежедневные привычки</Text>
          {dailyHabits.map((habit, index) => {
            const isCompleted = todayLogs.some(
              (l) => l.habitId === habit.id && l.completed,
            );
            const habitStat = stats.find((s) => s.habitId === habit.id);
            return (
              <FadeInView key={habit.id} delay={index * 50}>
                <HabitCard
                  habitId={habit.id}
                  name={habit.name}
                  category={habit.category}
                  frequency={habit.frequency}
                  isCompleted={isCompleted}
                  streak={habitStat?.streak ?? 0}
                  onToggle={handleToggleHabit}
                  onDelete={handleDeleteHabit}
                  onEdit={handleEditHabit}
                  c={c}
                />
              </FadeInView>
            );
          })}
        </View>
      )}

      {/* Weekly Habits */}
      {weeklyHabits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Еженедельные привычки</Text>
          {weeklyHabits.map((habit, index) => (
            <FadeInView key={habit.id} delay={index * 50}>
              <WeeklyHabitRow
                name={habit.name}
                category={habit.category}
                completedThisWeek={weeklyCompletionMap[habit.id] ?? 0}
                target={3}
                c={c}
              />
            </FadeInView>
          ))}
        </View>
      )}

      {/* Monthly Habits */}
      {monthlyHabits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ежемесячные привычки</Text>
          {monthlyHabits.map((habit, index) => {
            const isCompleted = todayLogs.some(
              (l) => l.habitId === habit.id && l.completed,
            );
            const habitStat = stats.find((s) => s.habitId === habit.id);
            return (
              <FadeInView key={habit.id} delay={index * 50}>
                <HabitCard
                  habitId={habit.id}
                  name={habit.name}
                  category={habit.category}
                  frequency={habit.frequency}
                  isCompleted={isCompleted}
                  streak={habitStat?.streak ?? 0}
                  onToggle={handleToggleHabit}
                  onDelete={handleDeleteHabit}
                  onEdit={handleEditHabit}
                  c={c}
                />
              </FadeInView>
            );
          })}
        </View>
      )}

      {/* Stats Row */}
      <FadeInView delay={100}>
        <View style={styles.statsRow}>
          <StatCard
            label="Лучшая серия"
            value={`${bestStreak} дн.`}
            icon="🏆"
            color="#F59E0B"
            style={styles.statItem}
          />
          <StatCard
            label="Выполнено"
            value={monthTotalCompleted}
            icon="✅"
            color="#22C55E"
            style={styles.statItem}
          />
          <StatCard
            label="За месяц"
            value={`${monthCompletionPct}%`}
            icon="📊"
            color={c.primary}
            style={styles.statItem}
          />
        </View>
      </FadeInView>

      {/* Empty State */}
      {activeHabits.length === 0 && !isLoading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>{'🌱'}</Text>
          <Text style={styles.emptyTitle}>Нет привычек</Text>
          <Text style={styles.emptyDesc}>
            Создайте первую привычку, нажав кнопку ниже
          </Text>
          <Button
            title="Создать привычку"
            onPress={handleOpenCreateModal}
            style={{ marginTop: spacing.md }}
          />
        </View>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  ), [
    styles, c, refreshing, handleRefresh, todayCompleted, todayTotal,
    currentStreak, todayProgress, dailyHabits, weeklyHabits, monthlyHabits,
    todayLogs, stats, handleToggleHabit, handleDeleteHabit, handleEditHabit,
    weeklyCompletionMap, bestStreak, monthTotalCompleted, monthCompletionPct,
    activeHabits, isLoading, handleOpenCreateModal,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLIDE 2: Calendar Grid
  // ═══════════════════════════════════════════════════════════════════════════

  const renderCalendar = useMemo(() => {
    const isCurrentMonth =
      calYear === todayDate.getFullYear() && calMonth === todayDate.getMonth();
    const avgPct =
      calendarGridData.length > 0
        ? Math.round(
            calendarGridData.reduce((sum, r) => sum + r.pct, 0) /
              calendarGridData.length,
          )
        : 0;

    return (
      <ScrollView
        style={styles.slide}
        contentContainerStyle={styles.slideContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Month Navigator */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={handlePrevMonth} style={styles.monthArrow}>
            <Text style={styles.monthArrowText}>{'‹'}</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>
            {MONTH_NAMES_RU[calMonth]} {calYear}
          </Text>
          <TouchableOpacity
            onPress={handleNextMonth}
            disabled={isCurrentMonth}
            style={[styles.monthArrow, isCurrentMonth && { opacity: 0.3 }]}
          >
            <Text style={styles.monthArrowText}>{'›'}</Text>
          </TouchableOpacity>
        </View>

        {/* Grid Table */}
        {calendarGridData.length > 0 ? (
          <View style={styles.gridContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* Header row: day numbers */}
                <View style={styles.gridRow}>
                  <View style={styles.gridHabitLabel}>
                    <Text style={styles.gridHabitLabelText}>Привычка</Text>
                  </View>
                  {Array.from({ length: calDaysInMonth }, (_, i) => (
                    <View key={i} style={styles.gridDayHeader}>
                      <Text style={[
                        styles.gridDayHeaderText,
                        i + 1 === todayDate.getDate() &&
                          calMonth === todayDate.getMonth() &&
                          calYear === todayDate.getFullYear() && {
                            color: c.primary,
                            fontWeight: '800',
                          },
                      ]}>
                        {i + 1}
                      </Text>
                    </View>
                  ))}
                  <View style={styles.gridPctCol}>
                    <Text style={styles.gridPctHeaderText}>%</Text>
                  </View>
                </View>

                {/* Habit rows */}
                {calendarGridData.map((row) => {
                  const cat = habitCategories[
                    row.habit.category as keyof typeof habitCategories
                  ] ?? habitCategories.personal;

                  return (
                    <View key={row.habit.id} style={styles.gridRow}>
                      <View style={styles.gridHabitLabel}>
                        <Text style={styles.gridHabitIcon}>{cat.icon}</Text>
                        <Text
                          style={styles.gridHabitName}
                          numberOfLines={1}
                        >
                          {row.habit.name}
                        </Text>
                      </View>
                      {row.days.map((day) => (
                        <GridCell
                          key={day.day}
                          completed={day.completed}
                          isFuture={day.isFuture}
                          isToday={day.isToday}
                          onPress={() =>
                            handleCalGridToggle(
                              row.habit.id,
                              day.dateKey,
                              day.completed,
                            )
                          }
                          color={cat.color}
                          emptyColor={c.surface}
                          missedColor={c.surfaceLight ?? c.border}
                          todayBorder={c.primary}
                        />
                      ))}
                      <View style={styles.gridPctCol}>
                        <Text style={[
                          styles.gridPctText,
                          {
                            color:
                              row.pct >= 80
                                ? '#22C55E'
                                : row.pct >= 50
                                  ? '#F59E0B'
                                  : '#EF4444',
                          },
                        ]}>
                          {row.pct}%
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>{'📅'}</Text>
            <Text style={styles.emptyTitle}>Нет данных</Text>
            <Text style={styles.emptyDesc}>Создайте привычки для отображения календаря</Text>
          </View>
        )}

        {/* Monthly Stats Below Grid */}
        {calendarGridData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Статистика за месяц</Text>

            {/* Average */}
            <FadeInView delay={50}>
            <View style={styles.monthAvgRow}>
              <Text style={styles.monthAvgLabel}>Средний результат</Text>
              <Text style={[styles.monthAvgValue, {
                color: avgPct >= 80 ? '#22C55E' : avgPct >= 50 ? '#F59E0B' : '#EF4444',
              }]}>
                {avgPct}%
              </Text>
            </View>
            </FadeInView>

            {/* Per-habit bar chart */}
            <FadeInView delay={100}>
            <MonthBarChart data={monthlyBarData} c={c} />
            </FadeInView>

            {/* Best & Worst */}
            <FadeInView delay={150}>
            <View style={styles.bestWorstRow}>
              {bestHabit && (
                <View style={[styles.bestWorstCard, { borderLeftColor: '#22C55E' }]}>
                  <Text style={styles.bestWorstLabel}>{'🏆'} Лучшая</Text>
                  <Text style={styles.bestWorstName} numberOfLines={1}>
                    {bestHabit.label}
                  </Text>
                  <Text style={[styles.bestWorstPct, { color: '#22C55E' }]}>
                    {Math.round(bestHabit.value)}%
                  </Text>
                </View>
              )}
              {worstHabit && (
                <View style={[styles.bestWorstCard, { borderLeftColor: '#EF4444' }]}>
                  <Text style={styles.bestWorstLabel}>{'📉'} Худшая</Text>
                  <Text style={styles.bestWorstName} numberOfLines={1}>
                    {worstHabit.label}
                  </Text>
                  <Text style={[styles.bestWorstPct, { color: '#EF4444' }]}>
                    {Math.round(worstHabit.value)}%
                  </Text>
                </View>
              )}
            </View>
            </FadeInView>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }, [
    styles, c, calMonth, calYear, todayDate, calDaysInMonth,
    calendarGridData, monthlyBarData, bestHabit, worstHabit,
    handlePrevMonth, handleNextMonth, handleCalGridToggle,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLIDE 3: Analytics
  // ═══════════════════════════════════════════════════════════════════════════

  const renderAnalytics = useMemo(() => (
    <ScrollView
      style={styles.slide}
      contentContainerStyle={styles.slideContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Mood Tracker */}
      <FadeInView delay={0}>
      <View style={styles.analyticsCard}>
        <Text style={styles.analyticsCardTitle}>{'😊'} Настроение сегодня</Text>
        <MoodSelector
          value={todayEntry?.mood ?? null}
          onChange={handleMoodChange}
          c={c}
        />
        {weeklyMoodData.data.some((d) => d > 0) && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.analyticsSubTitle}>Настроение за неделю</Text>
            <WeeklyMiniGraph
              data={weeklyMoodData.data}
              labels={weeklyMoodData.labels}
              color="#8B5CF6"
              c={c}
            />
          </View>
        )}
      </View>
      </FadeInView>

      {/* Sleep Tracker */}
      <FadeInView delay={80}>
      <View style={styles.analyticsCard}>
        <Text style={styles.analyticsCardTitle}>{'🌙'} Сон</Text>
        <SleepInput
          value={todayEntry?.sleepHours ?? null}
          onChange={handleSleepChange}
          c={c}
        />
        {weeklySleepData.data.some((d) => d > 0) && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.analyticsSubTitle}>Сон за неделю</Text>
            <WeeklyMiniGraph
              data={weeklySleepData.data}
              labels={weeklySleepData.labels}
              color="#3B82F6"
              c={c}
            />
          </View>
        )}
      </View>
      </FadeInView>

      {/* Water Tracker */}
      <FadeInView delay={160}>
      <View style={styles.analyticsCard}>
        <Text style={styles.analyticsCardTitle}>{'💧'} Вода</Text>
        <WaterTracker
          glasses={waterGlasses}
          target={waterTarget}
          onAdd={handleAddWater}
          onRemove={handleRemoveWater}
          c={c}
        />
      </View>
      </FadeInView>

      {/* Daily Completion Line Chart */}
      {dailyCompletionPcts.length > 0 && (
        <FadeInView delay={240}>
        <View style={styles.analyticsCard}>
          <Text style={styles.analyticsCardTitle}>
            {'📈'} Выполнение привычек (%)
          </Text>
          <Text style={styles.analyticsSubTitle}>
            {MONTH_NAMES_RU[todayDate.getMonth()]} {todayDate.getFullYear()}
          </Text>
          <SimpleLineChart
            data={dailyCompletionPcts}
            color={c.primary}
            c={c}
            height={120}
          />
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: spacing.xs,
          }}>
            <Text style={{ fontSize: 9, color: c.textSecondary }}>1</Text>
            <Text style={{ fontSize: 9, color: c.textSecondary }}>
              {dailyCompletionPcts.length}
            </Text>
          </View>
        </View>
        </FadeInView>
      )}

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <FadeInView delay={320}>
        <View style={styles.analyticsCard}>
          <Text style={styles.analyticsCardTitle}>
            {'🏷️'} По категориям
          </Text>
          <MonthBarChart data={categoryBreakdown} c={c} />
        </View>
        </FadeInView>
      )}

      {/* Reflections */}
      <FadeInView delay={400}>
      <View style={styles.analyticsCard}>
        <Text style={styles.analyticsCardTitle}>{'💭'} Рефлексия</Text>

        <Text style={styles.reflectionLabel}>
          Что получилось на этой неделе?
        </Text>
        <TextInput
          style={styles.reflectionInput}
          value={reflectionGood}
          onChangeText={setReflectionGood}
          placeholder="Напишите свои мысли..."
          placeholderTextColor={c.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        <Text style={[styles.reflectionLabel, { marginTop: spacing.md }]}>
          Над чем стоит поработать?
        </Text>
        <TextInput
          style={styles.reflectionInput}
          value={reflectionImprove}
          onChangeText={setReflectionImprove}
          placeholder="Что можно улучшить..."
          placeholderTextColor={c.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>
      </FadeInView>

      <View style={{ height: 100 }} />
    </ScrollView>
  ), [
    styles, c, todayEntry, handleMoodChange, handleSleepChange,
    weeklyMoodData, weeklySleepData, waterGlasses, waterTarget,
    handleAddWater, handleRemoveWater, dailyCompletionPcts,
    categoryBreakdown, reflectionGood, reflectionImprove, todayDate,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // MODALS
  // ═══════════════════════════════════════════════════════════════════════════

  const renderCreateModal = useMemo(() => (
    <Modal
      visible={showCreateModal}
      onClose={handleCloseCreateModal}
      title="Новая привычка"
    >
      <View style={styles.modalContent}>
        <Text style={styles.modalLabel}>Название</Text>
        <Input
          value={newName}
          onChangeText={setNewName}
          placeholder="Например: Утренняя зарядка"
        />

        <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>
          Категория
        </Text>
        <View style={styles.chipRow}>
          {CATEGORY_KEYS.map((key) => {
            const cat = habitCategories[key];
            const isSelected = newCategory === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setNewCategory(key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? cat.color + '20' : c.surface,
                    borderColor: isSelected ? cat.color : c.border,
                  },
                ]}
              >
                <Text style={styles.chipIcon}>{cat.icon}</Text>
                <Text style={[styles.chipText, isSelected && { color: cat.color }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>
          Частота
        </Text>
        <View style={styles.chipRow}>
          {FREQUENCY_OPTIONS.map((opt) => {
            const isSelected = newFrequency === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setNewFrequency(opt.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? c.primary + '20' : c.surface,
                    borderColor: isSelected ? c.primary : c.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, isSelected && { color: c.primary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Button
          title="Создать привычку"
          onPress={handleCreateHabit}
          style={{ marginTop: spacing.lg }}
        />
      </View>
    </Modal>
  ), [showCreateModal, newName, newCategory, newFrequency, handleCreateHabit, handleCloseCreateModal, c, styles]);

  const renderEditModal = useMemo(() => (
    <Modal
      visible={showEditModal}
      onClose={handleCloseEditModal}
      title="Редактировать привычку"
    >
      <View style={styles.modalContent}>
        <Text style={styles.modalLabel}>Название</Text>
        <Input
          value={editName}
          onChangeText={setEditName}
          placeholder="Название привычки"
        />

        <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>
          Категория
        </Text>
        <View style={styles.chipRow}>
          {CATEGORY_KEYS.map((key) => {
            const cat = habitCategories[key];
            const isSelected = editCategory === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setEditCategory(key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? cat.color + '20' : c.surface,
                    borderColor: isSelected ? cat.color : c.border,
                  },
                ]}
              >
                <Text style={styles.chipIcon}>{cat.icon}</Text>
                <Text style={[styles.chipText, isSelected && { color: cat.color }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>
          Частота
        </Text>
        <View style={styles.chipRow}>
          {FREQUENCY_OPTIONS.map((opt) => {
            const isSelected = editFrequency === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setEditFrequency(opt.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? c.primary + '20' : c.surface,
                    borderColor: isSelected ? c.primary : c.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, isSelected && { color: c.primary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <Button
            title="Сохранить"
            onPress={handleSaveEdit}
            style={{ flex: 1 }}
          />
          <Button
            title="Отмена"
            onPress={handleCloseEditModal}
            variant="outline"
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  ), [showEditModal, editName, editCategory, editFrequency, handleSaveEdit, handleCloseEditModal, c, styles]);

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SlideTabs tabs={tabs}>
        {renderOverview}
        {renderCalendar}
        {renderAnalytics}
      </SlideTabs>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={handleOpenCreateModal}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Voice */}
      <VoiceButton
        onPressIn={startRecording}
        onPressOut={stopRecording}
        isRecording={isRecording}
        isProcessing={isProcessing}
        amplitude={amplitude}
        style={styles.floatingVoice}
      />

      {/* Modals */}
      {renderCreateModal}
      {renderEditModal}
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

function createStyles(c: C) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    slide: {
      flex: 1,
      width: SCREEN_WIDTH,
    },
    slideContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },

    // ─── Header ─────────────────────────────────────────────────────────────
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    title: {
      fontSize: fontSize.xxl,
      fontWeight: '800',
      color: c.text,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: 2,
    },
    streakBadge: {
      backgroundColor: '#F59E0B' + '20',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: '#F59E0B' + '40',
    },
    streakText: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: '#F59E0B',
    },

    // ─── Progress ───────────────────────────────────────────────────────────
    progressSection: {
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    progressLabel: {
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    progressPct: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: c.text,
    },
    progressHint: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: 2,
    },

    // ─── Streak Card ────────────────────────────────────────────────────────
    streakCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#F59E0B' + '10',
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      marginBottom: spacing.lg,
      borderWidth: 1,
      borderColor: '#F59E0B' + '30',
    },
    streakTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: '#F59E0B',
    },
    streakDesc: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 2,
    },

    // ─── Section ────────────────────────────────────────────────────────────
    section: {
      marginBottom: spacing.lg,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.md,
    },

    // ─── Stats Row ──────────────────────────────────────────────────────────
    statsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    statItem: {
      flex: 1,
    },

    // ─── Empty State ────────────────────────────────────────────────────────
    emptyState: {
      alignItems: 'center',
      paddingVertical: spacing.xl * 2,
    },
    emptyEmoji: {
      fontSize: 64,
      marginBottom: spacing.md,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
    },
    emptyDesc: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing.xl,
    },

    // ─── Month Navigator ────────────────────────────────────────────────────
    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
      gap: spacing.lg,
    },
    monthArrow: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthArrowText: {
      fontSize: 24,
      color: c.text,
      fontWeight: '600',
    },
    monthTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      minWidth: 180,
      textAlign: 'center',
    },

    // ─── Calendar Grid ──────────────────────────────────────────────────────
    gridContainer: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.sm,
      marginBottom: spacing.lg,
    },
    gridRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 32,
    },
    gridHabitLabel: {
      width: 100,
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: spacing.xs,
    },
    gridHabitLabelText: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '600',
    },
    gridHabitIcon: {
      fontSize: 12,
      marginRight: 4,
    },
    gridHabitName: {
      fontSize: 10,
      color: c.text,
      fontWeight: '500',
      flex: 1,
    },
    gridDayHeader: {
      width: 30,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
    },
    gridDayHeaderText: {
      fontSize: 9,
      color: c.textSecondary,
      fontWeight: '600',
    },
    gridPctCol: {
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: spacing.xs,
    },
    gridPctHeaderText: {
      fontSize: 10,
      color: c.textSecondary,
      fontWeight: '700',
    },
    gridPctText: {
      fontSize: 10,
      fontWeight: '700',
    },

    // ─── Month Stats ────────────────────────────────────────────────────────
    monthAvgRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    monthAvgLabel: {
      fontSize: fontSize.sm,
      color: c.text,
      fontWeight: '600',
    },
    monthAvgValue: {
      fontSize: fontSize.xl,
      fontWeight: '800',
    },
    bestWorstRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    bestWorstCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderLeftWidth: 3,
    },
    bestWorstLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginBottom: 4,
    },
    bestWorstName: {
      fontSize: fontSize.xs,
      color: c.text,
      fontWeight: '600',
      marginBottom: 2,
    },
    bestWorstPct: {
      fontSize: fontSize.lg,
      fontWeight: '800',
    },

    // ─── Analytics Cards ────────────────────────────────────────────────────
    analyticsCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    analyticsCardTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.md,
    },
    analyticsSubTitle: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '600',
      marginBottom: spacing.xs,
    },

    // ─── Reflections ────────────────────────────────────────────────────────
    reflectionLabel: {
      fontSize: fontSize.sm,
      color: c.text,
      fontWeight: '600',
      marginBottom: spacing.xs,
    },
    reflectionInput: {
      backgroundColor: c.background,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      fontSize: fontSize.sm,
      color: c.text,
      minHeight: 80,
    },

    // ─── Modal ──────────────────────────────────────────────────────────────
    modalContent: {
      paddingTop: spacing.sm,
    },
    modalLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.sm,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      borderWidth: 1.5,
      gap: 4,
    },
    chipIcon: {
      fontSize: 14,
    },
    chipText: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.textSecondary,
    },

    // ─── FAB ────────────────────────────────────────────────────────────────
    fab: {
      position: 'absolute',
      bottom: 90,
      right: spacing.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    fabText: {
      fontSize: 28,
      color: '#fff',
      fontWeight: '600',
      lineHeight: 30,
    },
    floatingVoice: {
      position: 'absolute',
      bottom: 90,
      right: 20,
    },
  });
}
