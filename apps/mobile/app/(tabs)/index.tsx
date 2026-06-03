import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ProgressRing } from '@/components/ui';
import { Heatmap } from '@/components/charts';
import { Confetti, PetAvatar } from '@/components/shared';
import { VoiceButton, MorningGreeting, EveningRitual, DictationModal } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { useMorningGreeting } from '@/hooks/use-morning-greeting';
import { useTaskStore } from '@/stores/task-store';
import { useGoalStore } from '@/stores/goal-store';
import { useHabitStore } from '@/stores/habit-store';
import { useAuthStore } from '@/stores/auth-store';
import { useJournalStore } from '@/stores/journal-store';
import { useFinanceStore } from '@/stores/finance-store';
import { usePetStore } from '@/stores/pet-store';
import { api } from '@/services/api';
import { getRandomQuote } from '@/utils/quotes';
import { formatDate, getWeekDays } from '@/utils/dates';
import { spacing, fontSize, borderRadius } from '@/constants';
import { taskCategories } from '@/constants/categories';

import { useColors } from '@/hooks/use-colors';
import { useUIStore } from '@/stores/ui-store';
import { QuickAddBar } from '@/components/ui/quick-add-bar';
import { FadeInView } from '@/components/ui/fade-in-view';
import { hapticLight, hapticSelection, hapticSuccess } from '@/services/haptics';
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const MOOD_EMOJIS: Record<number, string> = {
  1: '\u{1F614}',
  2: '\u{1F641}',
  3: '\u{1F610}',
  4: '\u{1F642}',
  5: '\u{1F604}',
};

function getMoodEmoji(mood: number | null | undefined): string {
  if (mood == null) return '\u2014';
  return MOOD_EMOJIS[mood] ?? '\u2014';
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
}: {
  title: string;
  category: string;
  completed: boolean;
  time: string | null;
  onToggle: () => void;
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
      <View style={styles.taskInfo}>
        <Text
          style={[styles.taskTitle, completed && styles.taskTitleCompleted]}
          numberOfLines={1}
        >
          {cat?.icon ?? ''} {title}
        </Text>
        {time ? (
          <Text style={styles.taskTime}>{time}</Text>
        ) : null}
      </View>
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
  const [newGoalText, setNewGoalText] = useState('');
  const [addingGoal, setAddingGoal] = useState(false);
  // voiceModalVisible removed — hold-to-record replaces modal
  const [showConfetti, setShowConfetti] = useState(false);
  const [dictationOpen, setDictationOpen] = useState(false);
  const [showEveningRitual, setShowEveningRitual] = useState(false);
  const [eveningMessage, setEveningMessage] = useState('');
  const [dayProgress, setDayProgress] = useState(0);
  const [quoteMuted, setQuoteMuted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasSpokenTodayRef = useRef(false);

  const { tasks, isLoading: tasksLoading, fetchTasks, toggleComplete } = useTaskStore();
  const {
    weeklyGoals,
    isLoading: goalsLoading,
    fetchWeeklyGoals,
    createWeeklyGoal,
    updateWeeklyGoal,
    deleteWeeklyGoal,
  } = useGoalStore();
  const { habits, logs, fetchHabits } = useHabitStore();
  const user = useAuthStore((state) => state.user);
  const { todayEntry, fetchEntry: fetchJournalEntry } = useJournalStore();
  const petData = usePetStore((s) => s.petData);
  const petReaction = usePetStore((s) => s.lastReaction);

  const {
    isRecording,
    isProcessing,
    lastResult,
    error: voiceError,
    startRecording,
    stopRecording,
    amplitude,
  } = useVoice();

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

  useEffect(() => {
    usePetStore.getState().fetchPet();
  }, []);

  useEffect(() => {
    fetchTasks(undefined, weekStartStr);
    fetchWeeklyGoals(weekStartStr);
    fetchHabits();
  }, [weekStartStr, fetchTasks, fetchWeeklyGoals, fetchHabits]);

  useEffect(() => {
    fetchJournalEntry(todayStr);
  }, [todayStr, fetchJournalEntry]);

  // Today's summary data
  const todayTasks = useMemo(
    () => tasks.filter((t) => t.date === todayStr),
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
    return tasks.filter((t) => t.date === dayDate);
  }, [tasks, selectedDayIndex, weekDays]);

  // Heatmap data: compute completion % per day from tasks
  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    const byDate: Record<string, { total: number; done: number }> = {};
    tasks.forEach((t) => {
      if (!byDate[t.date]) byDate[t.date] = { total: 0, done: 0 };
      byDate[t.date].total++;
      if (t.completed) byDate[t.date].done++;
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
        fetchJournalEntry(todayStr),
        usePetStore.getState().fetchPet(),
      ]);
    } catch {
      // silently fail
    }
    setRefreshing(false);
  }, [weekStartStr, todayStr, fetchTasks, fetchWeeklyGoals, fetchHabits, fetchJournalEntry]);

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

  const handleAddGoal = useCallback(async () => {
    if (!newGoalText.trim()) return;
    try {
      await createWeeklyGoal(weekStartStr, newGoalText.trim());
      setNewGoalText('');
      setAddingGoal(false);
    } catch {
      // Error handled by store
    }
  }, [newGoalText, weekStartStr, createWeeklyGoal]);

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

  const handleVoicePress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

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
  const handleNavigateArena = useCallback(() => navigation.navigate('Arena' as never), [navigation]);
  const handleNavigateFocusMode = useCallback(() => navigation.navigate('FocusMode' as never), [navigation]);
  const handleNavigateKanbanBoard = useCallback(() => navigation.navigate('KanbanBoard' as never), [navigation]);
  const handleNavigateVoiceConversation = useCallback(() => navigation.navigate('VoiceConversation' as never), [navigation]);
  const handleNavigatePet = useCallback(() => navigation.navigate('Pet' as never), [navigation]);
  const handleNavigateLifeInsights = useCallback(() => navigation.navigate('LifeInsights' as never), [navigation]);

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

  const handleQuickAddSubmit = useCallback(async (text: string) => {
    const quickAddFn = useTaskStore.getState().quickAdd;
    if (quickAddFn) await quickAddFn(text);
  }, []);

  const isLoading = tasksLoading || goalsLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {petData ? (
        <View style={styles.petAvatarWrapper}>
          <PetAvatar
            petType={petData.pet.type}
            state={petData.state}
            costume={petData.pet.costume}
            size={60}
            onPress={handleNavigatePet}
            reaction={petReaction}
          />
        </View>
      ) : null}
      <ScrollView
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
              value={getMoodEmoji(todayEntry?.mood)}
              color={c.secondary}
            />
          </View>
        </FadeInView>

        {/* Quick Actions */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleNavigateJournal}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4DD}'} Дневник</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={handleVoicePress}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F3A4}'} Голос</Text>
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
            onPress={handleNavigateArena}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u2694\uFE0F'} Арена</Text>
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
        </ScrollView>

        {/* Header */}
        <Text style={styles.screenTitle}>Планер</Text>

        {/* Quick Add */}
        {useUIStore.getState().isFeatureVisible('quick_add') && (
          <View style={styles.quickAddWrapper}>
            <QuickAddBar onSubmit={handleQuickAddSubmit} />
          </View>
        )}

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
                <TaskRow
                  title={task.title}
                  category={task.category}
                  completed={task.completed}
                  time={task.time}
                  onToggle={() => toggleComplete(task.id)}
                />
              </FadeInView>
            ))
          )}
        </Card>

        {/* Weekly Goals */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Цели на неделю</Text>
            {!addingGoal && (
              <TouchableOpacity onPress={() => setAddingGoal(true)}>
                <Text style={styles.addButton}>+ Добавить</Text>
              </TouchableOpacity>
            )}
          </View>

          {weeklyGoals.length === 0 && !addingGoal && (
            <Text style={styles.emptyText}>Нет целей на эту неделю</Text>
          )}

          {weeklyGoals.map((goal, idx) => (
            <FadeInView key={goal.id} delay={idx * 50}>
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
              <TouchableOpacity
                onPress={() => handleDeleteGoal(goal.id)}
                hitSlop={8}
              >
                <Text style={styles.deleteIcon}>{'\u2715'}</Text>
              </TouchableOpacity>
            </View>
            </FadeInView>
          ))}

          {addingGoal && (
            <View style={styles.addGoalRow}>
              <Input
                value={newGoalText}
                onChangeText={setNewGoalText}
                placeholder="Введите цель..."
                onSubmitEditing={handleAddGoal}
                returnKeyType="done"
                style={styles.goalInput}
              />
              <View style={styles.addGoalActions}>
                <Button
                  title="Добавить"
                  onPress={handleAddGoal}
                  size="sm"
                  disabled={!newGoalText.trim()}
                />
                <Button
                  title="Отмена"
                  onPress={() => {
                    setAddingGoal(false);
                    setNewGoalText('');
                  }}
                  variant="outline"
                  size="sm"
                />
              </View>
            </View>
          )}
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
      </ScrollView>

      {/* Floating Voice Button — tap opens JARVIS, hold for quick command */}
      <VoiceButton
        onPress={handleNavigateVoiceConversation}
        onPressIn={startRecording}
        onPressOut={stopRecording}
        isRecording={isRecording}
        isProcessing={isProcessing}
        amplitude={amplitude}
        style={styles.floatingVoice}
      />

      {/* Dictation FAB — рядом с голосовой кнопкой, открывает JARVIS-диктофон. */}
      <TouchableOpacity
        onPress={() => setDictationOpen(true)}
        style={styles.dictationFab}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="JARVIS диктофон — записать речь, выделить задачи и запомнить факты"
      >
        <Text style={styles.dictationFabEmoji}>🎙️</Text>
      </TouchableOpacity>

      <DictationModal
        visible={dictationOpen}
        onClose={() => setDictationOpen(false)}
      />

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
    </SafeAreaView>
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
    quickAddWrapper: {
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
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
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    quickActionPill: {
      flex: 1,
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
    deleteIcon: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      padding: spacing.xs,
    },
    addButton: {
      color: c.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    addGoalRow: {
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    goalInput: {
      flex: 1,
    },
    addGoalActions: {
      flexDirection: 'row',
      gap: spacing.sm,
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
    floatingVoice: {
      position: 'absolute',
      bottom: 90,
      right: 20,
    },
    dictationFab: {
      position: 'absolute',
      bottom: 100,
      right: 96, // левее VoiceButton (~60px+padding), не перекрывает
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 8,
    },
    dictationFabEmoji: { fontSize: 22 },
    petAvatarWrapper: {
      position: 'absolute',
      top: 8,
      right: 16,
      zIndex: 10,
    },
  });
}
