import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { KbScrollView } from '@/components/shared/kb-scroll-view';
import { ScreenSafeArea } from '@/components/shared/screen-safe-area';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ProgressRing, SwipeableRow, TapToAdd } from '@/components/ui';
import { Heatmap } from '@/components/charts';
import { Confetti } from '@/components/shared';
import { MorningGreeting, EveningRitual } from '@/components/voice';
import { useMorningGreeting } from '@/hooks/use-morning-greeting';
import { useTaskStore } from '@/stores/task-store';
import { useScheduleStore } from '@/stores/schedule-store';
import { useGoalStore } from '@/stores/goal-store';
import { useHabitStore } from '@/stores/habit-store';
import { useAuthStore } from '@/stores/auth-store';
import { useJournalStore } from '@/stores/journal-store';
import { api } from '@/services/api';
import { getRandomQuote } from '@/utils/quotes';
import { formatDate, getWeekDays } from '@/utils/dates';
import { spacing, fontSize, borderRadius } from '@/constants';
import { taskCategories } from '@/constants/categories';

import { useColors } from '@/hooks/use-colors';
import { FadeInView } from '@/components/ui/fade-in-view';
import { hapticLight, hapticSelection, hapticSuccess } from '@/services/haptics';
import { moodEmoji } from '@/constants/mood';
import { TaskEditSheet } from '@/components/tasks/task-edit-sheet';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}


function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatShortDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

const WeekDayItem = React.memo(function WeekDayItem({
  dayLabel,
  dayNum,
  isToday,
  isSelected,
  onPress,
}: {
  dayLabel: string;
  dayNum: number;
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <TouchableOpacity
      style={[
        styles.dayItem,
        isSelected && styles.dayItemSelected,
        isToday && styles.dayItemToday,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.dayLabel, isSelected && styles.dayLabelSelected]}>
        {dayLabel}
      </Text>
      <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>
        {dayNum}
      </Text>
    </TouchableOpacity>
  );
});

const TaskRow = React.memo(function TaskRow({
  title,
  category,
  completed,
  time,
  onToggle,
  onOpen,
}: {
  title: string;
  category: string;
  completed: boolean;
  time: string | null;
  onToggle: () => void;
  /** Тап по названию — карточка задачи (важность, день, время). */
  onOpen: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const cat = taskCategories[category as keyof typeof taskCategories];
  const handleToggle = useCallback(() => {
    hapticLight();
    onToggle();
  }, [onToggle]);
  return (
    <View style={styles.taskRow}>
      <Checkbox checked={completed} onToggle={handleToggle} size={20} />
      <Pressable
        style={styles.taskInfo}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${title}: открыть задачу`}
      >
        <Text
          style={[styles.taskTitle, completed && styles.taskTitleCompleted]}
          numberOfLines={1}
        >
          {cat?.icon ?? ''} {title}
        </Text>
        {time ? (
          <Text style={styles.taskTime}>{time}</Text>
        ) : null}
      </Pressable>
    </View>
  );
});

interface SummaryCardProps {
  label: string;
  value: string;
  color: string;
  progress?: number;
}

const SummaryCard = React.memo(function SummaryCard({
  label,
  value,
  color,
  progress,
}: SummaryCardProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.summaryCard}>
      {progress != null && (
        <View style={styles.miniProgress}>
          <View
            style={[
              styles.miniProgressFill,
              { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color },
            ]}
          />
        </View>
      )}
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
});

export default function PlannerScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  // voiceModalVisible removed — hold-to-record replaces modal
  const [showConfetti, setShowConfetti] = useState(false);
  const [showEveningRitual, setShowEveningRitual] = useState(false);
  const [eveningMessage, setEveningMessage] = useState('');
  const [dayProgress, setDayProgress] = useState(0);
  const [quoteMuted, setQuoteMuted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasSpokenTodayRef = useRef(false);

  const { tasks, isLoading: tasksLoading, fetchTasks, toggleComplete, deleteTask } = useTaskStore();
  // Карточка задачи: id, а не копия — после сохранения показываем свежую задачу из стора.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask = useMemo(() => tasks.find((t) => t.id === editingTaskId) ?? null, [tasks, editingTaskId]);
  const closeTaskCard = useCallback(() => setEditingTaskId(null), []);
  const {
    weeklyGoals,
    isLoading: goalsLoading,
    fetchWeeklyGoals,
    createWeeklyGoal,
    updateWeeklyGoal,
    deleteWeeklyGoal,
  } = useGoalStore();
  const { habits, logs, fetchHabits, fetchLogs } = useHabitStore();
  const user = useAuthStore((state) => state.user);
  const { todayEntry, fetchEntry: fetchJournalEntry } = useJournalStore();

  const {
    shouldShowGreeting,
    greeting: morningGreeting,
    dismissGreeting,
    handleChipPress: handleMorningChipPress,
  } = useMorningGreeting();

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDate(today), [today]);
  const quote = useMemo(() => getRandomQuote(), []);
  const greeting = useMemo(() => getGreeting(), []);

  // Speak daily quote via TTS on first mount of the day
  useEffect(() => {
    if (hasSpokenTodayRef.current || quoteMuted) return;
    hasSpokenTodayRef.current = true;

    const textToSpeak = `${quote.text} — ${quote.author}`;
    Speech.speak(textToSpeak, {
      language: 'ru-RU',
      rate: 0.85,
      pitch: 1.05,
    });

    return () => {
      Speech.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const userName = user?.name ?? '';

  const currentMonday = useMemo(() => {
    const monday = getMonday(today);
    monday.setDate(monday.getDate() + weekOffset * 7);
    return monday;
  }, [today, weekOffset]);

  const weekDays = useMemo(() => getWeekDays(currentMonday), [currentMonday]);

  const weekStartStr = useMemo(() => formatDate(currentMonday), [currentMonday]);
  const sundayDate = useMemo(() => {
    const sun = new Date(currentMonday);
    sun.setDate(sun.getDate() + 6);
    return sun;
  }, [currentMonday]);

  const weekLabel = useMemo(
    () => `${formatShortDate(currentMonday)} — ${formatShortDate(sundayDate)}`,
    [currentMonday, sundayDate],
  );

  // Перегруз дня: «Подтвердить» сдвинул график → перечитать неделю.
  const scheduleRevision = useScheduleStore((s) => s.revision);
  useEffect(() => {
    fetchTasks(undefined, weekStartStr);
    fetchWeeklyGoals(weekStartStr);
    fetchHabits();
    // habit-day: отметки недели с сервера (голос/чат/другое устройство).
    fetchLogs(weekStartStr, formatDate(sundayDate));
  }, [weekStartStr, sundayDate, fetchTasks, fetchWeeklyGoals, fetchHabits, fetchLogs, scheduleRevision]);

  useEffect(() => {
    fetchJournalEntry(todayStr);
  }, [todayStr, fetchJournalEntry]);

  // Today's summary data
  const todayTasks = useMemo(
    () => tasks.filter((t) => t.date.slice(0, 10) === todayStr),
    [tasks, todayStr],
  );
  const todayTasksCompleted = todayTasks.filter((t) => t.completed).length;
  const todayTasksTotal = todayTasks.length;
  const taskProgress = todayTasksTotal > 0 ? todayTasksCompleted / todayTasksTotal : 0;

  const todayLogs = logs[todayStr] ?? [];
  const activeHabits = useMemo(
    () => habits.filter((h) => h.active),
    [habits],
  );
  const habitsCompletedToday = todayLogs.filter((l) => l.completed).length;
  const habitsTotal = activeHabits.length;
  const habitProgress = habitsTotal > 0 ? habitsCompletedToday / habitsTotal : 0;

  const overallTotal = todayTasksTotal + habitsTotal;
  const overallCompleted = todayTasksCompleted + habitsCompletedToday;
  const overallProgress = overallTotal > 0 ? overallCompleted / overallTotal : 0;

  useEffect(() => {
    if (overallTotal > 0 && overallCompleted === overallTotal) {
      setShowConfetti(true);
    }
  }, [overallTotal, overallCompleted]);

  const selectedDayTasks = useMemo(() => {
    if (selectedDayIndex === null) return tasks;
    const dayDate = formatDate(weekDays[selectedDayIndex].date);
    return tasks.filter((t) => t.date.slice(0, 10) === dayDate);
  }, [tasks, selectedDayIndex, weekDays]);

  // Heatmap data: compute completion % per day from tasks
  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    const byDate: Record<string, { total: number; done: number }> = {};
    tasks.forEach((t) => {
      // Сервер отдаёт дату ISO-строкой ('…T00:00:00.000Z') — сравниваем по дню.
      const d = t.date.slice(0, 10);
      if (!byDate[d]) byDate[d] = { total: 0, done: 0 };
      byDate[d].total++;
      if (t.completed) byDate[d].done++;
    });
    Object.entries(byDate).forEach(([date, { total, done }]) => {
      map[date] = total > 0 ? Math.round((done / total) * 100) : 0;
    });
    return map;
  }, [tasks]);

  const analytics = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const goalsCompleted = weeklyGoals.filter((g) => g.completed).length;
    return { total, completed, percentage, goalsCompleted, goalsTotal: weeklyGoals.length };
  }, [tasks, weeklyGoals]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchTasks(undefined, weekStartStr),
        fetchWeeklyGoals(weekStartStr),
        fetchHabits(),
        fetchLogs(weekStartStr, formatDate(sundayDate)),
        fetchJournalEntry(todayStr),
      ]);
    } catch {
      // silently fail
    }
    setRefreshing(false);
  }, [weekStartStr, sundayDate, todayStr, fetchTasks, fetchWeeklyGoals, fetchHabits, fetchLogs, fetchJournalEntry]);

  const handlePrevWeek = useCallback(() => {
    hapticSelection();
    setWeekOffset((prev) => prev - 1);
    setSelectedDayIndex(null);
  }, []);

  const handleNextWeek = useCallback(() => {
    hapticSelection();
    setWeekOffset((prev) => prev + 1);
    setSelectedDayIndex(null);
  }, []);

  // Пустая строка под целями недели: «Готово» добавляет, поле остаётся для следующей.
  const handleAddGoal = useCallback(
    (text: string) => createWeeklyGoal(weekStartStr, text),
    [weekStartStr, createWeeklyGoal],
  );

  const handleToggleGoal = useCallback(
    async (id: string, completed: boolean) => {
      hapticLight();
      try {
        await updateWeeklyGoal(id, { completed: !completed });
      } catch {
        // Error handled by store
      }
    },
    [updateWeeklyGoal],
  );

  const handleDeleteGoal = useCallback(
    async (id: string) => {
      try {
        await deleteWeeklyGoal(id);
      } catch {
        // Error handled by store
      }
    },
    [deleteWeeklyGoal],
  );



  const token = useAuthStore((state) => state.token);

  const handleGoodnight = useCallback(async () => {
    if (!token) return;
    try {
      const response = await api.post<{ reply: string }>(
        '/voice/assistant',
        { text: 'спокойной ночи' },
        token,
      );
      setEveningMessage(response.reply);
    } catch {
      setEveningMessage('Спокойной ночи! Отличный день позади.');
    }
    setDayProgress(overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0);
    setShowEveningRitual(true);
  }, [token, overallTotal, overallCompleted]);

  const handleEveningChipPress = useCallback((action: string) => {
    if (action === 'plan_tomorrow') {
      navigation.navigate('Tasks' as never);
    }
  }, [navigation]);

  const handleDismissEveningRitual = useCallback(() => setShowEveningRitual(false), []);

  const handleNavigateJournal = useCallback(() => navigation.navigate('Journal' as never), [navigation]);
  const handleNavigateTaskCapture = useCallback(() => navigation.navigate('TaskCapture' as never), [navigation]);
  const handleNavigateFocusMode = useCallback(() => navigation.navigate('FocusMode' as never), [navigation]);
  const handleNavigateKanbanBoard = useCallback(() => navigation.navigate('KanbanBoard' as never), [navigation]);
  const handleNavigateLifeInsights = useCallback(() => navigation.navigate('LifeInsights' as never), [navigation]);
  const handleNavigateCalendar = useCallback(() => navigation.navigate('Calendar' as never), [navigation]);

  const handleQuoteMuteToggle = useCallback(() => {
    if (quoteMuted) {
      setQuoteMuted(false);
      Speech.speak(`${quote.text} — ${quote.author}`, {
        language: 'ru-RU',
        rate: 0.85,
        pitch: 1.05,
      });
    } else {
      setQuoteMuted(true);
      Speech.stop();
    }
  }, [quoteMuted, quote]);

  // Пустая строка под задачами: дату из текста («завтра в 15:00») разбирает сервер.
  // Ошибку покажет сама строка «Новая задача» (текст не пропадёт).
  const handleQuickAddSubmit = useCallback((text: string) => useTaskStore.getState().quickAdd(text), []);

  // Сдвиг строки влево + красный минус — уже осознанное действие, без диалога.
  const handleDeleteTask = useCallback(async (id: string) => {
    try {
      await deleteTask(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка удаления';
      Alert.alert('Ошибка', msg);
    }
  }, [deleteTask]);

  const isLoading = tasksLoading || goalsLoading;

  return (
    <ScreenSafeArea style={styles.container} edges={['top']}>
      <KbScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={c.primary} />
        }
      >
        {/* Greeting + Quote */}
        <Text style={styles.greetingText}>
          {greeting}, {userName}!
        </Text>
        <Card style={styles.quoteCard}>
          <View style={styles.quoteHeader}>
            <Text style={[styles.quoteText, { flex: 1 }]}>{quote.text}</Text>
            <TouchableOpacity
              onPress={handleQuoteMuteToggle}
              hitSlop={8}
              style={styles.quoteSpeakerBtn}
              accessibilityRole="button"
              accessibilityLabel={quoteMuted ? 'Включить озвучку цитаты' : 'Выключить озвучку цитаты'}
            >
              <Text style={styles.quoteSpeakerIcon}>
                {quoteMuted ? '\u{1F507}' : '\u{1F50A}'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.quoteAuthor}>— {quote.author}</Text>
        </Card>

        {/* Day Progress Ring */}
        <View style={styles.dayProgressRow}>
          <ProgressRing
            progress={overallProgress}
            size={80}
            strokeWidth={6}
            color={overallProgress >= 1 ? c.success : c.primary}
            accessibilityLabel={`Прогресс дня: ${Math.round(overallProgress * 100)}%`}
          />
          <View style={styles.dayProgressInfo}>
            <Text style={styles.dayProgressTitle}>
              Прогресс дня
            </Text>
            <Text style={styles.dayProgressSubtitle}>
              {overallCompleted} из {overallTotal} выполнено
            </Text>
          </View>
        </View>

        {/* Today's Summary */}
        <FadeInView delay={100}>
          <View style={styles.summaryRow}>
            <SummaryCard
              label="Задачи"
              value={`${todayTasksCompleted}/${todayTasksTotal}`}
              color={c.primary}
              progress={taskProgress}
            />
            <SummaryCard
              label="Привычки"
              value={`${habitsCompletedToday}/${habitsTotal}`}
              color={c.success}
              progress={habitProgress}
            />
            <SummaryCard
              label="Настрой"
              value={moodEmoji(todayEntry?.mood)}
              color={c.secondary}
            />
          </View>
        </FadeInView>

        {/* Quick Actions */}
        {/* Сеткой, без прокрутки вбок: в ленте «Канбан» был обрезан у края, а свайп
            по ленте спорил с переходом в комнату — нажималась соседняя кнопка. */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateJournal}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4DD}'} Дневник</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateTaskCapture}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4F7}'} Камера</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateFocusMode}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F3AF}'} Фокус</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateKanbanBoard}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4CB}'} Канбан</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateCalendar}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4C5}'} Календарь</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleGoodnight}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F319}'} Отбой</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickActionPill, { backgroundColor: '#EF4444' + '30' }]}
            onPress={handleNavigateLifeInsights}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F50D}'} Правда</Text>
          </TouchableOpacity>
        </View>

        {/* Header */}
        <Text style={styles.screenTitle}>Планер</Text>

        {/* Week Navigation */}
        <View style={styles.weekNav}>
          <TouchableOpacity onPress={handlePrevWeek} hitSlop={12}>
            <Text style={styles.navArrow}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.weekLabel}>Неделя: {weekLabel}</Text>
          <TouchableOpacity onPress={handleNextWeek} hitSlop={12}>
            <Text style={styles.navArrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Week Days */}
        <View style={styles.weekRow}>
          {weekDays.map((day, index) => {
            const dayStr = formatDate(day.date);
            const isTodayDay = dayStr === todayStr;
            return (
              <WeekDayItem
                key={dayStr}
                dayLabel={day.label}
                dayNum={day.dayNum}
                isToday={isTodayDay}
                isSelected={selectedDayIndex === index}
                onPress={() => {
                  hapticSelection();
                  setSelectedDayIndex(selectedDayIndex === index ? null : index);
                }}
              />
            );
          })}
        </View>

        {/* Tasks for selected day / all week */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {selectedDayIndex !== null
              ? `Задачи — ${weekDays[selectedDayIndex].label}, ${weekDays[selectedDayIndex].dayNum}`
              : 'Все задачи недели'}
          </Text>
          {isLoading ? (
            <ActivityIndicator color={c.primary} style={styles.loader} />
          ) : selectedDayTasks.length === 0 ? (
            <Text style={styles.emptyText}>Нет задач</Text>
          ) : (
            selectedDayTasks.map((task, idx) => (
              <FadeInView key={task.id} delay={idx * 40}>
                <SwipeableRow
                  onDelete={() => handleDeleteTask(task.id)}
                  deleteLabel="Удалить задачу"
                >
                  <TaskRow
                    title={task.title}
                    category={task.category}
                    completed={task.completed}
                    time={task.time}
                    onToggle={() => toggleComplete(task.id)}
                    onOpen={() => setEditingTaskId(task.id)}
                  />
                </SwipeableRow>
              </FadeInView>
            ))
          )}
          {/* Добавление без плюсиков: тап по пустой строке под списком */}
          <TapToAdd hint="Новая задача" onSubmit={handleQuickAddSubmit} />
        </Card>

        {/* Weekly Goals */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Цели на неделю</Text>
          </View>

          {weeklyGoals.length === 0 && (
            <Text style={styles.emptyText}>Нет целей на эту неделю</Text>
          )}

          {weeklyGoals.map((goal, idx) => (
            <FadeInView key={goal.id} delay={idx * 50}>
              <SwipeableRow
                onDelete={() => handleDeleteGoal(goal.id)}
                deleteLabel="Удалить цель"
              >
                <View style={styles.goalRow}>
                  <Checkbox
                    checked={goal.completed}
                    onToggle={() => handleToggleGoal(goal.id, goal.completed)}
                    size={20}
                  />
                  <Text
                    style={[
                      styles.goalText,
                      goal.completed && styles.goalTextCompleted,
                    ]}
                    numberOfLines={2}
                  >
                    {goal.goalText}
                  </Text>
                </View>
              </SwipeableRow>
            </FadeInView>
          ))}

          {/* Добавление без плюсиков: тап по пустой строке в конце целей */}
          <TapToAdd hint="Новая цель недели" onSubmit={handleAddGoal} />
        </Card>

        {/* Year Activity Heatmap */}
        <FadeInView delay={150}>
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>
              Активность за год
            </Text>
            <Heatmap data={heatmapData} />
          </Card>
        </FadeInView>

        {/* Analytics */}
        <FadeInView delay={200}>
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Аналитика</Text>
            <View style={styles.analyticsGrid}>
              <FadeInView delay={250} style={styles.analyticsItemWrapper}>
                <View style={styles.analyticsItem}>
                  <Text style={styles.analyticsValue}>{analytics.total}</Text>
                  <Text style={styles.analyticsLabel}>Всего задач</Text>
                </View>
              </FadeInView>
              <FadeInView delay={300} style={styles.analyticsItemWrapper}>
                <View style={styles.analyticsItem}>
                  <Text style={[styles.analyticsValue, { color: c.success }]}>
                    {analytics.completed}
                  </Text>
                  <Text style={styles.analyticsLabel}>Выполнено</Text>
                </View>
              </FadeInView>
              <FadeInView delay={350} style={styles.analyticsItemWrapper}>
                <View style={styles.analyticsItem}>
                  <Text style={[styles.analyticsValue, { color: c.primary }]}>
                    {analytics.percentage}%
                  </Text>
                  <Text style={styles.analyticsLabel}>Прогресс</Text>
                </View>
              </FadeInView>
              <FadeInView delay={400} style={styles.analyticsItemWrapper}>
                <View style={styles.analyticsItem}>
                  <Text style={[styles.analyticsValue, { color: c.warning }]}>
                    {analytics.goalsCompleted}/{analytics.goalsTotal}
                  </Text>
                  <Text style={styles.analyticsLabel}>Целей</Text>
                </View>
              </FadeInView>
            </View>
          </Card>
        </FadeInView>
      </KbScrollView>


      {/* Confetti for 100% day */}
      <Confetti
        visible={showConfetti}
        onComplete={() => setShowConfetti(false)}
      />

      {/* Voice Modal removed — hold-to-record with auto-execute */}

      {/* Morning Greeting */}
      <MorningGreeting
        visible={shouldShowGreeting}
        onDismiss={dismissGreeting}
        greeting={morningGreeting}
        onChipPress={handleMorningChipPress}
      />

      {/* Evening Ritual */}
      <EveningRitual
        visible={showEveningRitual}
        onDismiss={handleDismissEveningRitual}
        message={eveningMessage}
        dayProgress={dayProgress}
        onChipPress={handleEveningChipPress}
      />

      <TaskEditSheet task={editingTask} onClose={closeTaskCard} />
    </ScreenSafeArea>
  );
}


type C = ReturnType<typeof useColors>;

function createStyles(c: C) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl * 3,
    },
    greetingText: {
      color: c.text,
      fontSize: fontSize.xxl,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    quoteCard: {
      backgroundColor: '#1A2540',
      marginBottom: spacing.md,
    },
    quoteText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontStyle: 'italic',
      lineHeight: 20,
      marginBottom: spacing.xs,
    },
    quoteAuthor: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      textAlign: 'right',
    },
    quoteHeader: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    quoteSpeakerBtn: {
      padding: spacing.xs,
    },
    quoteSpeakerIcon: {
      fontSize: 20,
    },
    dayProgressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
    },
    dayProgressInfo: {
      flex: 1,
    },
    dayProgressTitle: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
    },
    dayProgressSubtitle: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      marginTop: spacing.xs,
    },
    summaryRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    summaryCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 72,
    },
    summaryValue: {
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    summaryLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginTop: 2,
    },
    miniProgress: {
      width: '100%',
      height: 3,
      backgroundColor: c.surfaceLight,
      borderRadius: 2,
      marginBottom: spacing.xs,
      overflow: 'hidden',
    },
    miniProgressFill: {
      height: '100%',
      borderRadius: 2,
    },
    quickActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    quickActionPill: {
      // Три в ряд, переносом — все кнопки видны целиком.
      flexBasis: '30%',
      flexGrow: 1,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.xl,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    quickActionText: {
      color: c.text,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
    screenTitle: {
      color: c.text,
      fontSize: fontSize.xxl,
      fontWeight: '700',
      marginBottom: spacing.md,
    },
    weekNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    navArrow: {
      color: c.primary,
      fontSize: fontSize.xl,
      fontWeight: '700',
      paddingHorizontal: spacing.sm,
    },
    weekLabel: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    dayItem: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 60,
      borderRadius: borderRadius.md,
      backgroundColor: c.surface,
    },
    dayItemSelected: {
      backgroundColor: c.primary,
    },
    dayItemToday: {
      borderWidth: 2,
      borderColor: c.primary,
    },
    dayLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '500',
      marginBottom: 2,
    },
    dayLabelSelected: {
      color: c.text,
    },
    dayNum: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    dayNumSelected: {
      color: c.text,
    },
    section: {
      marginBottom: spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    loader: {
      marginVertical: spacing.md,
    },
    emptyText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    taskInfo: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    taskTitle: {
      color: c.text,
      fontSize: fontSize.sm,
      flex: 1,
    },
    taskTitleCompleted: {
      textDecorationLine: 'line-through',
      color: c.textSecondary,
    },
    taskTime: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginLeft: spacing.sm,
    },
    goalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    goalText: {
      flex: 1,
      color: c.text,
      fontSize: fontSize.sm,
    },
    goalTextCompleted: {
      textDecorationLine: 'line-through',
      color: c.textSecondary,
    },
    analyticsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    analyticsItemWrapper: {
      flex: 1,
      minWidth: '40%',
    },
    analyticsItem: {
      flex: 1,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      alignItems: 'center',
    },
    analyticsValue: {
      color: c.text,
      fontSize: fontSize.xl,
      fontWeight: '700',
    },
    analyticsLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginTop: spacing.xs,
    },
  });
}
