import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  ScrollView,
  Alert,
  RefreshControl,
  Dimensions,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { KbScrollView } from '@/components/shared/kb-scroll-view';
import { ScreenSafeArea } from '@/components/shared/screen-safe-area';
import {
  Card,
  Button,
  Checkbox,
  SlideTabs,
  AnimatedProgressBar,
  StatCard,
  SwipeableRow,
  TapToAdd,
  TapToAddArea,
} from '@/components/ui';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { spacing, borderRadius, fontSize, taskCategories, priorities } from '@/constants';
import { useTaskStore } from '@/stores/task-store';
import { useScheduleStore } from '@/stores/schedule-store';
import { useHabitStore } from '@/stores/habit-store';
import { useUIStore } from '@/stores/ui-store';
import { getWeekDays, isToday, shiftMonth } from '@/utils/dates';
import { useColors } from '@/hooks/use-colors';
import { TagChip } from '@/components/ui/tag-chip';
import { TaskEditSheet } from '@/components/tasks/task-edit-sheet';
import { bestWeekday } from '@/utils/task-stats';
import { useWeekNotes } from '@/hooks/use-week-notes';
import { useInTools } from '@/hooks/use-content-width';
import { useRoomToolStore } from '@/stores/room-tool-store';
// Горизонтальные полосы — жест-скролл RNGH: листаются сами, не уводя в комнату (свайп дома).
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';

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
  { key: 'insights', title: 'Итоги', icon: '📈' },
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


// ─── Memoized Sub-Components ─────────────────────────────────────────────────

interface TaskRowProps {
  task: TaskItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
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
    <SwipeableRow onDelete={handleDelete} deleteLabel="Удалить задачу">
      {/* Строка списка в ширину экрана: сдвиг влево открывает «минус» (широкая таблица
          с прокруткой вбок забирала этот жест, а минус уезжал за край). */}
      <TouchableOpacity
        style={[styles.listRow, styles.listRowWithCheck, task.completed && styles.tableRowCompleted]}
        onPress={handleEdit}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${task.completed ? 'выполнено' : 'не выполнено'}`}
        accessibilityHint="Нажми, чтобы открыть и поправить задачу"
      >
        {/* Кружок отмечает выполнение, тап по строке — карточка задачи. */}
        <Checkbox checked={task.completed} onToggle={handleToggle} size={22} />
        <View style={styles.listRowBody}>
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
          <View style={styles.listMeta}>
            <Text style={styles.tableCellTextSmall}>
              {prioInfo?.icon ?? ''} {prioInfo?.label ?? task.priority}
            </Text>
            <Text style={[
              styles.tableCellTextSmall,
              status === 'completed' && { color: c.success },
              status === 'overdue' && { color: c.danger },
              status === 'in_progress' && { color: c.warning },
            ]}>
              {getStatusIcon(status)} {getStatusLabel(status)}
            </Text>
            <Text style={[styles.tableCellTextSmall, { color: catInfo?.color ?? c.textSecondary }]}>
              {catInfo?.icon ?? ''} {catInfo?.label ?? task.category}
            </Text>
            <Text style={[
              styles.tableCellTextSmall,
              !task.completed && daysLeft < 0 && { color: c.danger },
              !task.completed && daysLeft === 0 && { color: c.warning },
            ]}>
              {formatShortDate(task.date)}
              {task.completed ? '' : daysLeft < 0 ? ` · ${Math.abs(daysLeft)} дн. назад` : daysLeft === 0 ? ' · сегодня' : ` · ${daysLeft} дн.`}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </SwipeableRow>
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
  onAddTask: (date: Date, title: string) => Promise<void>;
  /** Тап по задаче — карточка (важность, день, время). */
  onOpen: (task: TaskItem) => void;
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
  onOpen,
  colors: c,
}: WeekDayColumnProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  const handleAdd = useCallback((title: string) => onAddTask(date, title), [onAddTask, date]);

  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;

  return (
    <TapToAddArea style={[styles.weekDayColumn, isCurrentDay && styles.weekDayColumnActive]}>
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
              onPress={() => onOpen(task)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${task.title}: открыть задачу`}
            >
              <Pressable style={styles.weekDayTaskCheck} onPress={() => onToggle(task.id)} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: task.completed }}>
                <View style={[
                  styles.miniCheckbox,
                  task.completed && { backgroundColor: c.success, borderColor: c.success },
                ]}>
                  {task.completed && <Text style={styles.miniCheckmark}>{'\u2713'}</Text>}
                </View>
              </Pressable>
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
      {/* Тап по пустой строке внизу дня — задача сразу на этот день */}
      <TapToAdd hint="Добавить" onSubmit={handleAdd} />
    </TapToAddArea>
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
  /** Тап по клетке — отметить/снять привычку за этот день недели. */
  onToggleDay?: (dayIdx: number, done: boolean) => void;
  /** Тап по названию — вкладка «Привычки». */
  onOpen?: () => void;
}

const HabitMiniRow = React.memo(function HabitMiniRow({ name, icon, daysCompleted, colors: c, onToggleDay, onOpen }: HabitMiniRowProps) {
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.habitMiniRow}>
      <Pressable style={styles.habitMiniLabel} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${name}: открыть привычки`}>
        <Text style={styles.habitMiniIcon}>{icon}</Text>
        <Text style={styles.habitMiniName} numberOfLines={1}>{name}</Text>
      </Pressable>
      <View style={styles.habitMiniDays}>
        {RUSSIAN_DAYS_SHORT.map((dayLabel, idx) => (
          <Pressable
            key={idx}
            style={styles.habitMiniDayCell}
            onPress={() => onToggleDay?.(idx, !daysCompleted[idx])}
            hitSlop={4}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: daysCompleted[idx] }}
            accessibilityLabel={`${name}, ${dayLabel}`}
          >
            <View style={[
              styles.habitMiniCheckbox,
              daysCompleted[idx] && { backgroundColor: c.success, borderColor: c.success },
            ]}>
              {daysCompleted[idx] && <Text style={styles.habitMiniCheck}>{'\u2713'}</Text>}
            </View>
          </Pressable>
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


  // ─── State ───────────────────────────────────────────────────────────────
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Edit modal form state

  // Week planner notes

  // Перегруз дня: «Подтвердить» сдвинул график → перечитать месяц.
  const scheduleRevision = useScheduleStore((s) => s.revision);

  // ─── Effects ─────────────────────────────────────────────────────────────
  // Без сети и без кэша fetch бросает: экран остаётся с тем, что уже показан,
  // а не роняет необработанную ошибку.
  useEffect(() => {
    fetchTasks().catch(() => {});
    void Promise.resolve(fetchHabits()).catch(() => {});
  }, [fetchTasks, fetchHabits]);

  // Re-fetch tasks when user navigates to a different month
  useEffect(() => {
    const y = currentMonth.getFullYear();
    const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
    fetchTasks(undefined, undefined, `${y}-${m}`).catch(() => {});
  }, [currentMonth, fetchTasks, scheduleRevision]);

  // Недельный планер: листаешь неделю — грузим её и прошлую (для «сравнения
  // с прошлой неделей»). Раньше грузился только месяц — неделя на стыке
  // месяцев или в прошлом месяце была пустой (аудит 2026-11-09).
  useEffect(() => {
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const monday = new Date(getMonday(currentWeek));
    const prev = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    fetchTasks(undefined, ymd(monday)).catch(() => {});
    fetchTasks(undefined, ymd(prev)).catch(() => {});
  }, [currentWeek, fetchTasks, scheduleRevision]);

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
  const inTools = useInTools();
  // Заметки недели хранятся на телефоне по неделям (раньше пропадали при уходе с экрана).
  const [weekNoteFields, setWeekNote] = useWeekNotes(toDateString(weekDays[0].date));
  const { notes: weekNotes, improve: weekImprove, gratitude: weekGratitude } = weekNoteFields;
  const setWeekNotes = useCallback((v: string) => setWeekNote('notes', v), [setWeekNote]);
  const setWeekImprove = useCallback((v: string) => setWeekNote('improve', v), [setWeekNote]);
  const setWeekGratitude = useCallback((v: string) => setWeekNote('gratitude', v), [setWeekNote]);

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
  // Лучший день — по задачам загруженного месяца; данных мало — так и пишем.
  const bestDay = useMemo(() => {
    const idx = bestWeekday(tasks);
    return idx == null ? 'мало данных' : RUSSIAN_DAYS_FULL[idx];
  }, [tasks]);

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

  // Пустая строка в конце списка: дату из текста («завтра в 15:00») разбирает сервер.
  // Ошибку покажет сама строка (текст не пропадёт).
  const handleQuickAdd = useCallback((text: string) => quickAdd(text), [quickAdd]);

  const handleViewModePress = useCallback((mode: ViewModeItem) => {
    if (mode.route) {
      (navigation as { navigate: (route: string) => void }).navigate(mode.route);
    }
  }, [navigation]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchTasks();
    } finally {
      // fetchTasks бросает при сбое сети — иначе спиннер завис бы навсегда.
      setRefreshing(false);
    }
  }, [fetchTasks]);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => shiftMonth(prev, -1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => shiftMonth(prev, 1));
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

  // Сдвиг строки влево + красный минус — уже осознанное действие, без диалога.
  const handleDeleteTask = useCallback(
    async (id: string) => {
      try {
        await deleteTask(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка удаления';
        Alert.alert('Ошибка', msg);
      }
    },
    [deleteTask],
  );

  const handleEditTask = useCallback((task: TaskItem) => {
    setEditingTask(task);
    setShowEditModal(true);
  }, []);

  const handleCloseEditModal = useCallback(() => setShowEditModal(false), []);

  // Пустая строка внизу дня в планере: задача на этот день с прежними
  // значениями по умолчанию (категория «Личное», приоритет «Средний»).
  const handleAddTaskForDay = useCallback(
    (date: Date, title: string) =>
      createTask({
        title,
        category: 'personal',
        priority: 'medium',
        date: toDateString(date),
      }),
    [createTask],
  );


  // ─── Render: Slide 1 — Dashboard ────────────────────────────────────────
  const renderDashboard = useCallback(() => {
    const monthName = `${RUSSIAN_MONTHS[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

    return (
      <KbScrollView
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
          <Pressable onPress={() => setCurrentMonth(new Date())} accessibilityRole="button" accessibilityLabel="Вернуться к текущему месяцу">
            <Text style={styles.monthTitle}>{monthName}</Text>
          </Pressable>
          <TouchableOpacity onPress={handleNextMonth} style={styles.navArrow}>
            <Text style={styles.navArrowText}>{'\u25B6'}</Text>
          </TouchableOpacity>
        </View>

        {/* Task Overview Table — первым: «Задачи» = список (раньше он был третьим блоком, между счётчиками и донатами). */}
        <Card style={styles.tableCard} tapToAdd>
          <Text style={styles.sectionTitle}>Обзор задач</Text>

          {monthTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={handleToggleComplete}
              onDelete={handleDeleteTask}
              onEdit={handleEditTask}
              colors={c}
            />
          ))}
          {/* Пусто — подпись в ширину карточки, а не широкой таблицы (иначе обрезалась справа). */}
          {monthTasks.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>{'\uD83D\uDCCB'}</Text>
              <Text style={styles.emptyText}>Нет задач за этот месяц</Text>
              <Text style={styles.emptySubtext}>Нажми на пустую строку ниже, чтобы добавить задачу</Text>
            </View>
          )}
          {/* Добавление без плюсиков: тап по пустой строке в конце списка */}
          <TapToAdd hint="Новая задача" onSubmit={handleQuickAdd} />
        </Card>

        {/* Другие виды — отдельные экраны (↗). Раньше отдельным рядом над
            «Дашборд/Неделя/Итоги»: три ряда навигации до первой задачи (UX-аудит №4). */}
        <View style={styles.viewLinksRow}>
          {visibleViewModes.filter((mode) => mode.route).map((mode) => (
            <TouchableOpacity
              key={mode.key}
              style={styles.viewModePill}
              onPress={() => handleViewModePress(mode)}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel={`Открыть ${mode.label}`}
            >
              <Feather name={mode.icon} size={13} color={c.textSecondary} />
              <Text style={styles.viewModePillText}>{mode.label}</Text>
              <Feather name="arrow-up-right" size={12} color={c.textSecondary} />
            </TouchableOpacity>
          ))}
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
      </KbScrollView>
    );
  }, [
    currentMonth, monthTasks, monthStats, priorityDistribution, statusDistribution,
    refreshing, handleRefresh, handlePrevMonth, handleNextMonth, handleToggleComplete,
    handleDeleteTask, handleEditTask, handleQuickAdd, visibleViewModes, handleViewModePress, styles, c,
  ]);

  // ─── Render: Slide 2 — Week Planner ─────────────────────────────────────
  const renderWeekPlanner = useCallback(() => {
    return (
      <KbScrollView
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
          <Pressable onPress={() => setCurrentWeek(new Date())} accessibilityRole="button" accessibilityLabel="Вернуться к текущей неделе">
            <Text style={styles.monthTitle}>{getWeekRange(currentWeek)}</Text>
          </Pressable>
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
          <GHScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                    onOpen={handleEditTask}
                    colors={c}
                  />
                );
              })}
            </View>
          </GHScrollView>
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
                onToggleDay={(idx, done) =>
                  void useHabitStore.getState().toggleHabitLog(h.id, toDateString(weekDays[idx].date), done).catch(() => {})
                }
                onOpen={() => useRoomToolStore.getState().openTool('habits')}
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
      </KbScrollView>
    );
  }, [
    currentWeek, weekDays, weekTasksByDay, weekStats, weekNotes, weekImprove, weekGratitude,
    habitMiniData, refreshing, handleRefresh, handlePrevWeek, handleNextWeek,
    handleToggleComplete, handleAddTaskForDay, handleEditTask, setWeekNotes, setWeekImprove, setWeekGratitude, styles, c,
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
      <KbScrollView
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
            label="Лучший день месяца"
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
      </KbScrollView>
    );
  }, [
    weekStats, prevWeekStats, currentStreak, bestDay, dailyCompletion, maxDailyTasks,
    categoryDistribution, weekTasks, currentWeek, refreshing, handleRefresh, styles, c,
  ]);

  // ─── Main Render ─────────────────────────────────────────────────────────
  return (
    <ScreenSafeArea style={styles.container} edges={['top']}>
      {!inTools && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{'\uD83D\uDCCB'} Задачи</Text>
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

      {/* Модалка редактирования (долгое нажатие на строку) */}
      <TaskEditSheet task={showEditModal ? editingTask : null} onClose={handleCloseEditModal} />
    </ScreenSafeArea>
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
    listRowWithCheck: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    listRowBody: { flex: 1, gap: 4 },
    listRow: {
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
      gap: 4,
    },
    listMeta: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: spacing.md,
      rowGap: 2,
    },
    tableRowCompleted: {
      opacity: 0.6,
    },
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

    // ─── View Mode Toolbar ───────────────────────────────────────────────
    viewLinksRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
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
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
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

    // ─── Task Tag Chips ──────────────────────────────────────────────────
    taskTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
  });
}
