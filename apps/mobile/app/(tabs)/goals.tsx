import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
  TextInput,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { AnimatedProgressBar } from '@/components/ui/animated-progress-bar';

import { useGoalStore } from '@/stores/goal-store';
import { useHabitStore } from '@/stores/habit-store';
import { goalAreas, habitCategories } from '@/constants/categories';
import { spacing, fontSize, borderRadius } from '@/constants';
import { FadeInView } from '@/components/ui/fade-in-view';
import { useColors } from '@/hooks/use-colors';
import { hapticLight, hapticSelection } from '@/services/haptics';

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type GoalAreaKey = keyof typeof goalAreas;

const AREA_KEYS: GoalAreaKey[] = [
  'finance',
  'spirituality',
  'career',
  'health',
  'relationships',
  'creativity',
];

const CURRENT_YEAR = new Date().getFullYear();
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─────────────────── Frequency helpers ───────────────────

const FREQUENCY_OPTIONS = [
  { key: 'daily', label: 'Ежедневно' },
  { key: 'weekly', label: 'Еженедельно' },
  { key: 'monthly', label: 'Ежемесячно' },
] as const;

type FrequencyKey = (typeof FREQUENCY_OPTIONS)[number]['key'];

function getFrequencyLabel(freq: string): string {
  const found = FREQUENCY_OPTIONS.find((f) => f.key === freq);
  return found ? found.label : freq;
}

// ─────────────────── Habit item (memoized) ───────────────────

interface HabitItemProps {
  habit: {
    id: string;
    name: string;
    category: string;
    frequency: string;
    goalId: string | null;
    active: boolean;
  };
  streak: number;
  areaColor: string;
  todayCompleted: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
  onUnlink: (habitId: string) => void;
  c: ReturnType<typeof useColors>;
}

const HabitItem = React.memo(function HabitItem({
  habit,
  streak,
  areaColor,
  todayCompleted,
  onToggle,
  onUnlink,
  c,
}: HabitItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleToggle = useCallback(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 0.92,
        useNativeDriver: true,
        speed: 40,
        bounciness: 6,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 8,
      }),
    ]).start();
    hapticLight();
    onToggle(habit.id, !todayCompleted);
  }, [habit.id, todayCompleted, onToggle, scaleAnim]);

  const handleUnlink = useCallback(() => {
    Alert.alert(
      'Отвязать привычку',
      `Отвязать "${habit.name}" от цели? Привычка останется в трекере.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отвязать',
          style: 'destructive',
          onPress: () => onUnlink(habit.id),
        },
      ],
    );
  }, [habit.id, habit.name, onUnlink]);

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          backgroundColor: c.surface,
          borderRadius: borderRadius.sm,
          marginBottom: spacing.xs,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        onPress={handleToggle}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 2,
          borderColor: todayCompleted ? areaColor : c.border,
          backgroundColor: todayCompleted ? areaColor : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
        }}
        activeOpacity={0.7}
      >
        {todayCompleted && (
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
            ✓
          </Text>
        )}
      </TouchableOpacity>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: fontSize.sm,
            fontWeight: '600',
            color: todayCompleted ? c.textSecondary : c.text,
            textDecorationLine: todayCompleted ? 'line-through' : 'none',
          }}
          numberOfLines={1}
        >
          {habit.name}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: c.textSecondary, marginTop: 2 }}>
          {getFrequencyLabel(habit.frequency)}
          {streak > 0 ? ` · 🔥 ${streak} дн.` : ''}
        </Text>
      </View>

      <TouchableOpacity onPress={handleUnlink} style={{ padding: spacing.xs }}>
        <Text style={{ fontSize: 16, color: c.textSecondary }}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ─────────────────── Goal item (memoized) ───────────────────

interface GoalItemProps {
  goal: {
    id: string;
    goalText: string;
    progress: number;
    area: string;
  };
  areaColor: string;
  onEdit: (goal: { id: string; goalText: string; progress: number; area: string }) => void;
  onDelete: (id: string, text: string) => void;
  onProgressChange: (id: string, progress: number) => void;
  c: ReturnType<typeof useColors>;
}

const GoalItem = React.memo(function GoalItem({
  goal,
  areaColor,
  onEdit,
  onDelete,
  onProgressChange,
  c,
}: GoalItemProps) {
  const progressPercent = Math.round(goal.progress * 100);
  const isComplete = progressPercent >= 100;

  const handleEdit = useCallback(() => {
    onEdit(goal);
  }, [goal, onEdit]);

  const handleDelete = useCallback(() => {
    onDelete(goal.id, goal.goalText);
  }, [goal.id, goal.goalText, onDelete]);

  const handleSliderDecrease = useCallback(() => {
    const newVal = Math.max(0, goal.progress - 0.1);
    onProgressChange(goal.id, Math.round(newVal * 10) / 10);
  }, [goal.id, goal.progress, onProgressChange]);

  const handleSliderIncrease = useCallback(() => {
    const newVal = Math.min(1, goal.progress + 0.1);
    onProgressChange(goal.id, Math.round(newVal * 10) / 10);
  }, [goal.id, goal.progress, onProgressChange]);

  return (
    <View
      accessible={true}
      accessibilityLabel={`${goal.goalText}, прогресс ${Math.round(goal.progress * 100)}%`}
      style={{
        backgroundColor: c.surface,
        borderRadius: borderRadius.md,
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderLeftWidth: 3,
        borderLeftColor: areaColor,
      }}
    >
      {/* Goal text + action buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: fontSize.md,
              fontWeight: '600',
              color: c.text,
              lineHeight: fontSize.md * 1.4,
            }}
          >
            {isComplete ? '🎉 ' : ''}
            {goal.goalText}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', marginLeft: spacing.sm }}>
          <TouchableOpacity
            onPress={handleEdit}
            style={{ padding: spacing.xs }}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Редактировать цель"
          >
            <Text style={{ fontSize: 16 }}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            style={{ padding: spacing.xs, marginLeft: spacing.xs }}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Удалить цель"
          >
            <Text style={{ fontSize: 16 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress bar + controls */}
      <View style={{ marginTop: spacing.sm }}>
        <AnimatedProgressBar
          progress={progressPercent}
          color={areaColor}
          height={10}
          showLabel={false}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: spacing.xs,
          }}
        >
          <TouchableOpacity
            onPress={handleSliderDecrease}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: c.surfaceLight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.6}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>−</Text>
          </TouchableOpacity>

          <Text
            style={{
              fontSize: fontSize.lg,
              fontWeight: '700',
              color: isComplete ? areaColor : c.text,
            }}
          >
            {progressPercent}%
          </Text>

          <TouchableOpacity
            onPress={handleSliderIncrease}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: c.surfaceLight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.6}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// ─────────────────── Area card (memoized, expandable) ───────────────────

interface AreaCardProps {
  areaKey: GoalAreaKey;
  goals: {
    id: string;
    goalText: string;
    progress: number;
    area: string;
    habits?: { id: string; name: string; category: string }[];
  }[];
  habits: {
    id: string;
    name: string;
    category: string;
    frequency: string;
    goalId: string | null;
    active: boolean;
  }[];
  habitStats: { habitId: string; streak: number }[];
  todayLogs: { habitId: string; completed: boolean }[];
  isExpanded: boolean;
  onToggleExpand: (key: GoalAreaKey) => void;
  onAddGoal: (area: GoalAreaKey) => void;
  onEditGoal: (goal: { id: string; goalText: string; progress: number; area: string }) => void;
  onDeleteGoal: (id: string, text: string) => void;
  onProgressChange: (id: string, progress: number) => void;
  onToggleHabit: (habitId: string, completed: boolean) => void;
  onUnlinkHabit: (habitId: string) => void;
  onLinkHabit: (area: GoalAreaKey) => void;
  c: ReturnType<typeof useColors>;
}

const AreaCard = React.memo(function AreaCard({
  areaKey,
  goals,
  habits,
  habitStats,
  todayLogs,
  isExpanded,
  onToggleExpand,
  onAddGoal,
  onEditGoal,
  onDeleteGoal,
  onProgressChange,
  onToggleHabit,
  onUnlinkHabit,
  onLinkHabit,
  c,
}: AreaCardProps) {
  const area = goalAreas[areaKey];
  const areaColor = area.color;
  const rotateAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotateAnim, {
      toValue: isExpanded ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isExpanded, rotateAnim]);

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // Compute area progress
  const areaProgress = useMemo(() => {
    if (goals.length === 0) return 0;
    const sum = goals.reduce((acc, g) => acc + g.progress, 0);
    return Math.round((sum / goals.length) * 100);
  }, [goals]);

  // Filter habits linked to goals in this area
  const linkedHabits = useMemo(() => {
    const goalIds = new Set(goals.map((g) => g.id));
    return habits.filter((h) => h.goalId && goalIds.has(h.goalId) && h.active);
  }, [goals, habits]);

  // Group linked habits by frequency
  const dailyHabits = useMemo(
    () => linkedHabits.filter((h) => h.frequency === 'daily'),
    [linkedHabits],
  );
  const weeklyHabits = useMemo(
    () => linkedHabits.filter((h) => h.frequency === 'weekly'),
    [linkedHabits],
  );
  const monthlyHabits = useMemo(
    () => linkedHabits.filter((h) => h.frequency === 'monthly'),
    [linkedHabits],
  );

  const allComplete = areaProgress >= 100 && goals.length > 0;

  const handleToggleExpand = useCallback(() => {
    onToggleExpand(areaKey);
  }, [areaKey, onToggleExpand]);

  const handleAddGoal = useCallback(() => {
    onAddGoal(areaKey);
  }, [areaKey, onAddGoal]);

  const handleLinkHabit = useCallback(() => {
    onLinkHabit(areaKey);
  }, [areaKey, onLinkHabit]);

  const getStreakForHabit = useCallback(
    (habitId: string): number => {
      const stat = habitStats.find((s) => s.habitId === habitId);
      return stat ? stat.streak : 0;
    },
    [habitStats],
  );

  const isTodayCompleted = useCallback(
    (habitId: string): boolean => {
      const log = todayLogs.find((l) => l.habitId === habitId);
      return log ? log.completed : false;
    },
    [todayLogs],
  );

  const renderHabitGroup = useCallback(
    (title: string, habitsGroup: typeof dailyHabits) => {
      if (habitsGroup.length === 0) return null;
      return (
        <View style={{ marginTop: spacing.sm }}>
          <Text
            style={{
              fontSize: fontSize.xs,
              fontWeight: '700',
              color: c.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: spacing.xs,
              paddingHorizontal: spacing.xs,
            }}
          >
            {title}
          </Text>
          {habitsGroup.map((habit) => (
            <HabitItem
              key={habit.id}
              habit={habit}
              streak={getStreakForHabit(habit.id)}
              areaColor={areaColor}
              todayCompleted={isTodayCompleted(habit.id)}
              onToggle={onToggleHabit}
              onUnlink={onUnlinkHabit}
              c={c}
            />
          ))}
        </View>
      );
    },
    [c, areaColor, getStreakForHabit, isTodayCompleted, onToggleHabit, onUnlinkHabit],
  );

  return (
    <View
      style={{
        marginBottom: spacing.md,
        borderRadius: borderRadius.lg,
        backgroundColor: c.surface,
        overflow: 'hidden',
        borderWidth: isExpanded ? 1 : 0,
        borderColor: isExpanded ? areaColor + '40' : 'transparent',
      }}
    >
      {/* Collapsed header — always visible */}
      <TouchableOpacity
        onPress={handleToggleExpand}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: spacing.md,
          paddingVertical: spacing.md + 2,
        }}
      >
        {/* Area icon circle */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: areaColor + '20',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: spacing.md,
          }}
        >
          <Text style={{ fontSize: 22 }}>{area.icon}</Text>
        </View>

        {/* Area name + meta */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: fontSize.md,
              fontWeight: '700',
              color: c.text,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {allComplete ? '🏆 ' : ''}
            {area.label}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Text style={{ fontSize: fontSize.xs, color: c.textSecondary }}>
              {goals.length}{' '}
              {goals.length === 1
                ? 'цель'
                : goals.length >= 2 && goals.length <= 4
                  ? 'цели'
                  : 'целей'}
              {linkedHabits.length > 0 ? ` · ${linkedHabits.length} привычек` : ''}
            </Text>
          </View>
        </View>

        {/* Progress circle */}
        <View style={{ alignItems: 'center', marginRight: spacing.sm }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              borderWidth: 3,
              borderColor: goals.length > 0 ? areaColor : c.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontSize: fontSize.xs,
                fontWeight: '700',
                color: goals.length > 0 ? areaColor : c.textSecondary,
              }}
            >
              {areaProgress}%
            </Text>
          </View>
        </View>

        {/* Expand chevron */}
        <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
          <Text style={{ fontSize: 18, color: c.textSecondary }}>▼</Text>
        </Animated.View>
      </TouchableOpacity>

      {/* Progress bar under header */}
      {goals.length > 0 && (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: isExpanded ? 0 : spacing.sm }}>
          <AnimatedProgressBar
            progress={areaProgress}
            color={areaColor}
            height={6}
            showLabel={false}
          />
        </View>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <View style={{ padding: spacing.md, paddingTop: spacing.md }}>
          {/* ────── Goals section ────── */}
          <View style={{ marginBottom: spacing.md }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing.sm,
              }}
            >
              <Text
                style={{
                  fontSize: fontSize.sm,
                  fontWeight: '700',
                  color: c.text,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Цели на год
              </Text>
              <TouchableOpacity
                onPress={handleAddGoal}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  backgroundColor: areaColor + '20',
                  borderRadius: borderRadius.sm,
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, color: areaColor, fontWeight: '600' }}>
                  + Добавить
                </Text>
              </TouchableOpacity>
            </View>

            {goals.length === 0 ? (
              <View
                style={{
                  paddingVertical: spacing.xl,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 36, marginBottom: spacing.sm }}>🎯</Text>
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: c.textSecondary,
                    textAlign: 'center',
                    lineHeight: fontSize.sm * 1.5,
                  }}
                >
                  Нет целей. Добавьте свою{'\n'}первую цель!
                </Text>
              </View>
            ) : (
              goals.map((goal, idx) => (
                <FadeInView key={goal.id} delay={idx * 60}>
                  <GoalItem
                    goal={goal}
                    areaColor={areaColor}
                    onEdit={onEditGoal}
                    onDelete={onDeleteGoal}
                    onProgressChange={onProgressChange}
                    c={c}
                  />
                </FadeInView>
              ))
            )}
          </View>

          {/* ────── Habits section ────── */}
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing.xs,
              }}
            >
              <Text
                style={{
                  fontSize: fontSize.sm,
                  fontWeight: '700',
                  color: c.text,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Привычки
              </Text>
              <TouchableOpacity
                onPress={handleLinkHabit}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  backgroundColor: areaColor + '20',
                  borderRadius: borderRadius.sm,
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, color: areaColor, fontWeight: '600' }}>
                  + Привязать
                </Text>
              </TouchableOpacity>
            </View>

            {linkedHabits.length === 0 ? (
              <View
                style={{
                  paddingVertical: spacing.lg,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.xs,
                    color: c.textSecondary,
                    textAlign: 'center',
                  }}
                >
                  Привяжите привычки к целям{'\n'}для автоматического прогресса
                </Text>
              </View>
            ) : (
              <>
                {renderHabitGroup('Ежедневные', dailyHabits)}
                {renderHabitGroup('Еженедельные', weeklyHabits)}
                {renderHabitGroup('Ежемесячные', monthlyHabits)}
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
});

// ─────────────────── Area chip selector ───────────────────

interface AreaChipSelectorProps {
  selected: GoalAreaKey | null;
  onSelect: (key: GoalAreaKey) => void;
  c: ReturnType<typeof useColors>;
}

const AreaChipSelector = React.memo(function AreaChipSelector({
  selected,
  onSelect,
  c,
}: AreaChipSelectorProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginBottom: spacing.md,
      }}
    >
      {AREA_KEYS.map((key) => {
        const area = goalAreas[key];
        const isSelected = selected === key;
        return (
          <TouchableOpacity
            key={key}
            onPress={() => onSelect(key)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: borderRadius.xl,
              backgroundColor: isSelected ? area.color + '30' : c.surfaceLight,
              borderWidth: isSelected ? 1.5 : 1,
              borderColor: isSelected ? area.color : c.border,
            }}
          >
            <Text style={{ fontSize: 16, marginRight: spacing.xs }}>{area.icon}</Text>
            <Text
              style={{
                fontSize: fontSize.sm,
                fontWeight: isSelected ? '700' : '500',
                color: isSelected ? area.color : c.textSecondary,
              }}
            >
              {area.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ─────────────────── Habit selector for linking ───────────────────

interface HabitSelectorItemProps {
  habit: {
    id: string;
    name: string;
    category: string;
    frequency: string;
    goalId: string | null;
    active: boolean;
  };
  isLinked: boolean;
  areaColor: string;
  onToggle: (habitId: string) => void;
  c: ReturnType<typeof useColors>;
}

const HabitSelectorItem = React.memo(function HabitSelectorItem({
  habit,
  isLinked,
  areaColor,
  onToggle,
  c,
}: HabitSelectorItemProps) {
  const catInfo = habitCategories[habit.category as keyof typeof habitCategories];
  const handlePress = useCallback(() => {
    onToggle(habit.id);
  }, [habit.id, onToggle]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        backgroundColor: isLinked ? areaColor + '15' : c.surface,
        borderRadius: borderRadius.sm,
        marginBottom: spacing.xs,
        borderWidth: isLinked ? 1 : 0,
        borderColor: isLinked ? areaColor + '50' : 'transparent',
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: isLinked ? areaColor : c.border,
          backgroundColor: isLinked ? areaColor : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
        }}
      >
        {isLinked && (
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>✓</Text>
        )}
      </View>

      <Text style={{ fontSize: 16, marginRight: spacing.sm }}>
        {catInfo?.icon ?? '📌'}
      </Text>

      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: fontSize.sm, fontWeight: '600', color: c.text }}
          numberOfLines={1}
        >
          {habit.name}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: c.textSecondary, marginTop: 1 }}>
          {getFrequencyLabel(habit.frequency)}
          {habit.goalId && !isLinked ? ' · уже привязана' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ─────────────────── Create habit inline form ───────────────────

interface CreateHabitFormProps {
  areaColor: string;
  onSubmit: (name: string, category: string, frequency: string) => void;
  onCancel: () => void;
  c: ReturnType<typeof useColors>;
}

const CreateHabitForm = React.memo(function CreateHabitForm({
  areaColor,
  onSubmit,
  onCancel,
  c,
}: CreateHabitFormProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('personal');
  const [frequency, setFrequency] = useState<FrequencyKey>('daily');

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSubmit(name.trim(), category, frequency);
    setName('');
  }, [name, category, frequency, onSubmit]);

  return (
    <View
      style={{
        padding: spacing.md,
        backgroundColor: c.surfaceLight,
        borderRadius: borderRadius.md,
        marginTop: spacing.sm,
      }}
    >
      <Text
        style={{
          fontSize: fontSize.sm,
          fontWeight: '700',
          color: c.text,
          marginBottom: spacing.sm,
        }}
      >
        Новая привычка
      </Text>

      <Input
        value={name}
        onChangeText={setName}
        placeholder="Название привычки"
        style={{ marginBottom: spacing.sm }}
      />

      {/* Category chips */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {(Object.keys(habitCategories) as (keyof typeof habitCategories)[]).map((key) => {
          const cat = habitCategories[key];
          const sel = category === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setCategory(key)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: borderRadius.xl,
                backgroundColor: sel ? cat.color + '30' : c.surface,
                borderWidth: 1,
                borderColor: sel ? cat.color : c.border,
              }}
            >
              <Text
                style={{
                  fontSize: fontSize.xs,
                  color: sel ? cat.color : c.textSecondary,
                  fontWeight: sel ? '700' : '500',
                }}
              >
                {cat.icon} {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Frequency chips */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {FREQUENCY_OPTIONS.map((opt) => {
          const sel = frequency === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setFrequency(opt.key)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: borderRadius.xl,
                backgroundColor: sel ? areaColor + '30' : c.surface,
                borderWidth: 1,
                borderColor: sel ? areaColor : c.border,
              }}
            >
              <Text
                style={{
                  fontSize: fontSize.xs,
                  color: sel ? areaColor : c.textSecondary,
                  fontWeight: sel ? '700' : '500',
                }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity
          onPress={onCancel}
          style={{
            flex: 1,
            paddingVertical: spacing.sm,
            borderRadius: borderRadius.sm,
            backgroundColor: c.surface,
            alignItems: 'center',
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: fontSize.sm, color: c.textSecondary }}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit}
          style={{
            flex: 1,
            paddingVertical: spacing.sm,
            borderRadius: borderRadius.sm,
            backgroundColor: areaColor,
            alignItems: 'center',
            opacity: name.trim() ? 1 : 0.5,
          }}
          activeOpacity={0.7}
          disabled={!name.trim()}
        >
          <Text style={{ fontSize: fontSize.sm, fontWeight: '700', color: '#FFFFFF' }}>
            Создать
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════
//                    MAIN SCREEN
// ═══════════════════════════════════════════════════════════

export default function GoalsScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  // ── Stores ──
  const {
    yearlyGoals,
    isLoading,
    fetchYearlyGoals,
    createYearlyGoal,
    updateYearlyGoal,
    deleteYearlyGoal,
  } = useGoalStore();

  const {
    habits,
    stats: habitStatsRaw,
    logs: habitLogsRaw,
    fetchHabits,
    createHabit,
    updateHabit,
    toggleHabitLog,
    fetchStats,
  } = useHabitStore();

  // ── State ──
  const [year, setYear] = useState(CURRENT_YEAR);
  const [expandedAreas, setExpandedAreas] = useState<Set<GoalAreaKey>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Goal modal
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [editingGoal, setEditingGoal] = useState<{
    id: string;
    goalText: string;
    progress: number;
    area: string;
  } | null>(null);
  const [modalArea, setModalArea] = useState<GoalAreaKey | null>(null);
  const [modalGoalText, setModalGoalText] = useState('');
  const [modalProgress, setModalProgress] = useState(0);

  // Link habit modal
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [linkArea, setLinkArea] = useState<GoalAreaKey | null>(null);
  const [showCreateHabitForm, setShowCreateHabitForm] = useState(false);

  // ── Derived data ──
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const currentMonthStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const goalsForYear = useMemo(
    () => yearlyGoals.filter((g) => g.year === year),
    [yearlyGoals, year],
  );

  const goalsByArea = useMemo(() => {
    const map: Record<GoalAreaKey, typeof goalsForYear> = {
      finance: [],
      spirituality: [],
      career: [],
      health: [],
      relationships: [],
      creativity: [],
    };
    for (const goal of goalsForYear) {
      const key = goal.area as GoalAreaKey;
      if (key in map) {
        map[key].push(goal);
      }
    }
    return map;
  }, [goalsForYear]);

  const overallProgress = useMemo(() => {
    if (goalsForYear.length === 0) return 0;
    const sum = goalsForYear.reduce((acc, g) => acc + g.progress, 0);
    return Math.round((sum / goalsForYear.length) * 100);
  }, [goalsForYear]);

  const habitStats = useMemo(
    () =>
      habitStatsRaw.map((s) => ({
        habitId: s.habitId,
        streak: s.streak,
      })),
    [habitStatsRaw],
  );

  const todayLogs = useMemo(() => {
    const logsForToday = habitLogsRaw[todayStr] ?? [];
    return logsForToday.map((l) => ({
      habitId: l.habitId,
      completed: l.completed,
    }));
  }, [habitLogsRaw, todayStr]);

  // Goals for the link modal — only goals in selected area
  const goalsForLinkArea = useMemo(() => {
    if (!linkArea) return [];
    return goalsByArea[linkArea];
  }, [linkArea, goalsByArea]);

  // Available habits for linking — only show habits not already linked to other areas
  const availableHabitsForLink = useMemo(() => {
    if (!linkArea) return [];
    const goalsInArea = goalsByArea[linkArea];
    const goalIdsInArea = new Set(goalsInArea.map((g) => g.id));
    return habits.filter(
      (h) => h.active && (!h.goalId || goalIdsInArea.has(h.goalId)),
    );
  }, [linkArea, goalsByArea, habits]);

  // Currently linked habit IDs for this area
  const linkedHabitIdsInArea = useMemo(() => {
    if (!linkArea) return new Set<string>();
    const goalsInArea = goalsByArea[linkArea];
    const goalIdsInArea = new Set(goalsInArea.map((g) => g.id));
    return new Set(
      habits.filter((h) => h.goalId && goalIdsInArea.has(h.goalId)).map((h) => h.id),
    );
  }, [linkArea, goalsByArea, habits]);

  // ── Data loading ──
  const loadData = useCallback(async () => {
    try {
      await Promise.all([
        fetchYearlyGoals(year),
        fetchHabits(),
        fetchStats(currentMonthStr),
      ]);
    } catch {
      // silent
    }
  }, [year, currentMonthStr, fetchYearlyGoals, fetchHabits, fetchStats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── Year navigation ──
  const handlePrevYear = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setYear((y) => y - 1);
  }, []);

  const handleNextYear = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setYear((y) => y + 1);
  }, []);

  // ── Expand/collapse areas ──
  const handleToggleExpand = useCallback((areaKey: GoalAreaKey) => {
    hapticSelection();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaKey)) {
        next.delete(areaKey);
      } else {
        next.add(areaKey);
      }
      return next;
    });
  }, []);

  // ── Goal CRUD ──
  const handleAddGoal = useCallback((area: GoalAreaKey) => {
    setEditingGoal(null);
    setModalArea(area);
    setModalGoalText('');
    setModalProgress(0);
    setGoalModalVisible(true);
  }, []);

  const handleEditGoal = useCallback(
    (goal: { id: string; goalText: string; progress: number; area: string }) => {
      setEditingGoal(goal);
      setModalArea(goal.area as GoalAreaKey);
      setModalGoalText(goal.goalText);
      setModalProgress(Math.round(goal.progress * 100));
      setGoalModalVisible(true);
    },
    [],
  );

  const handleDeleteGoal = useCallback(
    (id: string, text: string) => {
      Alert.alert('Удалить цель', `Вы уверены, что хотите удалить "${text}"?`, [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteYearlyGoal(id);
            } catch {
              Alert.alert('Ошибка', 'Не удалось удалить цель');
            }
          },
        },
      ]);
    },
    [deleteYearlyGoal],
  );

  const handleProgressChange = useCallback(
    async (id: string, progress: number) => {
      try {
        await updateYearlyGoal(id, { progress });
      } catch {
        Alert.alert('Ошибка', 'Не удалось обновить прогресс');
      }
    },
    [updateYearlyGoal],
  );

  const handleSaveGoal = useCallback(async () => {
    if (!modalArea || !modalGoalText.trim()) return;

    try {
      if (editingGoal) {
        await updateYearlyGoal(editingGoal.id, {
          area: modalArea,
          goalText: modalGoalText.trim(),
          progress: modalProgress / 100,
        });
      } else {
        await createYearlyGoal({
          year,
          area: modalArea,
          goalText: modalGoalText.trim(),
        });
      }
      setGoalModalVisible(false);
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить цель');
    }
  }, [
    editingGoal,
    modalArea,
    modalGoalText,
    modalProgress,
    year,
    createYearlyGoal,
    updateYearlyGoal,
  ]);

  const handleCloseGoalModal = useCallback(() => {
    setGoalModalVisible(false);
  }, []);

  // ── Habit toggle ──
  const handleToggleHabit = useCallback(
    async (habitId: string, completed: boolean) => {
      try {
        await toggleHabitLog(habitId, todayStr, completed);
      } catch {
        Alert.alert('Ошибка', 'Не удалось отметить привычку');
      }
    },
    [toggleHabitLog, todayStr],
  );

  // ── Habit linking ──
  const handleOpenLinkModal = useCallback((area: GoalAreaKey) => {
    setLinkArea(area);
    setShowCreateHabitForm(false);
    setLinkModalVisible(true);
  }, []);

  const handleCloseLinkModal = useCallback(() => {
    setLinkModalVisible(false);
    setShowCreateHabitForm(false);
  }, []);

  const handleToggleLinkHabit = useCallback(
    async (habitId: string) => {
      if (!linkArea) return;
      const goalsInArea = goalsByArea[linkArea];
      if (goalsInArea.length === 0) {
        Alert.alert('Нет целей', 'Сначала добавьте цель в эту область');
        return;
      }

      const habit = habits.find((h) => h.id === habitId);
      if (!habit) return;

      try {
        if (habit.goalId && linkedHabitIdsInArea.has(habitId)) {
          // Unlink
          await updateHabit(habitId, { goalId: null } );
        } else {
          // Link to first goal in area
          const targetGoal = goalsInArea[0];
          await updateHabit(habitId, { goalId: targetGoal.id } );
        }
        await fetchHabits();
      } catch {
        Alert.alert('Ошибка', 'Не удалось привязать привычку');
      }
    },
    [linkArea, goalsByArea, habits, linkedHabitIdsInArea, updateHabit, fetchHabits],
  );

  const handleUnlinkHabit = useCallback(
    async (habitId: string) => {
      try {
        await updateHabit(habitId, { goalId: null } );
        await fetchHabits();
      } catch {
        Alert.alert('Ошибка', 'Не удалось отвязать привычку');
      }
    },
    [updateHabit, fetchHabits],
  );

  const handleShowCreateHabitForm = useCallback(() => {
    setShowCreateHabitForm(true);
  }, []);

  const handleCancelCreateHabit = useCallback(() => {
    setShowCreateHabitForm(false);
  }, []);

  const handleCreateAndLinkHabit = useCallback(
    async (name: string, category: string, frequency: string) => {
      if (!linkArea) return;
      const goalsInArea = goalsByArea[linkArea];
      if (goalsInArea.length === 0) {
        Alert.alert('Нет целей', 'Сначала добавьте цель в эту область');
        return;
      }

      try {
        await createHabit({ name, category, frequency });
        await fetchHabits();
        // After creation, the newest habit is the one we just created
        // We'll link it in a follow-up
        setShowCreateHabitForm(false);
      } catch {
        Alert.alert('Ошибка', 'Не удалось создать привычку');
      }
    },
    [linkArea, goalsByArea, createHabit, fetchHabits],
  );

  // ── FAB handler ──
  const handleFabPress = useCallback(() => {
    setEditingGoal(null);
    setModalArea(null);
    setModalGoalText('');
    setModalProgress(0);
    setGoalModalVisible(true);
  }, []);

  // ── Progress controls in modal ──
  const handleModalProgressDecrease = useCallback(() => {
    setModalProgress((p) => Math.max(0, p - 10));
  }, []);

  const handleModalProgressIncrease = useCallback(() => {
    setModalProgress((p) => Math.min(100, p + 10));
  }, []);

  // ── Summary stats ──
  const totalGoals = goalsForYear.length;
  const completedGoals = useMemo(
    () => goalsForYear.filter((g) => g.progress >= 1).length,
    [goalsForYear],
  );
  const areasWithGoals = useMemo(
    () => AREA_KEYS.filter((k) => goalsByArea[k].length > 0).length,
    [goalsByArea],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Цели на год</Text>
        <View style={styles.yearNav}>
          <TouchableOpacity onPress={handlePrevYear} style={styles.yearArrow} activeOpacity={0.6}>
            <Text style={styles.yearArrowText}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.yearText}>{year}</Text>
          <TouchableOpacity onPress={handleNextYear} style={styles.yearArrow} activeOpacity={0.6}>
            <Text style={styles.yearArrowText}>▶</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* ── Overall progress card ── */}
        <View style={styles.overallCard}>
          <View style={styles.overallTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.overallTitle}>Общий прогресс</Text>
              <Text style={styles.overallSubtitle}>
                {totalGoals === 0
                  ? 'Добавьте свои цели на год'
                  : `${completedGoals} из ${totalGoals} целей выполнено`}
              </Text>
            </View>
            <View style={styles.overallPercentCircle}>
              <Text style={styles.overallPercentText}>
                {overallProgress}%
              </Text>
            </View>
          </View>
          <AnimatedProgressBar
            progress={overallProgress}
            color={c.primary}
            height={8}
            showLabel={false}
            style={{ marginTop: spacing.sm }}
          />
          {/* Summary chips */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryChip}>
              <Text style={styles.summaryChipIcon}>🎯</Text>
              <Text style={styles.summaryChipLabel}>
                {totalGoals} {totalGoals === 1 ? 'цель' : totalGoals >= 2 && totalGoals <= 4 ? 'цели' : 'целей'}
              </Text>
            </View>
            <View style={styles.summaryChip}>
              <Text style={styles.summaryChipIcon}>📂</Text>
              <Text style={styles.summaryChipLabel}>
                {areasWithGoals} из 6 областей
              </Text>
            </View>
            <View style={styles.summaryChip}>
              <Text style={styles.summaryChipIcon}>✅</Text>
              <Text style={styles.summaryChipLabel}>
                {completedGoals} выполнено
              </Text>
            </View>
          </View>
        </View>

        {/* ── Area cards ── */}
        {AREA_KEYS.map((areaKey) => (
          <AreaCard
            key={areaKey}
            areaKey={areaKey}
            goals={goalsByArea[areaKey]}
            habits={habits}
            habitStats={habitStats}
            todayLogs={todayLogs}
            isExpanded={expandedAreas.has(areaKey)}
            onToggleExpand={handleToggleExpand}
            onAddGoal={handleAddGoal}
            onEditGoal={handleEditGoal}
            onDeleteGoal={handleDeleteGoal}
            onProgressChange={handleProgressChange}
            onToggleHabit={handleToggleHabit}
            onUnlinkHabit={handleUnlinkHabit}
            onLinkHabit={handleOpenLinkModal}
            c={c}
          />
        ))}

        {/* Bottom spacer for FAB */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: c.primary }]}
        onPress={handleFabPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Добавить цель"
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* ═══════ CREATE / EDIT GOAL MODAL ═══════ */}
      <Modal
        visible={goalModalVisible}
        onClose={handleCloseGoalModal}
        title={editingGoal ? 'Редактировать цель' : 'Новая цель'}
      >
        <View style={styles.modalContent}>
          {/* Area selector */}
          <Text style={styles.modalLabel}>Область жизни</Text>
          <AreaChipSelector
            selected={modalArea}
            onSelect={setModalArea}
            c={c}
          />

          {/* Goal text */}
          <Text style={styles.modalLabel}>Описание цели</Text>
          <TextInput
            value={modalGoalText}
            onChangeText={setModalGoalText}
            placeholder="Опишите вашу цель..."
            placeholderTextColor={c.textSecondary}
            multiline
            numberOfLines={3}
            style={[
              styles.goalTextInput,
              {
                borderColor: modalArea
                  ? goalAreas[modalArea].color + '50'
                  : c.border,
              },
            ]}
            textAlignVertical="top"
          />

          {/* Progress slider (only for edit) */}
          {editingGoal && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.modalLabel}>Прогресс</Text>
              <View style={styles.progressControl}>
                <TouchableOpacity
                  onPress={handleModalProgressDecrease}
                  style={[
                    styles.progressBtn,
                    { backgroundColor: c.surfaceLight },
                  ]}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.progressBtnText, { color: c.text }]}>−</Text>
                </TouchableOpacity>

                <View style={{ flex: 1, marginHorizontal: spacing.md }}>
                  <AnimatedProgressBar
                    progress={modalProgress}
                    color={
                      modalArea
                        ? goalAreas[modalArea].color
                        : c.primary
                    }
                    height={10}
                    showLabel={false}
                  />
                </View>

                <Text
                  style={{
                    fontSize: fontSize.lg,
                    fontWeight: '700',
                    color: c.text,
                    minWidth: 50,
                    textAlign: 'center',
                  }}
                >
                  {modalProgress}%
                </Text>

                <TouchableOpacity
                  onPress={handleModalProgressIncrease}
                  style={[
                    styles.progressBtn,
                    { backgroundColor: c.surfaceLight },
                  ]}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.progressBtnText, { color: c.text }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Save button */}
          <TouchableOpacity
            onPress={handleSaveGoal}
            style={[
              styles.saveButton,
              {
                backgroundColor: modalArea
                  ? goalAreas[modalArea].color
                  : c.primary,
                opacity: modalArea && modalGoalText.trim() ? 1 : 0.5,
              },
            ]}
            activeOpacity={0.8}
            disabled={!modalArea || !modalGoalText.trim()}
          >
            <Text style={styles.saveButtonText}>
              {editingGoal ? 'Сохранить' : 'Создать цель'}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ═══════ LINK HABIT MODAL ═══════ */}
      <Modal
        visible={linkModalVisible}
        onClose={handleCloseLinkModal}
        title={
          linkArea
            ? `Привычки — ${goalAreas[linkArea].label}`
            : 'Привязать привычку'
        }
      >
        <View style={styles.modalContent}>
          {goalsForLinkArea.length === 0 ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <Text style={{ fontSize: 36, marginBottom: spacing.sm }}>⚠️</Text>
              <Text
                style={{
                  fontSize: fontSize.sm,
                  color: c.textSecondary,
                  textAlign: 'center',
                }}
              >
                Сначала добавьте цель{'\n'}в эту область
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={{
                  fontSize: fontSize.xs,
                  color: c.textSecondary,
                  marginBottom: spacing.sm,
                }}
              >
                Выберите привычки для привязки к целям в области "
                {linkArea ? goalAreas[linkArea].label : ''}"
              </Text>

              {/* Existing habits */}
              {availableHabitsForLink.length > 0 ? (
                <View style={{ marginBottom: spacing.md }}>
                  {availableHabitsForLink.map((habit) => (
                    <HabitSelectorItem
                      key={habit.id}
                      habit={habit}
                      isLinked={linkedHabitIdsInArea.has(habit.id)}
                      areaColor={linkArea ? goalAreas[linkArea].color : c.primary}
                      onToggle={handleToggleLinkHabit}
                      c={c}
                    />
                  ))}
                </View>
              ) : (
                <View
                  style={{
                    paddingVertical: spacing.lg,
                    alignItems: 'center',
                    marginBottom: spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.xs,
                      color: c.textSecondary,
                      textAlign: 'center',
                    }}
                  >
                    Нет доступных привычек.{'\n'}Создайте новую привычку ниже.
                  </Text>
                </View>
              )}

              {/* Create new habit inline */}
              {showCreateHabitForm ? (
                <CreateHabitForm
                  areaColor={linkArea ? goalAreas[linkArea].color : c.primary}
                  onSubmit={handleCreateAndLinkHabit}
                  onCancel={handleCancelCreateHabit}
                  c={c}
                />
              ) : (
                <TouchableOpacity
                  onPress={handleShowCreateHabitForm}
                  style={[
                    styles.createHabitBtn,
                    {
                      borderColor: linkArea
                        ? goalAreas[linkArea].color + '50'
                        : c.border,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                      color: linkArea ? goalAreas[linkArea].color : c.primary,
                    }}
                  >
                    + Создать новую привычку
                  </Text>
                </TouchableOpacity>
              )}

              {/* Done button */}
              <TouchableOpacity
                onPress={handleCloseLinkModal}
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: linkArea
                      ? goalAreas[linkArea].color
                      : c.primary,
                    marginTop: spacing.md,
                  },
                ]}
                activeOpacity={0.8}
              >
                <Text style={styles.saveButtonText}>Готово</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════
//                       STYLES
// ═══════════════════════════════════════════════════════════

type C = ReturnType<typeof useColors>;

function createStyles(c: C) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },

    // ── Header ──
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    headerTitle: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: c.text,
      letterSpacing: 0.5,
    },
    yearNav: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    yearArrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surfaceLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    yearArrowText: {
      fontSize: 14,
      color: c.text,
    },
    yearText: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.primary,
      marginHorizontal: spacing.md,
      minWidth: 50,
      textAlign: 'center',
    },

    // ── Scroll ──
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.lg,
    },

    // ── Overall progress card ──
    overallCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      marginBottom: spacing.lg,
    },
    overallTop: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    overallTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
    overallSubtitle: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: 4,
    },
    overallPercentCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 3,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overallPercentText: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: c.primary,
    },
    summaryRow: {
      flexDirection: 'row',
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    summaryChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.xs,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.sm,
    },
    summaryChipIcon: {
      fontSize: 14,
      marginRight: 4,
    },
    summaryChipLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '600',
    },

    // ── FAB ──
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.xl + 10,
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 8,
    },
    fabText: {
      fontSize: 30,
      fontWeight: '600',
      color: '#FFFFFF',
      marginTop: -2,
    },

    // ── Modal ──
    modalContent: {
      paddingTop: spacing.sm,
    },
    modalLabel: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    goalTextInput: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      fontSize: fontSize.md,
      color: c.text,
      minHeight: 90,
      marginBottom: spacing.md,
      lineHeight: fontSize.md * 1.5,
    },
    progressControl: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    progressBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressBtnText: {
      fontSize: 20,
      fontWeight: '700',
    },
    saveButton: {
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveButtonText: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    createHabitBtn: {
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
