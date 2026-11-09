import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  type DerivedValue,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { RENDER_SCALE as R, itemDepthScale, pointDepth, type Pt } from '@/services/room-geometry';
import { TIER_COLOR, roomItemEmoji, roomItemLabel, slotsFor, SLOT_POS, spotOf, tierOf, type RoomItem } from '@/services/room-catalog';
import { SoftSpot } from '@/components/room/face-light';
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
  /** Камера комнаты: дальние предметы сдвигаются вместе с задней стеной (объём). */
  cam: DerivedValue<Pt>;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  /** Только что купленный предмет: «выпрыгивает» крупнее, пока робот на него показывает. */
  highlight?: boolean;
  /** Тап по предмету (Часть 5: мебель с инструментом — робот достаёт его). */
  onTap?: (id: string) => void;
  /**
   * Двигать/убирать можно только в «Обставить». Иначе свайп по мебели
   * двигал её вместо листания назад, а долгое нажатие случайно убирало.
   */
  editable?: boolean;
  /** Маленький значок: что лежит внутри (📅🎯…). Пусто — без значка. */
  badge?: string;
  /** Знакомство: значок пульсирует, привлекая внимание. */
  pulseBadge?: boolean;
  /** Часть 6: начали/закончили тащить — подсветить ячейки. */
  onDragState?: (dragging: boolean) => void;
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
  cam,
  onMove,
  onRemove,
  highlight = false,
  onTap,
  editable = true,
  badge = '',
  pulseBadge = false,
  onDragState,
}: RoomFurnitureItemProps) {
  // Ячейки, куда можно защёлкнуть этот предмет (доли сцены) — для ворклета.
  const targets = slotsFor(item.itemKey).map((s) => SLOT_POS[s]);
  const tier = tierOf(item.variantKey);
  const tierColor = tier && tier !== 'free' && tier !== 'friend' ? TIER_COLOR[tier] : null;
  const onWall = spotOf(item.itemKey) === 'wall';
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
    px.value = withSpring(item.x * roomWidth, SPRING);
    py.value = withSpring(item.y * roomHeight, SPRING);
  }, [item.x, item.y, roomWidth, roomHeight, px, py]);

  useEffect(() => {
    lift.value = highlight
      ? withSequence(withSpring(1.8, SPRING), withSpring(1.35, SPRING))
      : withSpring(1, SPRING);
  }, [highlight, lift]);

  let pan = Gesture.Pan()
    .enabled(editable)
    .minDistance(4)
    .onStart(() => {
      lift.value = withSpring(1.15, SPRING);
      runOnJS(hapticLight)();
      if (onDragState) runOnJS(onDragState)(true);
    })
    .onUpdate((e) => {
      dx.value = e.translationX / zoom.value;
      dy.value = e.translationY / zoom.value;
    })
    .onEnd(() => {
      if (roomWidth <= 0 || roomHeight <= 0) return;
      // Часть 6: защёлкнуть в ближайшую подходящую ячейку (без наложений).
      const fx = (px.value + dx.value) / roomWidth;
      const fy = (py.value + dy.value) / roomHeight;
      let bx = item.x;
      let by = item.y;
      let bd = Infinity;
      for (const t of targets) {
        const d = (t.x - fx) ** 2 + (t.y - fy) ** 2;
        if (d < bd) {
          bd = d;
          bx = t.x;
          by = t.y;
        }
      }
      px.value = px.value + dx.value;
      py.value = py.value + dy.value;
      dx.value = 0;
      dy.value = 0;
      px.value = withSpring(bx * roomWidth, SPRING);
      py.value = withSpring(by * roomHeight, SPRING);
      runOnJS(onMove)(item.id, bx, by);
    })
    .onFinalize(() => {
      dx.value = 0;
      dy.value = 0;
      lift.value = withSpring(1, SPRING);
      if (onDragState) runOnJS(onDragState)(false);
    });
  if (blockGestures && blockGestures.length > 0) pan = pan.blocksExternalGesture(...blockGestures);

  const longPress = Gesture.LongPress()
    .enabled(editable)
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

  const style = useAnimatedStyle(() => {
    const fx = roomWidth > 0 ? (px.value + dx.value) / roomWidth : 0.5;
    const fy = roomHeight > 0 ? (py.value + dy.value) / roomHeight : 0.5;
    // Параллакс: предмет сдвигается с камерой настолько, насколько он далеко.
    const depth = pointDepth(fx, fy);
    return {
      transform: [
        { translateX: px.value + dx.value - SIZE / 2 + cam.value.x * depth },
        { translateY: py.value + dy.value - SIZE / 2 + cam.value.y * depth },
        // Дальше от зрителя — мельче (перспектива комнаты).
        { scale: lift.value * itemDepthScale(fy) },
      ],
    };
  });

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
      <Animated.View style={[styles.item, style]} accessibilityLabel={badge ? `${roomItemLabel(item.itemKey)}: открыть ${badge}` : roomItemLabel(item.itemKey)}
        accessibilityRole="button">
        {/* Объём: предмет на полу отбрасывает мягкую тень. Подиумов «класса» нет — Berik 2026-11-09: серые подставки выглядели как баг. */}
        {!onWall && (
          <View style={styles.contact} pointerEvents="none">
            <SoftSpot id={`contact-${item.id}`} cx={0.5} cy={0.5} rx={0.5} ry={0.5} color="#120A02" opacity={0.6} />
          </View>
        )}
        {tierColor && onWall && (
          <View
            style={[styles.stand, { backgroundColor: tierColor.stand, borderColor: tierColor.frame }, tier === 'luxury' && styles.sheen]}
            pointerEvents="none"
          />
        )}
        <Text style={[styles.emoji, onWall ? styles.hung : styles.standing]}>{roomItemEmoji(item.itemKey)}</Text>
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
  // Свет из окна справа: тень предмета ложится влево-вниз — он «стоит», а не наклеен.
  standing: { textShadowColor: 'rgba(20,10,0,0.45)', textShadowOffset: { width: -3 * R, height: 2 * R }, textShadowRadius: 3 * R },
  // Висит на стене: тень ниже и мягче — между предметом и стеной есть зазор.
  hung: { textShadowColor: 'rgba(20,10,0,0.42)', textShadowOffset: { width: -2 * R, height: 4 * R }, textShadowRadius: 4 * R },
  contact: { position: 'absolute', left: SIZE * 0.06, width: SIZE * 0.88, top: SIZE * 0.72, height: SIZE * 0.3 },
  // Часть 6: «класс» предмета на стене — рамка цвета класса.
  stand: {
    position: 'absolute',
    left: 2 * R,
    right: 2 * R,
    top: 4 * R,
    bottom: 0,
    borderRadius: 12 * R,
    borderWidth: 2 * R,
  },
  sheen: { shadowColor: '#FFE7A0', shadowOpacity: 0.9, shadowRadius: 8 * R, shadowOffset: { width: 0, height: 0 } },
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
