import React, { memo, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { roomItemEmoji, type RoomItem } from '@/services/room-catalog';
import { hapticLight, hapticMedium } from '@/services/haptics';

const SIZE = 56;
const SPRING = { damping: 16, stiffness: 180 };

type BlockTarget = Parameters<GestureType['blocksExternalGesture']>[0];

interface RoomFurnitureItemProps {
  item: RoomItem;
  roomWidth: number;
  roomHeight: number;
  /** Жест пейджера: пока тащим предмет, страница не листается. */
  blockGesture?: BlockTarget;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
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
  blockGesture,
  onMove,
  onRemove,
}: RoomFurnitureItemProps) {
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

  let pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      lift.value = withSpring(1.15, SPRING);
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
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
  if (blockGesture) pan = pan.blocksExternalGesture(blockGesture);

  const longPress = Gesture.LongPress()
    .minDuration(600)
    .onStart(() => {
      runOnJS(hapticMedium)();
      runOnJS(onRemove)(item.id);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: px.value + dx.value - SIZE / 2 },
      { translateY: py.value + dy.value - SIZE / 2 },
      { scale: lift.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress)}>
      <Animated.View style={[styles.item, style]} accessibilityLabel={`Предмет: ${item.itemKey}`}>
        <Text style={styles.emoji}>{roomItemEmoji(item.itemKey)}</Text>
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
  emoji: { fontSize: 40 },
});
