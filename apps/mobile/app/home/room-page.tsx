import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { RobotAvatar } from '@/components/robot/robot-avatar';
import { RoomFurnitureItem } from '@/components/robot/room-furniture-item';
import { RoomCatalogBar } from '@/components/robot/room-catalog-bar';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useRoomStore } from '@/stores/room-store';
import { ROOM_MAX_ITEMS, type RoomItemKey } from '@/services/room-catalog';
import { spacing, fontSize } from '@/constants';

/**
 * Робот-эпик, Части 3–4: экран «Комната» — дом робота. Подсветка по времени
 * суток, робот иногда поворачивает голову (комната сзади чуть сдвигается в
 * противоход — параллакс). Юзер обставляет комнату сам: тап по предмету внизу —
 * ставит, перетаскивание — двигает, долгое нажатие — убирает. Расстановка
 * хранится на сервере (room-store → PUT /room).
 */
function timeTint(hour: number): string {
  if (hour >= 21 || hour < 6) return 'rgba(20,16,40,0.55)'; // ночь
  if (hour < 10) return 'rgba(255,220,150,0.10)'; // утро
  if (hour >= 18) return 'rgba(255,140,90,0.12)'; // вечер
  return 'rgba(255,255,255,0)';
}

const PARALLAX_PX = 8;

type BlockTarget = Parameters<GestureType['blocksExternalGesture']>[0];

export const RoomPage = memo(function RoomPage({
  active,
  pagerGesture,
}: {
  active: boolean;
  /** Жест пейджера — пока тащим мебель, страница не листается. */
  pagerGesture?: BlockTarget;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [headTurn, setHeadTurn] = useState<-1 | 0 | 1>(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reactionKey, setReactionKey] = useState<string | null>(null);
  const emotion = useRobotReaction('happy', reactionKey);
  const items = useRoomStore((s) => s.items);
  const fetchRoom = useRoomStore((s) => s.fetchRoom);
  const addItem = useRoomStore((s) => s.addItem);
  const moveItem = useRoomStore((s) => s.moveItem);
  const removeItem = useRoomStore((s) => s.removeItem);
  const tint = timeTint(new Date().getHours());
  const shift = useSharedValue(0);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // Робот иногда мягко поворачивает голову, приоткрывая комнату (только когда экран виден).
  useEffect(() => {
    if (!active) return;
    let back: ReturnType<typeof setTimeout>;
    const t = setInterval(() => {
      const options: Array<-1 | 0 | 1> = [-1, 0, 1, 0];
      setHeadTurn(options[Math.floor(Math.random() * options.length)]);
      back = setTimeout(() => setHeadTurn(0), 1400);
    }, 6000);
    return () => {
      clearInterval(t);
      clearTimeout(back);
    };
  }, [active]);

  useEffect(() => {
    shift.value = withSpring(-headTurn * PARALLAX_PX, { damping: 18, stiffness: 90 });
  }, [headTurn, shift]);

  const furnitureStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }, []);

  // Долгое нажатие легко сделать случайно («взять» предмет) — спрашиваем.
  const onRemove = useCallback(
    (id: string) => {
      Alert.alert('Убрать предмет?', undefined, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Убрать', style: 'destructive', onPress: () => removeItem(id) },
      ]);
    },
    [removeItem],
  );

  const onPick = useCallback(
    (key: RoomItemKey) => {
      if (addItem(key)) {
        setReactionKey(String(Date.now()));
      } else {
        Alert.alert('Комната заполнена', `Помещается до ${ROOM_MAX_ITEMS} предметов — убери что-нибудь долгим нажатием.`);
      }
    },
    [addItem],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.room} onLayout={onLayout}>
        <View style={styles.wall} />
        <View style={styles.floor} />
        <Animated.View style={[StyleSheet.absoluteFill, furnitureStyle]} pointerEvents="box-none">
          {size.w > 0 &&
            items.map((item) => (
              <RoomFurnitureItem
                key={item.id}
                item={item}
                roomWidth={size.w}
                roomHeight={size.h}
                blockGesture={pagerGesture}
                onMove={moveItem}
                onRemove={onRemove}
              />
            ))}
        </Animated.View>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
        <View style={styles.robot} pointerEvents="none">
          <RobotAvatar emotion={emotion} size={200} headTurn={headTurn} />
        </View>
      </View>
      <RoomCatalogBar onPick={onPick} />
      <Text style={styles.hint}>
        {items.length === 0
          ? 'Обставь комнату: тапни предмет. Свайп влево — к работе →'
          : 'Тащи пальцем — двигать, долгое нажатие — убрать'}
      </Text>
    </SafeAreaView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    room: {
      flex: 1,
      marginHorizontal: spacing.md,
      marginTop: spacing.xl,
      borderRadius: 24,
      overflow: 'hidden',
    },
    wall: { flex: 3, backgroundColor: '#2A2540' },
    floor: { flex: 1, backgroundColor: '#3B3355' },
    robot: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
    hint: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
  });
}
