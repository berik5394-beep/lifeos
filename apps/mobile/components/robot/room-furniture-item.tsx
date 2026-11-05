import React, { memo, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { RENDER_SCALE as R, itemDepthScale } from '@/services/room-geometry';
import { roomItemEmoji, type RoomItem } from '@/services/room-catalog';
import { hapticLight, hapticMedium } from '@/services/haptics';

const SIZE = 56 * R;
const SPRING = { damping: 16, stiffness: 180 };

type BlockTarget = Parameters<GestureType['blocksExternalGesture']>[0];

interface RoomFurnitureItemProps {
  item: RoomItem;
  roomWidth: number;
  roomHeight: number;
  /** Жесты, которые не должны срабатывать, пока тащим предмет (листание страниц, панорама). */
  blockGestures?: BlockTarget[];
  /** Текущее приближение комнаты: палец двигается по экрану, предмет — по комнате. */
  zoom: SharedValue<number>;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  /** Только что купленный предмет: «выпрыгивает» крупнее, пока робот на него показывает. */
  highlight?: boolean;
  /** Тап по предмету (Часть 5: мебель с инструментом — робот достаёт его). */
  onTap?: (id: string) => void;
  /** Маленький значок: что лежит внутри (📅🎯…). Пусто — без значка. */
  badge?: string;
  /** Знакомство: значок пульсирует, привлекая внимание. */
  pulseBadge?: boolean;
}

/**
 * Робот-эпик, Часть 4: предмет мебели в комнате. Тащи пальцем — двигается
 * (позиция живёт в shared values, без скачков после сохранения), долгое
 * нажатие — убрать (с вибрацией).
 */
export const RoomFurnitureItem = memo(function RoomFurnitureItem({
  item,
  roomWidth,
  roomHeight,
  blockGestures,
  zoom,
  onMove,
  onRemove,
  highlight = false,
  onTap,
  badge = '',
  pulseBadge = false,
}: RoomFurnitureItemProps) {
  const badgeScale = useSharedValue(1);
  useEffect(() => {
    badgeScale.value = pulseBadge
      ? withRepeat(withSequence(withTiming(1.35, { duration: 420 }), withTiming(1, { duration: 420 })), -1)
      : withTiming(1, { duration: 150 });
  }, [pulseBadge, badgeScale]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));
  const px = useSharedValue(item.x * roomWidth);
  const py = useSharedValue(item.y * roomHeight);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(1);

  // Позиция пришла снаружи (загрузка с сервера, поворот экрана) — синхронизируем.
  useEffect(() => {
    px.value = item.x * roomWidth;
    py.value = item.y * roomHeight;
  }, [item.x, item.y, roomWidth, roomHeight, px, py]);

  useEffect(() => {
    lift.value = highlight
      ? withSequence(withSpring(1.8, SPRING), withSpring(1.35, SPRING))
      : withSpring(1, SPRING);
  }, [highlight, lift]);

  let pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      lift.value = withSpring(1.15, SPRING);
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      dx.value = e.translationX / zoom.value;
      dy.value = e.translationY / zoom.value;
    })
    .onEnd(() => {
      const nx = Math.min(roomWidth, Math.max(0, px.value + dx.value));
      const ny = Math.min(roomHeight, Math.max(0, py.value + dy.value));
      px.value = nx;
      py.value = ny;
      dx.value = 0;
      dy.value = 0;
      if (roomWidth > 0 && roomHeight > 0) runOnJS(onMove)(item.id, nx / roomWidth, ny / roomHeight);
    })
    .onFinalize(() => {
      dx.value = 0;
      dy.value = 0;
      lift.value = withSpring(1, SPRING);
    });
  if (blockGestures && blockGestures.length > 0) pan = pan.blocksExternalGesture(...blockGestures);

  const longPress = Gesture.LongPress()
    .minDuration(600)
    .onStart(() => {
      runOnJS(hapticMedium)();
      runOnJS(onRemove)(item.id);
    });

  const tap = Gesture.Tap()
    .maxDistance(8)
    .onEnd((_e, ok) => {
      if (ok && onTap) runOnJS(onTap)(item.id);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: px.value + dx.value - SIZE / 2 },
      { translateY: py.value + dy.value - SIZE / 2 },
      // Дальше от зрителя — мельче (перспектива комнаты).
      { scale: lift.value * itemDepthScale(roomHeight > 0 ? (py.value + dy.value) / roomHeight : 0.5) },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
      <Animated.View style={[styles.item, style]} accessibilityLabel={`Предмет: ${item.itemKey}`}>
        <Text style={styles.emoji}>{roomItemEmoji(item.itemKey)}</Text>
        {badge ? (
          <Animated.View style={[styles.badge, badgeStyle]} pointerEvents="none">
            <Text style={styles.badgeText}>{badge}</Text>
          </Animated.View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  item: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 40 * R },
  // Значок «что внутри» — в правом верхнем углу предмета.
  badge: {
    position: 'absolute',
    top: -6 * R,
    right: -10 * R,
    paddingHorizontal: 3 * R,
    paddingVertical: 1 * R,
    borderRadius: 10 * R,
    borderWidth: 1.5 * R,
    borderColor: '#14101F',
    backgroundColor: '#FFFFFF',
  },
  badgeText: { fontSize: 10 * R },
});
