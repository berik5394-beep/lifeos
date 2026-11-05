import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { RobotAvatar } from '@/components/robot/robot-avatar';
import { RoomFurnitureItem } from '@/components/robot/room-furniture-item';
import { RoomCatalogBar } from '@/components/robot/room-catalog-bar';
import { RoomDiorama } from '@/components/room/room-diorama';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useRoomStore } from '@/stores/room-store';
import { ROOM_MAX_ITEMS, type RoomItemKey } from '@/services/room-catalog';
import { RENDER_SCALE as R, ZOOM_IN, clampPan, zoomOffset } from '@/services/room-geometry';
import { spacing, fontSize, borderRadius } from '@/constants';

/**
 * Робот-эпик: экран «Комната» — дом робота. 3D-диорама в духе квартиры в
 * СНГ, вид издалека (components/room). Двойное нажатие или новый предмет —
 * приближение к этому участку (панорама: водишь пальцем), повторное двойное
 * нажатие — отдалить. Мебель: тап по предмету внизу — поставить, перетащить —
 * подвинуть, долгое нажатие — убрать. Расстановка — на сервере (room-store).
 */
function timeTint(hour: number): string {
  if (hour >= 21 || hour < 6) return 'rgba(20,16,40,0.35)'; // ночь (абажур светит)
  if (hour < 10) return 'rgba(255,220,150,0.10)'; // утро
  if (hour >= 18) return 'rgba(255,140,90,0.12)'; // вечер
  return 'rgba(255,255,255,0)';
}

const PARALLAX_PX = 6;
const ZOOM_MS = 380;

type BlockTarget = Parameters<GestureType['blocksExternalGesture']>[0];

export const RoomPage = memo(function RoomPage({
  active,
  pagerGesture,
}: {
  active: boolean;
  /** Жест пейджера — пока тащим мебель или осматриваемся, страница не листается. */
  pagerGesture?: BlockTarget;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [headTurn, setHeadTurn] = useState<-1 | 0 | 1>(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [reactionKey, setReactionKey] = useState<string | null>(null);
  const emotion = useRobotReaction('happy', reactionKey);
  const items = useRoomStore((s) => s.items);
  const fetchRoom = useRoomStore((s) => s.fetchRoom);
  const addItem = useRoomStore((s) => s.addItem);
  const moveItem = useRoomStore((s) => s.moveItem);
  const removeItem = useRoomStore((s) => s.removeItem);
  const hour = new Date().getHours();
  const tint = timeTint(hour);

  const shift = useSharedValue(0);
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  // Сцена нарисована в R раз крупнее и уменьшена: издалека масштаб 1/R, вблизи — 1 (чётко).
  const sceneScale = useDerivedValue(() => zoom.value / R);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // Робот иногда мягко поворачивает голову (только когда экран виден).
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
    shift.value = withSpring(-headTurn * PARALLAX_PX * R, { damping: 18, stiffness: 90 });
  }, [headTurn, shift]);

  /** Приблизить точку комнаты (в координатах комнаты без приближения). */
  const zoomTo = useCallback(
    (x: number, y: number) => {
      if (size.w === 0) return;
      const off = zoomOffset({ x, y }, size.w, size.h, ZOOM_IN);
      zoom.value = withTiming(ZOOM_IN, { duration: ZOOM_MS });
      tx.value = withTiming(off.x, { duration: ZOOM_MS });
      ty.value = withTiming(off.y, { duration: ZOOM_MS });
      setZoomed(true);
    },
    [size, zoom, tx, ty],
  );

  const zoomOut = useCallback(() => {
    zoom.value = withTiming(1, { duration: ZOOM_MS });
    tx.value = withTiming(0, { duration: ZOOM_MS });
    ty.value = withTiming(0, { duration: ZOOM_MS });
    setZoomed(false);
  }, [zoom, tx, ty]);

  // Двойное нажатие: издалека → приблизить это место; вблизи → отдалить.
  const onDoubleTap = useCallback(
    (sx: number, sy: number) => {
      if (zoomed) {
        zoomOut();
        return;
      }
      zoomTo(sx, sy);
    },
    [zoomed, zoomOut, zoomTo],
  );

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, ok) => {
      if (ok) runOnJS(onDoubleTap)(e.x, e.y);
    });

  // Панорама: вблизи водишь пальцем по комнате.
  let lookAround = Gesture.Pan()
    .enabled(zoomed)
    .minDistance(6)
    .onStart(() => {
      panStartX.value = tx.value;
      panStartY.value = ty.value;
    })
    .onUpdate((e) => {
      const t = clampPan(
        { x: panStartX.value + e.translationX, y: panStartY.value + e.translationY },
        size.w,
        size.h,
        zoom.value,
      );
      tx.value = t.x;
      ty.value = t.y;
    });
  if (zoomed && pagerGesture) lookAround = lookAround.blocksExternalGesture(pagerGesture);

  const sceneGesture = Gesture.Simultaneous(doubleTap, lookAround);
  // Пока тащим предмет — не листаем страницы и не двигаем панораму.
  const itemBlocks: BlockTarget[] = pagerGesture ? [pagerGesture, lookAround] : [lookAround];

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sceneScale.value }],
  }));
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
      if (!addItem(key)) {
        Alert.alert('Комната заполнена', `Помещается до ${ROOM_MAX_ITEMS} предметов — убери что-нибудь долгим нажатием.`);
        return;
      }
      setReactionKey(String(Date.now()));
      // Новый предмет — приближаем его место, чтобы было видно и удобно поставить.
      const added = useRoomStore.getState().items.at(-1);
      if (added) zoomTo(added.x * size.w, added.y * size.h);
    },
    [addItem, zoomTo, size],
  );

  const hint = zoomed
    ? 'Води пальцем — осмотреться. Двойное нажатие — отдалить'
    : items.length === 0
      ? 'Обставь комнату: тапни предмет внизу. Двойное нажатие — приблизить'
      : 'Двойное нажатие — приблизить. Тащи — двигать, долгое нажатие — убрать';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <GestureDetector gesture={sceneGesture}>
        <View style={styles.room} onLayout={onLayout}>
          <Animated.View
            style={[
              styles.scene,
              {
                left: (size.w - size.w * R) / 2,
                top: (size.h - size.h * R) / 2,
                width: size.w * R,
                height: size.h * R,
              },
              sceneStyle,
            ]}
          >
            <RoomDiorama width={size.w * R} height={size.h * R} hour={hour} />
            <Animated.View style={[StyleSheet.absoluteFill, furnitureStyle]} pointerEvents="box-none">
              {size.w > 0 &&
                items.map((item) => (
                  <RoomFurnitureItem
                    key={item.id}
                    item={item}
                    roomWidth={size.w * R}
                    roomHeight={size.h * R}
                    blockGestures={itemBlocks}
                    zoom={sceneScale}
                    onMove={moveItem}
                    onRemove={onRemove}
                  />
                ))}
            </Animated.View>
            <View style={styles.robot} pointerEvents="none">
              <RobotAvatar emotion={emotion} size={150 * R} headTurn={headTurn} />
            </View>
          </Animated.View>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
          {zoomed && (
            <Pressable
              onPress={zoomOut}
              style={styles.zoomOut}
              accessibilityRole="button"
              accessibilityLabel="Отдалить комнату"
            >
              <Feather name="minimize-2" size={18} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      </GestureDetector>
      <RoomCatalogBar onPick={onPick} />
      <Text style={styles.hint}>{hint}</Text>
    </SafeAreaView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    room: {
      flex: 1,
      marginHorizontal: spacing.sm,
      marginTop: spacing.xl,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: '#0B1022',
    },
    scene: { position: 'absolute' },
    robot: { position: 'absolute', left: 0, right: 0, bottom: '4%', alignItems: 'center' },
    zoomOut: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 36,
      height: 36,
      borderRadius: borderRadius.lg,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
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
