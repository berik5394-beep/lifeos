import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Alert,
  RefreshControl,
  Dimensions,
  TextInput,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Card,
  Button,
  Input,
  Modal,
  Checkbox,
  SlideTabs,
  AnimatedProgressBar,
  StatCard,
} from '@/components/ui';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { VoiceButton } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { spacing, borderRadius, fontSize, taskCategories, priorities } from '@/constants';
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { useFinanceStore } from '@/stores/finance-store';
import { useUIStore } from '@/stores/ui-store';
import { getWeekDays, formatDate, isToday } from '@/utils/dates';
import { useColors } from '@/hooks/use-colors';
import { QuickAddBar } from '@/components/ui/quick-add-bar';
import { TagChip } from '@/components/ui/tag-chip';

// ─── Constants ───────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;

const RUSSIAN_MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

const RUSSIAN_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

const RUSSIAN_DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const RUSSIAN_DAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
] as const;

const CATEGORY_KEYS = Object.keys(taskCategories) as Array<keyof typeof taskCategories>;
const PRIORITY_KEYS = Object.keys(priorities) as Array<keyof typeof priorities>;

const SLIDE_TABS = [
  { key: 'dashboard', title: 'Дашборд', icon: '📊' },
  { key: 'week', title: 'Неделя', icon: '📅' },
  { key: 'insights', title: 'Инсайты', icon: '📈' },
];

interface ViewModeItem {
  key: string;
  label: string;
  icon: 'list' | 'columns' | 'bar-chart-2' | 'crosshair' | 'tag';
  route?: string;
  featureFlag?: string;
}

const VIEW_MODES: ViewModeItem[] = [
  { key: 'list', label: 'Список', icon: 'list' },
  { key: 'kanban', label: 'Канбан', icon: 'columns', route: 'KanbanBoard', featureFlag: 'kanban_view' },
  { key: 'gantt', label: 'Таймлайн', icon: 'bar-chart-2', route: 'GanttView', featureFlag: 'gantt_view' },
  { key: 'focus', label: 'Фокус', icon: 'crosshair', route: 'FocusMode' },
  { key: 'tags', label: 'Теги', icon: 'tag', route: 'TagManager' },
];

// ─── Helper Types ────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  category: string;
  priority: string;
  date: string;
  time: string | null;
  completed: boolean;
  notes: string | null;
  createdAt: string;
  taskTags?: Array<{ id: string; tag: { id: string; name: string; color: string } }>;
}

type TaskStatus = 'completed' | 'in_progress' | 'overdue';

// ─── Helper Functions ────────────────────────────────────────────────────────

function getTaskStatus(task: TaskItem): TaskStatus {
  if (task.completed) return 'completed';
  const taskDate = new Date(task.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  taskDate.setHours(0, 0, 0, 0);
  if (taskDate < today) return 'overdue';
  return 'in_progress';
}

function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'completed': return 'Выполнено';
    case 'in_progress': return 'В процессе';
    case 'overdue': return 'Просрочено';
  }
}

function getStatusIcon(status: TaskStatus): string {
  switch (status) {
    case 'completed': return '\u2705';
    case 'in_progress': return '\u23F3';
    case 'overdue': return '\u274C';
  }
}

function getDaysRemaining(dateStr: string): number {
  const taskDate = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  taskDate.setHours(0, 0, 0, 0);
  const diff = taskDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()} ${RUSSIAN_MONTHS_GENITIVE[d.getMonth()]}`;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(date: Date): string {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.getDate()} ${RUSSIAN_MONTHS_GENITIVE[monday.getMonth()]} — ${sunday.getDate()} ${RUSSIAN_MONTHS_GENITIVE[sunday.getMonth()]}`;
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getBestDay(tasks: TaskItem[]): string {
  const dayMap: Record<number, { total: number; done: number }> = {};
  for (const t of tasks) {
    const d = new Date(t.date).getDay();
    const idx = d === 0 ? 6 : d - 1;
    if (!dayMap[idx]) dayMap[idx] = { total: 0, done: 0 };
    dayMap[idx].total++;
    if (t.completed) dayMap[idx].done++;
  }
  let bestIdx = 0;
  let bestRate = 0;
  for (const [idx, val] of Object.entries(dayMap)) {
    const rate = val.total > 0 ? val.done / val.total : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestIdx = Number(idx);
    }
  }
  return RUSSIAN_DAYS_FULL[bestIdx];
}

// ─── Memoized Sub-Components ─────────────────────────────────────────────────

interface TaskRowProps {
  task: TaskItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskItem) => void;
  colors: ReturnType<typeof useColors>;
}

const TaskRow = React.memo(function TaskRow({
  task,
  onToggle,
  onDelete,
  onEdit,
  colors: c,
}: TaskRowProps) {
  const status = getTaskStatus(task);
  const daysLeft = getDaysRemaining(task.date);
  const catInfo = taskCategories[task.category as keyof typeof taskCategories];
  const prioInfo = priorities[task.priority as keyof typeof priorities];
  const styles = useMemo(() => createStyles(c), [c]);

  const handleToggle = useCallback(() => onToggle(task.id), [onToggle, task.id]);
  const handleDelete = useCallback(() => onDelete(task.id), [onDelete, task.id]);
  const handleEdit = useCallback(() => onEdit(task), [onEdit, task]);

  return (
    <TouchableOpacity
      style={[styles.tableRow, task.completed && styles.tableRowCompleted]}
      onPress={handleToggle}
      onLongPress={handleEdit}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${task.completed ? 'выполнено' : 'не выполнено'}`}
      accessibilityHint="Нажмите для переключения, удерживайте для редактирования"
    >
      <View style={styles.tableCell_title}>
        <Text
          style={[styles.tableCellText, task.completed && styles.tableCellTextCompleted]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {task.taskTags && task.taskTags.length > 0 && (
          <View style={styles.taskTagsRow}>
            {task.taskTags.map((tt) => (
              <TagChip key={tt.id} name={tt.tag.name} color={tt.tag.color} size="small" />
            ))}
          </View>
        )}
      </View>
      <View style={styles.tableCell_priority}>
        <View style={[styles.priorityBadge, { backgroundColor: prioInfo?.color ?? c.border }]}>
          <Text style={styles.priorityBadgeText}>
            {prioInfo?.icon ?? ''} {prioInfo?.label ?? task.priority}
          </Text>
        </View>
      </View>
      <View style={styles.tableCell_status}>
        <Text style={[
          styles.statusText,
          status === 'completed' && { color: c.success },
          status === 'overdue' && { color: c.danger },
          status === 'in_progress' && { color: c.warning },
        ]}>
          {getStatusIcon(status)} {getStatusLabel(status)}
        </Text>
      </View>
      <View style={styles.tableCell_category}>
        <View style={[styles.categoryBadge, { backgroundColor: (catInfo?.color ?? c.border) + '20' }]}>
          <Text style={[styles.categoryBadgeText, { color: catInfo?.color ?? c.textSecondary }]}>
            {catInfo?.icon ?? ''} {catInfo?.label ?? task.category}
          </Text>
        </View>
      </View>
      <View style={styles.tableCell_date}>
        <Text style={styles.tableCellTextSmall}>{formatShortDate(task.createdAt)}</Text>
      </View>
      <View style={styles.tableCell_deadline}>
        <Text style={styles.tableCellTextSmall}>{formatShortDate(task.date)}</Text>
      </View>
      <View style={styles.tableCell_remaining}>
        <Text style={[
          styles.tableCellTextSmall,
          daysLeft < 0 && { color: c.danger },
          daysLeft === 0 && { color: c.warning },
          daysLeft > 0 && { color: c.success },
        ]}>
          {task.completed ? '—' : daysLeft < 0 ? `${Math.abs(daysLeft)} дн. назад` : daysLeft === 0 ? 'Сегодня' : `${daysLeft} дн.`}
        </Text>
      </View>
      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
        <Text style={styles.deleteButtonText}>{'\uD83D\uDDD1'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

// ─── Week Day Column Component ───────────────────────────────────────────────

interface WeekDayColumnProps {
  dayLabel: string;
  dayNum: number;
  date: Date;
  tasks: TaskItem[];
  isCurrentDay: boolean;
  onToggle: (id: string) => void;
  onAddTask: (date: Date) => void;
  colors: ReturnType<typeof useColors>;
}

const WeekDayColumn = React.memo(function WeekDayColumn({
  dayLabel,
  dayNum,
  date,
  tasks,
  isCurrentDay,
  onToggle,
  onAddTask,
  colors: c,
}: WeekDayColumnProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  const handleAdd = useCallback(() => onAddTask(date), [onAddTask, date]);

  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;

  return (
    <View style={[styles.weekDayColumn, isCurrentDay && styles.weekDayColumnActive]}>
      <View style={[styles.weekDayHeader, isCurrentDay && styles.weekDayHeaderActive]}>
        <Text style={[styles.weekDayLabel, isCurrentDay && styles.weekDayLabelActive]}>
          {dayLabel}
        </Text>
        <Text style={[styles.weekDayNum, isCurrentDay && styles.weekDayNumActive]}>
          {dayNum}
        </Text>
        {total > 0 && (
          <Text style={styles.weekDayCount}>
            {completed}/{total}
          </Text>
        )}
      </View>
      <View style={styles.weekDayTasks}>
        {tasks.map((task) => {
          const prioInfo = priorities[task.priority as keyof typeof priorities];
          return (
            <TouchableOpacity
              key={task.id}
              style={[
                styles.weekDayTask,
                { borderLeftColor: prioInfo?.color ?? c.border },
                task.completed && styles.weekDayTaskCompleted,
              ]}
              onPress={() => onToggle(task.id)}
              activeOpacity={0.7}
            >
              <View style={styles.weekDayTaskCheck}>
                <View style={[
                  styles.miniCheckbox,
                  task.completed && { backgroundColor: c.success, borderColor: c.success },
                ]}>
                  {task.completed && <Text style={styles.miniCheckmark}>{'\u2713'}</Text>}
                </View>
              </View>
              <Text
                style={[
                  styles.weekDayTaskText,
                  task.completed && styles.weekDayTaskTextCompleted,
                ]}
                numberOfLines={2}
              >
                {task.title}
              </Text>
            </TouchableOpacity>
          );
        })}
        {tasks.length === 0 && (
          <Text style={styles.weekDayEmpty}>Нет задач</Text>
        )}
      </View>
      <TouchableOpacity style={styles.weekDayAddButton} onPress={handleAdd}>
        <Text style={styles.weekDayAddButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
});

// ─── Stat Bar Chart Component ────────────────────────────────────────────────

interface BarChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  maxValue: number;
  colors: ReturnType<typeof useColors>;
}

const BarChart = React.memo(function BarChart({ data, maxValue, colors: c }: BarChartProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  const safeMax = maxValue || 1;

  return (
    <View style={styles.barChartContainer}>
      {data.map((item, idx) => (
        <View key={idx} style={styles.barChartItem}>
          <View style={styles.barChartBarWrapper}>
            <View
              style={[
                styles.barChartBar,
                {
                  height: `${Math.max((item.value / safeMax) * 100, 4)}%`,
                  backgroundColor: item.color,
                },
              ]}
            />
          </View>
          <Text style={styles.barChartLabel}>{item.label}</Text>
          <Text style={styles.barChartValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
});

// ─── Pie Chart Segment Component ─────────────────────────────────────────────

interface PieChartData {
  label: string;
  value: number;
  color: string;
}

interface MiniPieChartProps {
  data: PieChartData[];
  title: string;
  colors: ReturnType<typeof useColors>;
}

const MiniPieChart = React.memo(function MiniPieChart({ data, title, colors: c }: MiniPieChartProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <View style={styles.pieChartCard}>
      <Text style={styles.pieChartTitle}>{title}</Text>
      <View style={styles.pieChartVisual}>
        <View style={styles.pieChartCircle}>
          {total === 0 ? (
            <View style={[styles.pieChartSegmentFull, { backgroundColor: c.border }]} />
          ) : (
            data.map((item, idx) => {
              const percentage = (item.value / total) * 100;
              if (percentage === 0) return null;
              return (
                <View
                  key={idx}
                  style={[
                    styles.pieChartSegment,
                    {
                      backgroundColor: item.color,
                      width: `${percentage}%`,
                    },
                  ]}
                />
              );
            })
          )}
          <View style={[styles.pieChartCenter, { backgroundColor: c.surface }]}>
            <Text style={styles.pieChartCenterText}>{total}</Text>
          </View>
        </View>
      </View>
      <View style={styles.pieChartLegend}>
        {data.map((item, idx) => (
          <View key={idx} style={styles.pieChartLegendItem}>
            <View style={[styles.pieChartLegendDot, { backgroundColor: item.color }]} />
            <Text style={styles.pieChartLegendLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={styles.pieChartLegendValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
});

// ─── Category Chip Picker ────────────────────────────────────────────────────

interface ChipPickerProps {
  items: Array<{ key: string; label: string; icon: string; color: string }>;
  selected: string;
  onSelect: (key: string) => void;
  colors: ReturnType<typeof useColors>;
}

const ChipPicker = React.memo(function ChipPicker({ items, selected, onSelect, colors: c }: ChipPickerProps) {
  const styles = useMemo(() => createStyles(c), [c]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipPickerContainer}
    >
      {items.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={[
            styles.chip,
            selected === item.key && { backgroundColor: item.color + '30', borderColor: item.color },
          ]}
          onPress={() => onSelect(item.key)}
          activeOpacity={0.7}
        >
          <Text style={[
            styles.chipText,
            selected === item.key && { color: item.color },
          ]}>
            {item.icon} {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
});

// ─── Insight Row Component ───────────────────────────────────────────────────

interface InsightRowProps {
  icon: string;
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  colors: ReturnType<typeof useColors>;
}

const InsightRow = React.memo(function InsightRow({ icon, label, value, trend, colors: c }: InsightRowProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.insightRow}>
      <Text style={styles.insightIcon}>{icon}</Text>
      <Text style={styles.insightLabel}>{label}</Text>
      <View style={styles.insightValueContainer}>
        {trend === 'up' && <Text style={[styles.trendArrow, { color: c.success }]}>{'\u2191'}</Text>}
        {trend === 'down' && <Text style={[styles.trendArrow, { color: c.danger }]}>{'\u2193'}</Text>}
        <Text style={[
          styles.insightValue,
          trend === 'up' && { color: c.success },
          trend === 'down' && { color: c.danger },
        ]}>
          {value}
        </Text>
      </View>
    </View>
  );
});

// ─── Habit Mini Tracker ──────────────────────────────────────────────────────

interface HabitMiniRowProps {
  name: string;
  icon: string;
  daysCompleted: boolean[];
  colors: ReturnType<typeof useColors>;
}

const HabitMiniRow = React.memo(function HabitMiniRow({ name, icon, daysCompleted, colors: c }: HabitMiniRowProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.habitMiniRow}>
      <View style={styles.habitMiniLabel}>
        <Text style={styles.habitMiniIcon}>{icon}</Text>
        <Text style={styles.habitMiniName} numberOfLines={1}>{name}</Text>
      </View>
      <View style={styles.habitMiniDays}>
        {RUSSIAN_DAYS_SHORT.map((dayLabel, idx) => (
          <View key={idx} style={styles.habitMiniDayCell}>
            <View style={[
              styles.habitMiniCheckbox,
              daysCompleted[idx] && { backgroundColor: c.success, borderColor: c.success },
            ]}>
              {daysCompleted[idx] && <Text style={styles.habitMiniCheck}>{'\u2713'}</Text>}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function TasksScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const { isFeatureVisible } = useUIStore();

  // ─── Store ───────────────────────────────────────────────────────────────
  const { tasks, isLoading, fetchTasks, createTask, updateTask, deleteTask, toggleComplete, quickAdd } =
    useTaskStore();
  const { habits, logs: habitLogs, fetchHabits } = useHabitStore();

  // ─── Voice ───────────────────────────────────────────────────────────────
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
      switch (action) {
        case 'create_task':
          await useTaskStore.getState().createTask({
            title: params.title as string,
            category: (params.category as string) || 'personal',
            priority: (params.priority as string) || 'medium',
            date: (params.date as string) || formatDate(new Date()),
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
            await useHabitStore.getState().toggleHabitLog(habit.id, formatDate(new Date()), true);
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
            date: formatDate(new Date()),
          });
          Alert.alert('Готово', 'Расход записан!');
          break;
        case 'add_income':
          await useFinanceStore.getState().createIncome({
            amount: params.amount as number,
            source: (params.source as string) || '',
            date: formatDate(new Date()),
          });
          Alert.alert('Готово', 'Доход записан!');
          break;
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось выполнить команду');
    }
  }, []);

  // ─── State ───────────────────────────────────────────────────────────────
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Create modal form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<string>('personal');
  const [newPriority, setNewPriority] = useState<string>('medium');
  const [newDate, setNewDate] = useState(toDateString(new Date()));
  const [newTime, setNewTime] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Week planner notes
  const [weekNotes, setWeekNotes] = useState('');
  const [weekImprove, setWeekImprove] = useState('');
  const [weekGratitude, setWeekGratitude] = useState('');

  // ─── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchTasks();
    fetchHabits();
  }, [fetchTasks, fetchHabits]);

  // Re-fetch tasks when user navigates to a different month
  useEffect(() => {
    const y = currentMonth.getFullYear();
    const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
    fetchTasks(undefined, undefined, `${y}-${m}`);
  }, [currentMonth, fetchTasks]);

  // ─── Computed Values ─────────────────────────────────────────────────────
  const monthTasks = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    return tasks.filter((t) => {
      const d = new Date(t.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [tasks, currentMonth]);

  const monthStats = useMemo(() => {
    const total = monthTasks.length;
    const completed = monthTasks.filter((t) => t.completed).length;
    const overdue = monthTasks.filter((t) => getTaskStatus(t) === 'overdue').length;
    const inProgress = total - completed - overdue;
    const completionRate = total > 0 ? completed / total : 0;
    return { total, completed, inProgress, overdue, completionRate };
  }, [monthTasks]);

  const weekDays = useMemo(() => getWeekDays(currentWeek), [currentWeek]);

  const weekTasks = useMemo(() => {
    const monday = getMonday(currentWeek);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return tasks.filter((t) => {
      const d = new Date(t.date);
      return d >= monday && d <= sunday;
    });
  }, [tasks, currentWeek]);

  const weekTasksByDay = useMemo(() => {
    const map: Record<string, TaskItem[]> = {};
    for (const day of weekDays) {
      const key = toDateString(day.date);
      map[key] = [];
    }
    for (const task of weekTasks) {
      const key = task.date.slice(0, 10);
      if (map[key]) {
        map[key].push(task);
      }
    }
    return map;
  }, [weekDays, weekTasks]);

  const weekStats = useMemo(() => {
    const total = weekTasks.length;
    const completed = weekTasks.filter((t) => t.completed).length;
    return { total, completed, rate: total > 0 ? completed / total : 0 };
  }, [weekTasks]);

  // Priority distribution for pie chart
  const priorityDistribution = useMemo((): PieChartData[] => {
    return PRIORITY_KEYS.map((key) => {
      const info = priorities[key];
      return {
        label: info.label,
        value: monthTasks.filter((t) => t.priority === key).length,
        color: info.color,
      };
    });
  }, [monthTasks]);

  // Status distribution for pie chart
  const statusDistribution = useMemo((): PieChartData[] => {
    return [
      { label: 'Выполнено', value: monthStats.completed, color: c.success },
      { label: 'В процессе', value: monthStats.inProgress, color: c.warning },
      { label: 'Просрочено', value: monthStats.overdue, color: c.danger },
    ];
  }, [monthStats, c]);

  // Category distribution for insights
  const categoryDistribution = useMemo(() => {
    return CATEGORY_KEYS.map((key) => {
      const info = taskCategories[key];
      return {
        label: `${info.icon} ${info.label}`,
        value: weekTasks.filter((t) => t.category === key).length,
        color: info.color,
      };
    }).filter((d) => d.value > 0);
  }, [weekTasks]);

  // Daily completion for bar chart (insights)
  const dailyCompletion = useMemo(() => {
    return weekDays.map((day, idx) => {
      const key = toDateString(day.date);
      const dayTasks = weekTasksByDay[key] ?? [];
      const done = dayTasks.filter((t) => t.completed).length;
      return {
        label: RUSSIAN_DAYS_SHORT[idx],
        value: done,
        color: isToday(day.date) ? c.primary : c.secondary,
      };
    });
  }, [weekDays, weekTasksByDay, c]);

  const maxDailyTasks = useMemo(() => {
    return Math.max(
      ...weekDays.map((day) => {
        const key = toDateString(day.date);
        return (weekTasksByDay[key] ?? []).length;
      }),
      1,
    );
  }, [weekDays, weekTasksByDay]);

  // Previous week comparison
  const prevWeekStats = useMemo(() => {
    const prevMonday = new Date(getMonday(currentWeek));
    prevMonday.setDate(prevMonday.getDate() - 7);
    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevMonday.getDate() + 6);
    prevSunday.setHours(23, 59, 59, 999);
    const prevTasks = tasks.filter((t) => {
      const d = new Date(t.date);
      return d >= prevMonday && d <= prevSunday;
    });
    const total = prevTasks.length;
    const completed = prevTasks.filter((t) => t.completed).length;
    return { total, completed, rate: total > 0 ? completed / total : 0 };
  }, [tasks, currentWeek]);

  // Streak calculation
  const currentStreak = useMemo(() => {
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = toDateString(d);
      const dayTasks = tasks.filter((t) => t.date.startsWith(key));
      if (dayTasks.length === 0) {
        if (i === 0) continue;
        break;
      }
      const allDone = dayTasks.every((t) => t.completed);
      if (allDone) {
        streak++;
      } else {
        if (i === 0) continue;
        break;
      }
    }
    return streak;
  }, [tasks]);

  // Best day
  const bestDay = useMemo(() => getBestDay(tasks), [tasks]);

  // Habit mini tracker data
  const allHabitLogs = useMemo(() => {
    return Object.values(habitLogs).flat();
  }, [habitLogs]);

  const habitMiniData = useMemo(() => {
    const topHabits = habits.slice(0, 5);
    return topHabits.map((habit) => {
      const daysCompleted = weekDays.map((day) => {
        const dateStr = toDateString(day.date);
        return allHabitLogs.some(
          (log: { habitId: string; date: string; completed: boolean }) =>
            log.habitId === habit.id &&
            log.date.startsWith(dateStr) &&
            log.completed,
        );
      });
      const catInfo = habit.category
        ? (taskCategories[habit.category as keyof typeof taskCategories] ?? null)
        : null;
      return {
        id: habit.id,
        name: habit.name,
        icon: catInfo?.icon ?? '\uD83D\uDCCB',
        daysCompleted,
      };
    });
  }, [habits, habitLogs, weekDays]);

  // ─── View Mode ───────────────────────────────────────────────────────────
  const visibleViewModes = useMemo(() => {
    return VIEW_MODES.filter((mode) => {
      if (!mode.featureFlag) return true;
      return isFeatureVisible(mode.featureFlag);
    });
  }, [isFeatureVisible]);

  const handleQuickAdd = useCallback(async (text: string) => {
    await quickAdd(text);
  }, [quickAdd]);

  const handleViewModePress = useCallback((mode: ViewModeItem) => {
    if (mode.route) {
      (navigation as { navigate: (route: string) => void }).navigate(mode.route);
    }
  }, [navigation]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTasks();
    setRefreshing(false);
  }, [fetchTasks]);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  }, []);

  const handlePrevWeek = useCallback(() => {
    setCurrentWeek((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }, []);

  const handleNextWeek = useCallback(() => {
    setCurrentWeek((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }, []);

  const handleToggleComplete = useCallback(
    async (id: string) => {
      await toggleComplete(id);
    },
    [toggleComplete],
  );

  const handleDeleteTask = useCallback(
    (id: string) => {
      Alert.alert(
        'Удалить задачу?',
        'Эта задача будет удалена безвозвратно.',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Удалить',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteTask(id);
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Ошибка удаления';
                Alert.alert('Ошибка', msg);
              }
            },
          },
        ],
      );
    },
    [deleteTask],
  );

  const handleEditTask = useCallback((task: TaskItem) => {
    setEditingTask(task);
    setNewTitle(task.title);
    setNewCategory(task.category);
    setNewPriority(task.priority);
    setNewDate(task.date.slice(0, 10));
    setNewTime(task.time ?? '');
    setNewNotes(task.notes ?? '');
    setShowEditModal(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => setShowCreateModal(false), []);
  const handleCloseEditModal = useCallback(() => setShowEditModal(false), []);

  const handleOpenCreate = useCallback((presetDate?: Date) => {
    setEditingTask(null);
    setNewTitle('');
    setNewCategory('personal');
    setNewPriority('medium');
    setNewDate(presetDate ? toDateString(presetDate) : toDateString(new Date()));
    setNewTime('');
    setNewNotes('');
    setShowCreateModal(true);
  }, []);

  const handleAddTaskForDay = useCallback(
    (date: Date) => {
      handleOpenCreate(date);
    },
    [handleOpenCreate],
  );

  const handleSaveTask = useCallback(async () => {
    if (!newTitle.trim()) {
      Alert.alert('Ошибка', 'Введите название задачи');
      return;
    }
    try {
      await createTask({
        title: newTitle.trim(),
        category: newCategory,
        priority: newPriority,
        date: newDate,
        time: newTime || undefined,
        notes: newNotes || undefined,
      });
      setShowCreateModal(false);
      setNewTitle('');
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать задачу');
    }
  }, [newTitle, newCategory, newPriority, newDate, newTime, newNotes, createTask]);

  const handleUpdateTask = useCallback(async () => {
    if (!editingTask) return;
    if (!newTitle.trim()) {
      Alert.alert('Ошибка', 'Введите название задачи');
      return;
    }
    try {
      await updateTask(editingTask.id, {
        title: newTitle.trim(),
        category: newCategory,
        priority: newPriority,
        date: newDate,
        time: newTime || undefined,
        notes: newNotes || undefined,
      });
      setShowEditModal(false);
      setEditingTask(null);
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить задачу');
    }
  }, [editingTask, newTitle, newCategory, newPriority, newDate, newTime, newNotes, updateTask]);

  // ─── Chip Items ──────────────────────────────────────────────────────────
  const categoryChips = useMemo(
    () =>
      CATEGORY_KEYS.map((key) => ({
        key,
        label: taskCategories[key].label,
        icon: taskCategories[key].icon,
        color: taskCategories[key].color,
      })),
    [],
  );

  const priorityChips = useMemo(
    () =>
      PRIORITY_KEYS.map((key) => ({
        key,
        label: priorities[key].label,
        icon: priorities[key].icon,
        color: priorities[key].color,
      })),
    [],
  );

  // ─── Render: Task Modal (Create / Edit) ──────────────────────────────────
  const renderTaskModal = useCallback(
    (visible: boolean, onClose: () => void, onSave: () => void, isEdit: boolean) => (
      <Modal visible={visible} onClose={onClose} title={isEdit ? 'Редактировать задачу' : 'Новая задача'}>

        <Text style={styles.modalLabel}>Название</Text>
        <Input
          placeholder="Что нужно сделать?"
          value={newTitle}
          onChangeText={setNewTitle}
        />

        <Text style={styles.modalLabel}>Категория</Text>
        <ChipPicker
          items={categoryChips}
          selected={newCategory}
          onSelect={setNewCategory}
          colors={c}
        />

        <Text style={styles.modalLabel}>Приоритет</Text>
        <ChipPicker
          items={priorityChips}
          selected={newPriority}
          onSelect={setNewPriority}
          colors={c}
        />

        <Text style={styles.modalLabel}>Дата (ГГГГ-ММ-ДД)</Text>
        <Input
          placeholder="2026-04-12"
          value={newDate}
          onChangeText={setNewDate}
        />

        <Text style={styles.modalLabel}>Время (ЧЧ:ММ)</Text>
        <Input
          placeholder="14:00"
          value={newTime}
          onChangeText={setNewTime}
        />

        <Text style={styles.modalLabel}>Заметки</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Дополнительные заметки..."
          placeholderTextColor={c.textMuted}
          value={newNotes}
          onChangeText={setNewNotes}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        <View style={styles.modalButtons}>
          <Button
            title="Отмена"
            onPress={onClose}
            variant="outline"
            style={styles.modalButton}
          />
          <Button
            title={isEdit ? 'Сохранить' : 'Создать задачу'}
            onPress={onSave}
            style={styles.modalButton}
          />
        </View>
      </Modal>
    ),
    [
      styles, c, newTitle, newCategory, newPriority, newDate, newTime, newNotes,
      categoryChips, priorityChips,
    ],
  );

  // ─── Render: Slide 1 — Dashboard ────────────────────────────────────────
  const renderDashboard = useCallback(() => {
    const monthName = `${RUSSIAN_MONTHS[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

    return (
      <ScrollView
        style={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* Month Navigator */}
        <View style={styles.monthNavigator}>
          <TouchableOpacity onPress={handlePrevMonth} style={styles.navArrow}>
            <Text style={styles.navArrowText}>{'\u25C0'}</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{monthName}</Text>
          <TouchableOpacity onPress={handleNextMonth} style={styles.navArrow}>
            <Text style={styles.navArrowText}>{'\u25B6'}</Text>
          </TouchableOpacity>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { borderLeftColor: c.primary }]}>
            <Text style={styles.statBoxValue}>{monthStats.total}</Text>
            <Text style={styles.statBoxLabel}>Всего</Text>
          </View>
          <View style={[styles.statBox, { borderLeftColor: c.success }]}>
            <Text style={[styles.statBoxValue, { color: c.success }]}>{monthStats.completed}</Text>
            <Text style={styles.statBoxLabel}>Выполнено</Text>
          </View>
          <View style={[styles.statBox, { borderLeftColor: c.warning }]}>
            <Text style={[styles.statBoxValue, { color: c.warning }]}>{monthStats.inProgress}</Text>
            <Text style={styles.statBoxLabel}>В процессе</Text>
          </View>
          <View style={[styles.statBox, { borderLeftColor: c.danger }]}>
            <Text style={[styles.statBoxValue, { color: c.danger }]}>{monthStats.overdue}</Text>
            <Text style={styles.statBoxLabel}>Просрочено</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <Card style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Общий прогресс</Text>
            <Text style={styles.progressPercent}>
              {Math.round(monthStats.completionRate * 100)}%
            </Text>
          </View>
          <AnimatedProgressBar progress={Math.round(monthStats.completionRate * 100)} />
        </Card>

        {/* Task Overview Table */}
        <Card style={styles.tableCard}>
          <Text style={styles.sectionTitle}>Обзор задач</Text>

          {/* Table Header */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.tableHeader}>
                <View style={styles.tableCell_title}>
                  <Text style={styles.tableHeaderText}>Задача</Text>
                </View>
                <View style={styles.tableCell_priority}>
                  <Text style={styles.tableHeaderText}>Приоритет</Text>
                </View>
                <View style={styles.tableCell_status}>
                  <Text style={styles.tableHeaderText}>Статус</Text>
                </View>
                <View style={styles.tableCell_category}>
                  <Text style={styles.tableHeaderText}>Категория</Text>
                </View>
                <View style={styles.tableCell_date}>
                  <Text style={styles.tableHeaderText}>Создана</Text>
                </View>
                <View style={styles.tableCell_deadline}>
                  <Text style={styles.tableHeaderText}>Дедлайн</Text>
                </View>
                <View style={styles.tableCell_remaining}>
                  <Text style={styles.tableHeaderText}>Осталось</Text>
                </View>
                <View style={{ width: 40 }} />
              </View>

              {/* Table Body */}
              {monthTasks.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyEmoji}>{'\uD83D\uDCCB'}</Text>
                  <Text style={styles.emptyText}>Нет задач за этот месяц</Text>
                  <Text style={styles.emptySubtext}>
                    Нажмите + чтобы создать первую задачу
                  </Text>
                </View>
              ) : (
                monthTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={handleToggleComplete}
                    onDelete={handleDeleteTask}
                    onEdit={handleEditTask}
                    colors={c}
                  />
                ))
              )}
            </View>
          </ScrollView>
        </Card>

        {/* Pie Charts */}
        <View style={styles.pieChartsRow}>
          <MiniPieChart
            data={priorityDistribution}
            title="По приоритету"
            colors={c}
          />
          <MiniPieChart
            data={statusDistribution}
            title="По статусу"
            colors={c}
          />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    );
  }, [
    currentMonth, monthTasks, monthStats, priorityDistribution, statusDistribution,
    refreshing, handleRefresh, handlePrevMonth, handleNextMonth, handleToggleComplete,
    handleDeleteTask, handleEditTask, styles, c,
  ]);

  // ─── Render: Slide 2 — Week Planner ─────────────────────────────────────
  const renderWeekPlanner = useCallback(() => {
    return (
      <ScrollView
        style={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* Week Navigator */}
        <View style={styles.monthNavigator}>
          <TouchableOpacity onPress={handlePrevWeek} style={styles.navArrow}>
            <Text style={styles.navArrowText}>{'\u25C0'}</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{getWeekRange(currentWeek)}</Text>
          <TouchableOpacity onPress={handleNextWeek} style={styles.navArrow}>
            <Text style={styles.navArrowText}>{'\u25B6'}</Text>
          </TouchableOpacity>
        </View>

        {/* Week Stats */}
        <View style={styles.weekStatsRow}>
          <View style={styles.weekStatItem}>
            <Text style={styles.weekStatValue}>{weekStats.total}</Text>
            <Text style={styles.weekStatLabel}>Задач</Text>
          </View>
          <View style={styles.weekStatItem}>
            <Text style={[styles.weekStatValue, { color: c.success }]}>{weekStats.completed}</Text>
            <Text style={styles.weekStatLabel}>Выполнено</Text>
          </View>
          <View style={styles.weekStatItem}>
            <Text style={[styles.weekStatValue, { color: c.primary }]}>
              {Math.round(weekStats.rate * 100)}%
            </Text>
            <Text style={styles.weekStatLabel}>Прогресс</Text>
          </View>
        </View>

        {/* Week Grid */}
        <Card style={styles.weekGridCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.weekGrid}>
              {weekDays.map((day, idx) => {
                const key = toDateString(day.date);
                const dayTasks = weekTasksByDay[key] ?? [];
                return (
                  <WeekDayColumn
                    key={key}
                    dayLabel={day.label}
                    dayNum={day.dayNum}
                    date={day.date}
                    tasks={dayTasks}
                    isCurrentDay={isToday(day.date)}
                    onToggle={handleToggleComplete}
                    onAddTask={handleAddTaskForDay}
                    colors={c}
                  />
                );
              })}
            </View>
          </ScrollView>
        </Card>

        {/* Weekly Notes */}
        <Card style={styles.notesCard}>
          <Text style={styles.sectionTitle}>{'\uD83D\uDCDD'} Заметки на неделю</Text>
          <TextInput
            style={styles.weekTextInput}
            placeholder="Ваши заметки и планы на эту неделю..."
            placeholderTextColor={c.textMuted}
            value={weekNotes}
            onChangeText={setWeekNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </Card>

        {/* Mini Habit Tracker */}
        {habitMiniData.length > 0 && (
          <Card style={styles.notesCard}>
            <Text style={styles.sectionTitle}>{'\uD83D\uDD04'} Мини трекер привычек</Text>
            {/* Header row */}
            <View style={styles.habitMiniHeaderRow}>
              <View style={styles.habitMiniLabel}>
                <Text style={styles.habitMiniHeaderText}>Привычка</Text>
              </View>
              <View style={styles.habitMiniDays}>
                {RUSSIAN_DAYS_SHORT.map((d, i) => (
                  <View key={i} style={styles.habitMiniDayCell}>
                    <Text style={styles.habitMiniDayLabel}>{d}</Text>
                  </View>
                ))}
              </View>
            </View>
            {habitMiniData.map((h) => (
              <HabitMiniRow
                key={h.id}
                name={h.name}
                icon={h.icon}
                daysCompleted={h.daysCompleted}
                colors={c}
              />
            ))}
          </Card>
        )}

        {/* Improvement */}
        <Card style={styles.notesCard}>
          <Text style={styles.sectionTitle}>{'\uD83D\uDCA1'} Что можно сделать лучше?</Text>
          <TextInput
            style={styles.weekTextInput}
            placeholder="Размышления о самоулучшении..."
            placeholderTextColor={c.textMuted}
            value={weekImprove}
            onChangeText={setWeekImprove}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </Card>

        {/* Gratitude */}
        <Card style={styles.notesCard}>
          <Text style={styles.sectionTitle}>{'\uD83D\uDE4F'} За что я благодарен?</Text>
          <TextInput
            style={styles.weekTextInput}
            placeholder="Перечислите то, за что вы благодарны..."
            placeholderTextColor={c.textMuted}
            value={weekGratitude}
            onChangeText={setWeekGratitude}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </Card>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    );
  }, [
    currentWeek, weekDays, weekTasksByDay, weekStats, weekNotes, weekImprove, weekGratitude,
    habitMiniData, refreshing, handleRefresh, handlePrevWeek, handleNextWeek,
    handleToggleComplete, handleAddTaskForDay, styles, c,
  ]);

  // ─── Render: Slide 3 — Insights ─────────────────────────────────────────
  const renderInsights = useCallback(() => {
    const rateDiff = weekStats.rate - prevWeekStats.rate;
    const rateTrend: 'up' | 'down' | 'neutral' =
      rateDiff > 0.01 ? 'up' : rateDiff < -0.01 ? 'down' : 'neutral';

    const totalDiff = weekStats.total - prevWeekStats.total;
    const totalTrend: 'up' | 'down' | 'neutral' =
      totalDiff > 0 ? 'up' : totalDiff < 0 ? 'down' : 'neutral';

    return (
      <ScrollView
        style={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* Weekly Header */}
        <View style={styles.insightsHeader}>
          <Text style={styles.insightsTitle}>{'\uD83D\uDCC8'} Аналитика за неделю</Text>
          <Text style={styles.insightsSubtitle}>{getWeekRange(currentWeek)}</Text>
        </View>

        {/* Daily Completion Bar Chart */}
        <Card style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Выполнено по дням</Text>
          <BarChart data={dailyCompletion} maxValue={maxDailyTasks} colors={c} />
        </Card>

        {/* Key Metrics */}
        <Card style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Ключевые показатели</Text>

          <InsightRow
            icon={'\uD83D\uDCCA'}
            label="Процент выполнения"
            value={`${Math.round(weekStats.rate * 100)}%`}
            trend={rateTrend}
            colors={c}
          />
          <InsightRow
            icon={'\uD83D\uDCCB'}
            label="Всего задач на неделе"
            value={`${weekStats.total}`}
            trend={totalTrend}
            colors={c}
          />
          <InsightRow
            icon={'\u2705'}
            label="Выполнено"
            value={`${weekStats.completed}`}
            colors={c}
          />
          <InsightRow
            icon={'\uD83D\uDD25'}
            label="Серия 100% дней"
            value={`${currentStreak} дн.`}
            colors={c}
          />
          <InsightRow
            icon={'\u2B50'}
            label="Лучший день"
            value={bestDay}
            colors={c}
          />
          <InsightRow
            icon={'\uD83D\uDCC5'}
            label="Прошлая неделя"
            value={`${Math.round(prevWeekStats.rate * 100)}% (${prevWeekStats.completed}/${prevWeekStats.total})`}
            colors={c}
          />
        </Card>

        {/* Category Breakdown */}
        {categoryDistribution.length > 0 && (
          <Card style={styles.chartCard}>
            <Text style={styles.sectionTitle}>По категориям</Text>
            {categoryDistribution.map((cat, idx) => (
              <View key={idx} style={styles.categoryBarRow}>
                <Text style={styles.categoryBarLabel}>{cat.label}</Text>
                <View style={styles.categoryBarTrack}>
                  <View
                    style={[
                      styles.categoryBarFill,
                      {
                        width: `${Math.max((cat.value / (weekStats.total || 1)) * 100, 8)}%`,
                        backgroundColor: cat.color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.categoryBarValue}>{cat.value}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* Priority Breakdown */}
        <Card style={styles.chartCard}>
          <Text style={styles.sectionTitle}>По приоритету</Text>
          {PRIORITY_KEYS.map((key) => {
            const info = priorities[key];
            const count = weekTasks.filter((t) => t.priority === key).length;
            if (count === 0) return null;
            return (
              <View key={key} style={styles.categoryBarRow}>
                <Text style={styles.categoryBarLabel}>
                  {info.icon} {info.label}
                </Text>
                <View style={styles.categoryBarTrack}>
                  <View
                    style={[
                      styles.categoryBarFill,
                      {
                        width: `${Math.max((count / (weekStats.total || 1)) * 100, 8)}%`,
                        backgroundColor: info.color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.categoryBarValue}>{count}</Text>
              </View>
            );
          })}
        </Card>

        {/* Comparison Card */}
        <Card style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Сравнение с прошлой неделей</Text>
          <View style={styles.comparisonRow}>
            <View style={styles.comparisonItem}>
              <Text style={styles.comparisonLabel}>Прошлая</Text>
              <Text style={styles.comparisonValue}>
                {Math.round(prevWeekStats.rate * 100)}%
              </Text>
              <Text style={styles.comparisonDetail}>
                {prevWeekStats.completed}/{prevWeekStats.total}
              </Text>
            </View>
            <View style={styles.comparisonDivider} />
            <View style={styles.comparisonItem}>
              <Text style={styles.comparisonLabel}>Текущая</Text>
              <Text style={[
                styles.comparisonValue,
                rateDiff > 0 && { color: c.success },
                rateDiff < 0 && { color: c.danger },
              ]}>
                {Math.round(weekStats.rate * 100)}%
              </Text>
              <Text style={styles.comparisonDetail}>
                {weekStats.completed}/{weekStats.total}
              </Text>
            </View>
            <View style={styles.comparisonDivider} />
            <View style={styles.comparisonItem}>
              <Text style={styles.comparisonLabel}>Разница</Text>
              <Text style={[
                styles.comparisonValue,
                rateDiff > 0 && { color: c.success },
                rateDiff < 0 && { color: c.danger },
              ]}>
                {rateDiff > 0 ? '+' : ''}{Math.round(rateDiff * 100)}%
              </Text>
              <Text style={styles.comparisonDetail}>
                {rateDiff > 0 ? '\u2191 Рост' : rateDiff < 0 ? '\u2193 Снижение' : '\u2194 Без изменений'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Streak Card */}
        <Card style={styles.streakCard}>
          <View style={styles.streakContent}>
            <Text style={styles.streakEmoji}>{currentStreak > 0 ? '\uD83D\uDD25' : '\u2744\uFE0F'}</Text>
            <View style={styles.streakInfo}>
              <Text style={styles.streakTitle}>
                {currentStreak > 0
                  ? `${currentStreak} ${currentStreak === 1 ? 'день' : currentStreak < 5 ? 'дня' : 'дней'} подряд!`
                  : 'Начните серию сегодня!'}
              </Text>
              <Text style={styles.streakSubtitle}>
                {currentStreak > 0
                  ? 'Все задачи выполнены! Продолжайте!'
                  : 'Выполните все задачи за день чтобы начать серию'}
              </Text>
            </View>
          </View>
        </Card>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    );
  }, [
    weekStats, prevWeekStats, currentStreak, bestDay, dailyCompletion, maxDailyTasks,
    categoryDistribution, weekTasks, currentWeek, refreshing, handleRefresh, styles, c,
  ]);

  // ─── Main Render ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{'\uD83D\uDCCB'} Задачи</Text>
      </View>

      {/* View Mode Toolbar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.viewModeBar}
        contentContainerStyle={styles.viewModeBarContent}
      >
        {visibleViewModes.map((mode) => {
          const isActive = mode.key === 'list';
          return (
            <TouchableOpacity
              key={mode.key}
              style={[styles.viewModePill, isActive && styles.viewModePillActive]}
              onPress={() => handleViewModePress(mode)}
              activeOpacity={0.7}
            >
              <Feather
                name={mode.icon}
                size={14}
                color={isActive ? '#FFFFFF' : c.textSecondary}
              />
              <Text style={[styles.viewModePillText, isActive && styles.viewModePillTextActive]}>
                {mode.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Quick Add Bar */}
      {isFeatureVisible('quick_add') && (
        <View style={styles.quickAddWrapper}>
          <QuickAddBar
            onSubmit={handleQuickAdd}
            placeholder="Быстро добавить задачу..."
          />
        </View>
      )}

      {isLoading && tasks.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={styles.loadingText}>Загрузка задач...</Text>
        </View>
      ) : (
        <SlideTabs tabs={SLIDE_TABS}>
          {[renderDashboard(), renderWeekPlanner(), renderInsights()]}
        </SlideTabs>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => handleOpenCreate()}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Добавить задачу"
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
      {renderTaskModal(showCreateModal, handleCloseCreateModal, handleSaveTask, false)}
      {renderTaskModal(showEditModal, handleCloseEditModal, handleUpdateTask, true)}
    </SafeAreaView>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STYLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type C = ReturnType<typeof useColors>;

function createStyles(c: C) {
  return StyleSheet.create({
    // ─── Layout ──────────────────────────────────────────────────────────
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    slideContent: {
      flex: 1,
      paddingHorizontal: spacing.md,
    },
    bottomSpacer: {
      height: 120,
    },

    // ─── Month / Week Navigator ──────────────────────────────────────────
    monthNavigator: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
    },
    navArrow: {
      padding: spacing.sm,
      borderRadius: borderRadius.sm,
      backgroundColor: c.surface,
    },
    navArrowText: {
      fontSize: fontSize.md,
      color: c.primary,
    },
    monthTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },

    // ─── Stats Row ───────────────────────────────────────────────────────
    statsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    statBox: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      borderLeftWidth: 3,
      alignItems: 'center',
    },
    statBoxValue: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    statBoxLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 2,
    },

    // ─── Progress Card ───────────────────────────────────────────────────
    progressCard: {
      marginBottom: spacing.md,
      padding: spacing.md,
    },
    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    progressTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    progressPercent: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.primary,
    },

    // ─── Table ───────────────────────────────────────────────────────────
    tableCard: {
      marginBottom: spacing.md,
      padding: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.xs,
    },
    tableHeaderText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
    },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    tableRowCompleted: {
      opacity: 0.6,
    },
    tableCell_title: { width: 150, paddingRight: spacing.sm },
    tableCell_priority: { width: 110, paddingRight: spacing.sm },
    tableCell_status: { width: 110, paddingRight: spacing.sm },
    tableCell_category: { width: 120, paddingRight: spacing.sm },
    tableCell_date: { width: 90, paddingRight: spacing.sm },
    tableCell_deadline: { width: 90, paddingRight: spacing.sm },
    tableCell_remaining: { width: 90, paddingRight: spacing.sm },
    tableCellText: {
      fontSize: fontSize.sm,
      color: c.text,
    },
    tableCellTextCompleted: {
      textDecorationLine: 'line-through',
      color: c.textMuted,
    },
    tableCellTextSmall: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },

    // ─── Priority / Category / Status Badges ────────────────────────────
    priorityBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: borderRadius.sm,
    },
    priorityBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    categoryBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: borderRadius.sm,
    },
    categoryBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: '500',
    },
    statusText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
    deleteButton: {
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteButtonText: {
      fontSize: fontSize.md,
    },

    // ─── Pie Charts ──────────────────────────────────────────────────────
    pieChartsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    pieChartCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
    },
    pieChartTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    pieChartVisual: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    pieChartCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.surfaceLight,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    pieChartSegmentFull: {
      ...StyleSheet.absoluteFillObject,
    },
    pieChartSegment: {
      height: '100%',
    },
    pieChartCenter: {
      position: 'absolute',
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pieChartCenterText: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.text,
    },
    pieChartLegend: {
      gap: spacing.xs,
    },
    pieChartLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    pieChartLegendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    pieChartLegendLabel: {
      flex: 1,
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },
    pieChartLegendValue: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: c.text,
    },

    // ─── Week Stats Row ──────────────────────────────────────────────────
    weekStatsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    weekStatItem: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      alignItems: 'center',
    },
    weekStatValue: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    weekStatLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 2,
    },

    // ─── Week Grid ───────────────────────────────────────────────────────
    weekGridCard: {
      marginBottom: spacing.md,
      padding: spacing.sm,
    },
    weekGrid: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    weekDayColumn: {
      width: (SCREEN_WIDTH - spacing.md * 2 - spacing.sm * 2 - spacing.xs * 6) / 4,
      minWidth: 110,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      overflow: 'hidden',
    },
    weekDayColumnActive: {
      borderWidth: 2,
      borderColor: c.primary,
    },
    weekDayHeader: {
      padding: spacing.sm,
      backgroundColor: c.surfaceLight,
      alignItems: 'center',
    },
    weekDayHeaderActive: {
      backgroundColor: c.primary + '20',
    },
    weekDayLabel: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: c.textSecondary,
    },
    weekDayLabelActive: {
      color: c.primary,
    },
    weekDayNum: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
    weekDayNumActive: {
      color: c.primary,
    },
    weekDayCount: {
      fontSize: fontSize.xs,
      color: c.textMuted,
      marginTop: 2,
    },
    weekDayTasks: {
      padding: spacing.xs,
      minHeight: 80,
    },
    weekDayTask: {
      flexDirection: 'row',
      alignItems: 'center',
      borderLeftWidth: 3,
      borderRadius: borderRadius.sm,
      backgroundColor: c.surfaceLight,
      padding: spacing.xs,
      marginBottom: spacing.xs,
    },
    weekDayTaskCompleted: {
      opacity: 0.5,
    },
    weekDayTaskCheck: {
      marginRight: spacing.xs,
    },
    miniCheckbox: {
      width: 18,
      height: 18,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    miniCheckmark: {
      fontSize: 11,
      color: '#FFFFFF',
      fontWeight: '700',
    },
    weekDayTaskText: {
      flex: 1,
      fontSize: fontSize.xs,
      color: c.text,
    },
    weekDayTaskTextCompleted: {
      textDecorationLine: 'line-through',
      color: c.textMuted,
    },
    weekDayEmpty: {
      fontSize: fontSize.xs,
      color: c.textMuted,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    weekDayAddButton: {
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    weekDayAddButtonText: {
      fontSize: fontSize.lg,
      color: c.primary,
      fontWeight: '600',
    },

    // ─── Notes Cards ─────────────────────────────────────────────────────
    notesCard: {
      marginBottom: spacing.md,
      padding: spacing.md,
    },
    weekTextInput: {
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      fontSize: fontSize.sm,
      color: c.text,
      minHeight: 80,
      textAlignVertical: 'top',
    },
    notesInput: {
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      fontSize: fontSize.sm,
      color: c.text,
      minHeight: 80,
      textAlignVertical: 'top',
      marginBottom: spacing.md,
    },

    // ─── Habit Mini Tracker ──────────────────────────────────────────────
    habitMiniHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xs,
      paddingBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    habitMiniHeaderText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: c.textMuted,
    },
    habitMiniRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    habitMiniLabel: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    habitMiniIcon: {
      fontSize: fontSize.sm,
    },
    habitMiniName: {
      fontSize: fontSize.xs,
      color: c.text,
      flex: 1,
    },
    habitMiniDays: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    habitMiniDayCell: {
      width: 28,
      alignItems: 'center',
    },
    habitMiniDayLabel: {
      fontSize: 10,
      color: c.textMuted,
      fontWeight: '600',
    },
    habitMiniCheckbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    habitMiniCheck: {
      fontSize: 11,
      color: '#FFFFFF',
      fontWeight: '700',
    },

    // ─── Insights ────────────────────────────────────────────────────────
    insightsHeader: {
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    insightsTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
    insightsSubtitle: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: 4,
    },
    chartCard: {
      marginBottom: spacing.md,
      padding: spacing.md,
    },

    // ─── Bar Chart ───────────────────────────────────────────────────────
    barChartContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      height: 140,
      paddingTop: spacing.sm,
    },
    barChartItem: {
      flex: 1,
      alignItems: 'center',
    },
    barChartBarWrapper: {
      width: 28,
      height: 100,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    barChartBar: {
      width: 24,
      borderRadius: 4,
      minHeight: 4,
    },
    barChartLabel: {
      fontSize: 10,
      color: c.textSecondary,
      marginTop: spacing.xs,
      fontWeight: '600',
    },
    barChartValue: {
      fontSize: 10,
      color: c.textMuted,
      marginTop: 2,
    },

    // ─── Insight Rows ────────────────────────────────────────────────────
    insightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    insightIcon: {
      fontSize: fontSize.md,
      width: 30,
    },
    insightLabel: {
      flex: 1,
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },
    insightValueContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    insightValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.text,
    },
    trendArrow: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // ─── Category Bars ───────────────────────────────────────────────────
    categoryBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    categoryBarLabel: {
      width: 100,
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },
    categoryBarTrack: {
      flex: 1,
      height: 16,
      backgroundColor: c.surfaceLight,
      borderRadius: 8,
      overflow: 'hidden',
    },
    categoryBarFill: {
      height: '100%',
      borderRadius: 8,
    },
    categoryBarValue: {
      width: 30,
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: c.text,
      textAlign: 'right',
    },

    // ─── Comparison ──────────────────────────────────────────────────────
    comparisonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    comparisonItem: {
      flex: 1,
      alignItems: 'center',
    },
    comparisonLabel: {
      fontSize: fontSize.xs,
      color: c.textMuted,
      marginBottom: spacing.xs,
    },
    comparisonValue: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    comparisonDetail: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    comparisonDivider: {
      width: 1,
      height: 60,
      backgroundColor: c.divider,
    },

    // ─── Streak Card ─────────────────────────────────────────────────────
    streakCard: {
      marginBottom: spacing.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: c.primary + '40',
      backgroundColor: c.primary + '10',
      borderRadius: borderRadius.lg,
    },
    streakContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    streakEmoji: {
      fontSize: 36,
    },
    streakInfo: {
      flex: 1,
    },
    streakTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: c.text,
    },
    streakSubtitle: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 4,
    },

    // ─── Empty State ─────────────────────────────────────────────────────
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: spacing.xl * 2,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: spacing.md,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
    },
    emptyEmoji: {
      fontSize: 48,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.xs,
    },
    emptySubtext: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
    },

    // ─── Chip Picker ─────────────────────────────────────────────────────
    chipPickerContainer: {
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      backgroundColor: c.surfaceLight,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },

    // ─── Modal ───────────────────────────────────────────────────────────
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.lg,
    },
    modalLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.textSecondary,
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
    },
    modalButtons: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    modalButton: {
      flex: 1,
    },

    // ─── FAB ─────────────────────────────────────────────────────────────
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: Platform.OS === 'ios' ? 100 : 80,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    fabText: {
      fontSize: 28,
      color: '#FFFFFF',
      fontWeight: '600',
      marginTop: -2,
    },
    floatingVoice: {
      position: 'absolute',
      bottom: 90,
      right: 20,
    },

    // ─── View Mode Toolbar ───────────────────────────────────────────────
    viewModeBar: {
      maxHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    viewModeBarContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      gap: spacing.sm,
      alignItems: 'center',
    },
    viewModePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    viewModePillActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    viewModePillText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: c.textSecondary,
    },
    viewModePillTextActive: {
      color: '#FFFFFF',
    },

    // ─── Quick Add Bar ───────────────────────────────────────────────────
    quickAddWrapper: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },

    // ─── Task Tag Chips ──────────────────────────────────────────────────
    taskTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
  });
}
