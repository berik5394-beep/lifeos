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
import { RENDER_SCALE as R, faceWeight, placeAt, surfaceFace, surfaceScaleAt, surfaceToScene, type RoomCam, type Surface } from '@/services/room-geometry';
import { TIER_COLOR, roomItemEmoji, roomItemLabel, spotOf, tierOf, type RoomItem } from '@/services/room-catalog';
import { SoftSpot } from '@/components/room/face-light';
import { hapticLight, hapticMedium } from '@/services/haptics';

const SIZE = 56 * R;
const SPRING = { damping: 16, stiffness: 180 };
/** Поверхность в shared value — индексом (строки в ворклетах дороже). */
const SURF: Surface[] = ['floor', 'wall-left', 'wall-back', 'wall-right'];
const surfIndex = (s: Surface) => SURF.indexOf(s);

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
  cam: DerivedValue<RoomCam>;
  /** Отпустил: точка на поверхности (свободно, куда хочет юзер). */
  onMove: (id: string, surface: Surface, u: number, v: number) => void;
  onRemove: (id: string) => void;
  /** Только что купленный предмет: «выпрыгивает» крупнее, пока робот на него показывает. */
  highlight?: boolean;
  /** Тап по предмету (Часть 5: мебель с инструментом — робот достаёт его). */
  onTap?: (id: string) => void;
  /**
   * «Обставить»: тащишь сразу, долгое нажатие — убрать. Вне него — зажми
   * и тяни (как значки на iPhone): быстрый свайп листает страницы, а не
   * двигает мебель, и убрать случайно нельзя.
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
  // Где стоит: поверхность + точка на ней. На экран — через перспективу граней,
  // поэтому предмет «приклеен» к полу/стене при любом движении камеры.
  const si = useSharedValue(surfIndex(item.surface));
  const su = useSharedValue(item.u);
  const sv = useSharedValue(item.v);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(1);

  // Позиция пришла снаружи (загрузка с сервера, кладовка) — синхронизируем.
  useEffect(() => {
    const idx = surfIndex(item.surface);
    if (si.value !== idx) {
      si.value = idx;
      su.value = item.u;
      sv.value = item.v;
    } else {
      su.value = withSpring(item.u, SPRING);
      sv.value = withSpring(item.v, SPRING);
    }
  }, [item.surface, item.u, item.v, si, su, sv]);

  useEffect(() => {
    lift.value = highlight
      ? withSequence(withSpring(1.8, SPRING), withSpring(1.35, SPRING))
      : withSpring(1, SPRING);
  }, [highlight, lift]);

  // Стена за спиной (при повороте) схлопнута в линию у края и погашена, но жесты
  // её предметов ловили тапы у правого края — комната внезапно разворачивалась к
  // невидимой картине (аудит 2026-11-09). Погашенный предмет жесты не берёт.
  const hiddenNow = () => {
    'worklet';
    return faceWeight(surfaceFace(SURF[si.value]), cam.value.turn ?? 0) < 0.3;
  };
  let pan = Gesture.Pan()
    .onTouchesDown((_e, manager) => {
      if (hiddenNow()) manager.fail();
    })
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
      // Свободно: встаёт туда, где отпустил (пол — на полу, картина — на стене под пальцем).
      const s = SURF[si.value];
      const p = surfaceToScene(roomWidth, roomHeight, cam.value, s, su.value, sv.value);
      const drop = { x: p.x + dx.value, y: p.y + dy.value };
      const r = placeAt(roomWidth, roomHeight, cam.value, onWall ? 'wall' : 'floor', drop);
      const np = surfaceToScene(roomWidth, roomHeight, cam.value, r.surface, r.u, r.v);
      si.value = SURF.indexOf(r.surface);
      su.value = r.u;
      sv.value = r.v;
      // Без скачка: из точки отпускания мягко доезжает до места на поверхности.
      dx.value = drop.x - np.x;
      dy.value = drop.y - np.y;
      dx.value = withSpring(0, SPRING);
      dy.value = withSpring(0, SPRING);
      runOnJS(onMove)(item.id, r.surface, r.u, r.v);
    })
    .onFinalize((_e, success) => {
      if (!success) {
        dx.value = withSpring(0, SPRING);
        dy.value = withSpring(0, SPRING);
      }
      lift.value = withSpring(1, SPRING);
      if (onDragState) runOnJS(onDragState)(false);
    });
  // Berik 2026-11-09: «зашёл заново — предмет не берётся и не двигается»: вне
  // «Обставить» перетаскивание было выключено совсем. Теперь — после удержания;
  // сдвинул палец раньше (>10pt) — это свайп страницы, предмет не трогаем.
  if (!editable) pan = pan.activateAfterLongPress(350);
  if (blockGestures && blockGestures.length > 0) pan = pan.blocksExternalGesture(...blockGestures);

  const longPress = Gesture.LongPress()
    .onTouchesDown((_e, manager) => {
      if (hiddenNow()) manager.fail();
    })
    .enabled(editable)
    .minDuration(600)
    .onStart(() => {
      runOnJS(hapticMedium)();
      runOnJS(onRemove)(item.id);
    });

  const tap = Gesture.Tap()
    .maxDistance(8)
    .onTouchesDown((_e, manager) => {
      if (hiddenNow()) manager.fail();
    })
    .onEnd((_e, ok) => {
      if (ok && onTap) runOnJS(onTap)(item.id);
    });

  const style = useAnimatedStyle(() => {
    const s = SURF[si.value];
    const p = surfaceToScene(roomWidth, roomHeight, cam.value, s, su.value, sv.value);
    // Стена за спиной (при повороте) — её предметы гаснут вместе с ней.
    const w = faceWeight(surfaceFace(s), cam.value.turn ?? 0);
    return {
      opacity: w,
      transform: [
        { translateX: p.x + dx.value - SIZE / 2 },
        { translateY: p.y + dy.value - SIZE / 2 },
        // Дальше от зрителя — мельче (перспектива комнаты).
        { scale: lift.value * surfaceScaleAt(roomWidth, roomHeight, cam.value, s, su.value, sv.value) },
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
