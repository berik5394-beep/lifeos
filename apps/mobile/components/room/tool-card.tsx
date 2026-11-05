import React, { memo, useEffect, useMemo, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { fontSize, spacing } from '@/constants';
import { COMIC } from '@/constants/comic';
import { toolCardRect } from '@/services/tool-scene';
import type { ToolKey } from '@/services/room-tools';
import DashboardScreen from '@/screens/dashboard';
import TasksScreen from '@/screens/tasks';
import HabitsScreen from '@/screens/habits';
import GoalsScreen from '@/screens/goals';
import FinanceScreen from '@/screens/finance';
import CalendarScreen from '@/screens/calendar';
import JournalScreen from '@/screens/journal';

/** Экран инструмента внутри карточки — существующие экраны, без перерисовки. */
const TOOL_SCREEN: Record<ToolKey, ComponentType> = {
  today: DashboardScreen,
  tasks: TasksScreen,
  habits: HabitsScreen,
  goals: GoalsScreen,
  finance: FinanceScreen,
  calendar: CalendarScreen,
  journal: JournalScreen,
};

export const TOOL_TITLE: Record<ToolKey, string> = {
  today: 'Сегодня',
  tasks: 'Задачи',
  habits: 'Привычки',
  goals: 'Цели',
  finance: 'Финансы',
  calendar: 'Календарь',
  journal: 'Дневник',
};

const OPEN_MS = 460;

/**
 * Робот-эпик, Часть 5: инструмент, который робот достал из мебели.
 * Карточка вылетает из точки `from` (предмет) и разворачивается почти на весь
 * экран, оставляя полосу внизу под маленького робота. closing → «улетает»
 * обратно в предмет и зовёт onClosed.
 */
export const ToolCard = memo(function ToolCard({
  tool,
  from,
  width,
  height,
  closing,
  onClose,
  onClosed,
}: {
  tool: ToolKey;
  from: { x: number; y: number };
  width: number;
  height: number;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const card = toolCardRect(width, height);
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withTiming(closing ? 0 : 1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done && closing) runOnJS(onClosed)();
    });
  }, [closing, p, onClosed]);

  // Карточка стоит на своём месте; в начале она маленькая в точке предмета.
  const startScale = 46 / card.w;
  const style = useAnimatedStyle(() => {
    const cx = card.x + card.w / 2;
    const cy = card.y + card.h / 2;
    return {
      opacity: Math.min(1, p.value * 2.5),
      transform: [
        { translateX: (from.x - cx) * (1 - p.value) },
        { translateY: (from.y - cy) * (1 - p.value) },
        { scale: startScale + (1 - startScale) * p.value },
      ],
    };
  });

  const Screen = TOOL_SCREEN[tool];
  return (
    <Animated.View style={[styles.card, { left: card.x, top: card.y, width: card.w, height: card.h }, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>{TOOL_TITLE[tool]}</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Убрать инструмент">
          <Feather name="x" size={22} color={COMIC.ink} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Screen />
      </View>
    </Animated.View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      position: 'absolute',
      borderRadius: 22,
      borderWidth: COMIC.outline,
      borderColor: COMIC.ink,
      backgroundColor: c.background,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: COMIC.userPaper,
      borderBottomWidth: COMIC.outline,
      borderBottomColor: COMIC.ink,
    },
    title: { fontFamily: COMIC.font, fontSize: fontSize.lg, color: COMIC.ink },
    body: { flex: 1 },
  });
}
