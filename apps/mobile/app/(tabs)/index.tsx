import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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
import { VoiceButton, VoiceModal, MorningGreeting, EveningRitual } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { useMorningGreeting } from '@/hooks/use-morning-greeting';
import { useTaskStore } from '@/stores/task-store';
import { useGoalStore } from '@/stores/goal-store';
import { useHabitStore } from '@/stores/habit-store';
import { useAuthStore } from '@/stores/auth-store';
import { useStepStore } from '@/stores/step-store';
import { useJournalStore } from '@/stores/journal-store';
import { usePetStore } from '@/stores/pet-store';
import { api } from '@/services/api';
import { getDailyQuote } from '@/utils/quotes';
import { formatDate, getWeekDays } from '@/utils/dates';
import { colors, spacing, fontSize, borderRadius } from '@/constants';
import { taskCategories } from '@/constants/categories';

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
  const cat = taskCategories[category as keyof typeof taskCategories];
  return (
    <View style={styles.taskRow}>
      <Checkbox checked={completed} onToggle={onToggle} size={20} />
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
  const navigation = useNavigation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [newGoalText, setNewGoalText] = useState('');
  const [addingGoal, setAddingGoal] = useState(false);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showEveningRitual, setShowEveningRitual] = useState(false);
  const [eveningMessage, setEveningMessage] = useState('');
  const [dayProgress, setDayProgress] = useState(0);

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
  const { todaySteps } = useStepStore();
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
  } = useVoice();

  const {
    shouldShowGreeting,
    greeting: morningGreeting,
    dismissGreeting,
    handleChipPress: handleMorningChipPress,
  } = useMorningGreeting();

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDate(today), [today]);
  const quote = useMemo(() => getDailyQuote(today), [today]);
  const greeting = useMemo(() => getGreeting(), []);
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

  const analytics = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const goalsCompleted = weeklyGoals.filter((g) => g.completed).length;
    return { total, completed, percentage, goalsCompleted, goalsTotal: weeklyGoals.length };
  }, [tasks, weeklyGoals]);

  const handlePrevWeek = useCallback(() => {
    setWeekOffset((prev) => prev - 1);
    setSelectedDayIndex(null);
  }, []);

  const handleNextWeek = useCallback(() => {
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
    setVoiceModalVisible(true);
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleFloatingVoicePress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      setVoiceModalVisible(true);
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

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
            onPress={() => navigation.navigate('Pet' as never)}
            reaction={petReaction}
          />
        </View>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting + Quote */}
        <Text style={styles.greetingText}>
          {greeting}, {userName}!
        </Text>
        <Card style={styles.quoteCard}>
          <Text style={styles.quoteText}>{quote.text}</Text>
          <Text style={styles.quoteAuthor}>— {quote.author}</Text>
        </Card>

        {/* Day Progress Ring */}
        <View style={styles.dayProgressRow}>
          <ProgressRing
            progress={overallProgress}
            size={80}
            strokeWidth={6}
            color={overallProgress >= 1 ? colors.success : colors.primary}
          />
          <View style={styles.dayProgressInfo}>
            <Text style={styles.dayProgressTitle}>
              {'\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0434\u043D\u044F'}
            </Text>
            <Text style={styles.dayProgressSubtitle}>
              {overallCompleted} \u0438\u0437 {overallTotal} \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E
            </Text>
          </View>
        </View>

        {/* Today's Summary */}
        <View style={styles.summaryRow}>
          <SummaryCard
            label="Задачи"
            value={`${todayTasksCompleted}/${todayTasksTotal}`}
            color={colors.primary}
            progress={taskProgress}
          />
          <SummaryCard
            label="Привычки"
            value={`${habitsCompletedToday}/${habitsTotal}`}
            color={colors.success}
            progress={habitProgress}
          />
          <SummaryCard
            label="Шаги"
            value={`\u{1F6B6} ${todaySteps}`}
            color={colors.warning}
          />
          <SummaryCard
            label="Настрой"
            value={getMoodEmoji(todayEntry?.mood)}
            color={colors.secondary}
          />
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={() => navigation.navigate('Journal' as never)}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F4DD}'} Дневник</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionPill}
            onPress={() => navigation.navigate('Activity' as never)}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F6B6}'} Активность</Text>
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
            onPress={handleGoodnight}
            activeOpacity={0.7}
          >
            <Text style={styles.quickActionText}>{'\u{1F319}'} Отбой</Text>
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
                onPress={() =>
                  setSelectedDayIndex(selectedDayIndex === index ? null : index)
                }
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
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : selectedDayTasks.length === 0 ? (
            <Text style={styles.emptyText}>Нет задач</Text>
          ) : (
            selectedDayTasks.map((task) => (
              <TaskRow
                key={task.id}
                title={task.title}
                category={task.category}
                completed={task.completed}
                time={task.time}
                onToggle={() => toggleComplete(task.id)}
              />
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

          {weeklyGoals.map((goal) => (
            <View key={goal.id} style={styles.goalRow}>
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
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {'\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u0437\u0430 \u0433\u043E\u0434'}
          </Text>
          <Heatmap data={{}} />
        </Card>

        {/* Analytics */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Аналитика</Text>
          <View style={styles.analyticsGrid}>
            <View style={styles.analyticsItem}>
              <Text style={styles.analyticsValue}>{analytics.total}</Text>
              <Text style={styles.analyticsLabel}>Всего задач</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={[styles.analyticsValue, { color: colors.success }]}>
                {analytics.completed}
              </Text>
              <Text style={styles.analyticsLabel}>Выполнено</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={[styles.analyticsValue, { color: colors.primary }]}>
                {analytics.percentage}%
              </Text>
              <Text style={styles.analyticsLabel}>Прогресс</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={[styles.analyticsValue, { color: colors.warning }]}>
                {analytics.goalsCompleted}/{analytics.goalsTotal}
              </Text>
              <Text style={styles.analyticsLabel}>Целей</Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* Floating Voice Button */}
      <VoiceButton
        onPress={handleFloatingVoicePress}
        isRecording={isRecording}
        isProcessing={isProcessing}
        style={styles.floatingVoice}
      />

      {/* Confetti for 100% day */}
      <Confetti
        visible={showConfetti}
        onComplete={() => setShowConfetti(false)}
      />

      {/* Voice Modal */}
      <VoiceModal
        visible={voiceModalVisible}
        onClose={() => setVoiceModalVisible(false)}
        isRecording={isRecording}
        isProcessing={isProcessing}
        result={lastResult}
        error={voiceError}
      />

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
        onDismiss={() => setShowEveningRitual(false)}
        message={eveningMessage}
        dayProgress={dayProgress}
        onChipPress={handleEveningChipPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  greetingText: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  quoteCard: {
    backgroundColor: '#1A2540',
    marginBottom: spacing.md,
  },
  quoteText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  quoteAuthor: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    textAlign: 'right',
  },
  dayProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  dayProgressInfo: {
    flex: 1,
  },
  dayProgressTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  dayProgressSubtitle: {
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
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
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  miniProgress: {
    width: '100%',
    height: 3,
    backgroundColor: colors.surfaceLight,
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
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  quickActionText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  screenTitle: {
    color: colors.text,
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
    color: colors.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
  },
  weekLabel: {
    color: colors.text,
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
    backgroundColor: colors.surface,
  },
  dayItemSelected: {
    backgroundColor: colors.primary,
  },
  dayItemToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dayLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginBottom: 2,
  },
  dayLabelSelected: {
    color: colors.text,
  },
  dayNum: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  dayNumSelected: {
    color: colors.text,
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
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  loader: {
    marginVertical: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
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
    borderBottomColor: colors.border,
  },
  taskInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    flex: 1,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  taskTime: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginLeft: spacing.sm,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  goalText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
  },
  goalTextCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  deleteIcon: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    padding: spacing.xs,
  },
  addButton: {
    color: colors.primary,
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
  analyticsItem: {
    flex: 1,
    minWidth: '40%',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  analyticsValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  analyticsLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  floatingVoice: {
    position: 'absolute',
    bottom: 90,
    right: 20,
  },
  petAvatarWrapper: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 10,
  },
});
