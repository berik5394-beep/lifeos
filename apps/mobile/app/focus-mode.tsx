import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import { PomodoroTimer } from '@/components/ui/pomodoro-timer';
import type { Theme } from '@/constants/themes';

interface FocusTask {
  id: string;
  title: string;
  category: string;
  priority: string;
}

const POMODORO_DURATION = 25 * 60; // 25 minutes
const BREAK_DURATION = 5 * 60; // 5 minutes

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: 'Низкий', color: '#22C55E' },
  medium: { label: 'Средний', color: '#3B82F6' },
  high: { label: 'Высокий', color: '#F97316' },
  critical: { label: 'Очень высокий', color: '#EF4444' },
};

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  work: { label: 'Работа', icon: 'briefcase' },
  personal: { label: 'Личное', icon: 'user' },
  health: { label: 'Здоровье', icon: 'heart' },
  finance: { label: 'Финансы', icon: 'dollar-sign' },
  education: { label: 'Образование', icon: 'book' },
  home: { label: 'Дом', icon: 'home' },
};

const createStyles = (c: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sessionCounter: {
      flex: 1,
      alignItems: 'flex-end',
    },
    sessionText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '600',
    },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    taskTitle: {
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    badges: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      gap: spacing.xs,
    },
    badgeText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
    timerSection: {
      marginVertical: spacing.xl,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.xl,
    },
    doneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.success,
      borderRadius: borderRadius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    doneButtonText: {
      color: '#fff',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    skipButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    skipButtonText: {
      color: c.textSecondary,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    nextHint: {
      position: 'absolute',
      bottom: spacing.xl,
      left: spacing.lg,
      right: spacing.lg,
      alignItems: 'center',
    },
    nextHintText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },
    nextHintTitle: {
      fontSize: fontSize.md,
      color: c.text,
      fontWeight: '600',
      marginTop: spacing.xs,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    emptyIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.success + '1A',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
    },
    emptySubtitle: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      textAlign: 'center',
    },
  });

// Demo tasks for standalone usage
const DEMO_TASKS: FocusTask[] = [
  { id: '1', title: 'Подготовить отчёт', category: 'work', priority: 'high' },
  { id: '2', title: 'Тренировка', category: 'health', priority: 'medium' },
  { id: '3', title: 'Прочитать книгу', category: 'education', priority: 'low' },
];

export default function FocusModeScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();

  const [tasks, setTasks] = useState<FocusTask[]>(DEMO_TASKS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(POMODORO_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentTask = tasks[currentIndex] ?? null;
  const nextTask = tasks[currentIndex + 1] ?? null;
  const totalSeconds = isBreak ? BREAK_DURATION : POMODORO_DURATION;

  useEffect(() => {
    if (isRunning && remainingSeconds > 0) {
      intervalRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            if (!isBreak) {
              setPomodoroCount((p) => p + 1);
              setIsBreak(true);
              return BREAK_DURATION;
            } else {
              setIsBreak(false);
              return POMODORO_DURATION;
            }
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, isBreak, remainingSeconds]);

  const handleToggle = useCallback(() => {
    setIsRunning((prev) => !prev);
  }, []);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setRemainingSeconds(isBreak ? BREAK_DURATION : POMODORO_DURATION);
  }, [isBreak]);

  const handleSkipBreak = useCallback(() => {
    setIsBreak(false);
    setIsRunning(false);
    setRemainingSeconds(POMODORO_DURATION);
  }, []);

  const handleDone = useCallback(() => {
    setIsRunning(false);
    setIsBreak(false);
    setRemainingSeconds(POMODORO_DURATION);
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const handleSkipTask = useCallback(() => {
    setIsRunning(false);
    setIsBreak(false);
    setRemainingSeconds(POMODORO_DURATION);
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const categoryInfo = currentTask
    ? CATEGORY_LABELS[currentTask.category] || { label: currentTask.category, icon: 'circle' }
    : null;
  const priorityInfo = currentTask
    ? PRIORITY_LABELS[currentTask.priority] || { label: currentTask.priority, color: '#6B7280' }
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={20} color={c.text} />
        </TouchableOpacity>
        <View style={styles.sessionCounter}>
          <Text style={styles.sessionText}>
            {'\uD83C\uDF45'} Помидоры: {pomodoroCount}
          </Text>
        </View>
      </View>

      {currentTask ? (
        <View style={styles.content}>
          <Text style={styles.taskTitle}>{currentTask.title}</Text>

          <View style={styles.badges}>
            {categoryInfo && (
              <View style={[styles.badge, { backgroundColor: c.primary + '1A' }]}>
                <Feather
                  name={categoryInfo.icon as keyof typeof Feather.glyphMap}
                  size={14}
                  color={c.primary}
                />
                <Text style={[styles.badgeText, { color: c.primary }]}>{categoryInfo.label}</Text>
              </View>
            )}
            {priorityInfo && (
              <View style={[styles.badge, { backgroundColor: priorityInfo.color + '1A' }]}>
                <Text style={[styles.badgeText, { color: priorityInfo.color }]}>
                  {priorityInfo.label}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.timerSection}>
            <PomodoroTimer
              totalSeconds={totalSeconds}
              remainingSeconds={remainingSeconds}
              isRunning={isRunning}
              isBreak={isBreak}
              onToggle={handleToggle}
              onReset={handleReset}
              onSkip={isBreak ? handleSkipBreak : undefined}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.doneButton} onPress={handleDone} activeOpacity={0.7}>
              <Feather name="check" size={20} color="#fff" />
              <Text style={styles.doneButtonText}>Готово</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipButton} onPress={handleSkipTask} activeOpacity={0.7}>
              <Feather name="skip-forward" size={18} color={c.textSecondary} />
              <Text style={styles.skipButtonText}>Пропустить</Text>
            </TouchableOpacity>
          </View>

          {nextTask && (
            <View style={styles.nextHint}>
              <Text style={styles.nextHintText}>Следующая:</Text>
              <Text style={styles.nextHintTitle}>{nextTask.title}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <Feather name="check-circle" size={40} color={c.success} />
          </View>
          <Text style={styles.emptyTitle}>Все задачи выполнены!</Text>
          <Text style={styles.emptySubtitle}>
            Отличная работа! Вы завершили {pomodoroCount} помидоров.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
