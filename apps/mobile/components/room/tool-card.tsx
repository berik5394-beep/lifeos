import React, { memo, useEffect, useMemo, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/use-colors';
import { COMIC } from '@/constants/comic';
import { toolCardRect } from '@/services/tool-scene';
import { ContentWidthContext } from '@/hooks/use-content-width';
import type { ToolKey } from '@/services/room-tools';
import DashboardScreen from '@/screens/dashboard';
import TasksScreen from '@/screens/tasks';
import DealsScreen from '@/screens/deals';
import HabitsScreen from '@/screens/habits';
import GoalsScreen from '@/screens/goals';
import FinanceScreen from '@/screens/finance';
import CalendarScreen from '@/screens/calendar';
import JournalScreen from '@/screens/journal';

/** Экран инструмента внутри карточки — существующие экраны, без перерисовки. */
const TOOL_SCREEN: Record<ToolKey, ComponentType> = {
  today: DashboardScreen,
  tasks: TasksScreen,
  deals: DealsScreen,
  habits: HabitsScreen,
  goals: GoalsScreen,
  finance: FinanceScreen,
  calendar: CalendarScreen,
  journal: JournalScreen,
};

export const TOOL_TITLE: Record<ToolKey, string> = {
  today: 'Сегодня',
  tasks: 'Задачи',
  deals: 'Сделки',
  habits: 'Привычки',
  goals: 'Цели',
  finance: 'Финансы',
  calendar: 'Календарь',
  journal: 'Дневник',
};

const OPEN_MS = 460;

/**
 * Робот-эпик, Часть 5: инструмент, который робот достал из мебели.
 * Карточка вылетает из точки `from` (предмет) и разворачивается на всю
 * комнату; маленький робот — поверх неё в углу. closing → «улетает»
 * обратно в предмет и зовёт onClosed.
 */
export const ToolCard = memo(function ToolCard({
  tool,
  from,
  width,
  height,
  closing,
  onClosed,
}: {
  tool: ToolKey;
  from: { x: number; y: number };
  width: number;
  height: number;
  closing: boolean;
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
    <Animated.View
      style={[styles.card, { left: card.x, top: card.y, width: card.w, height: card.h }, style]}
      accessibilityLabel={TOOL_TITLE[tool]}
    >
      {/* Без шапки: вся комната — один экран инструмента; «Закрыть» — внизу, вместо «Обставить».
          Экран рисуется в ширину карточки, а не телефона — иначе вылезает вправо. */}
      <View style={styles.body}>
        <ContentWidthContext.Provider value={card.w - COMIC.outline * 2}>
          <Screen />
        </ContentWidthContext.Provider>
      </View>
    </Animated.View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      position: 'absolute',
      // Как у комнаты: карточка ложится ровно в её рамку.
      borderRadius: 24,
      borderWidth: COMIC.outline,
      borderColor: COMIC.ink,
      backgroundColor: c.background,
      overflow: 'hidden',
    },
    body: { flex: 1 },
  });
}
