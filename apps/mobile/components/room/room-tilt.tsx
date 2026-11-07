import { useEffect } from 'react';
import {
  SensorType,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedSensor,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { RENDER_SCALE as R } from '@/services/room-geometry';

/** Сдвиг дальней стены (пиксели сцены) на единицу наклона (доля g). */
const TILT_GAIN = 70 * R;
const TILT_MAX = 18 * R;
/** Как быстро «ноль» догоняет привычный наклон руки (за отсчёт, ~30 Гц ≈ 3 с). */
const BASE_FOLLOW = 0.012;
const G = 9.81;
/** Меньше полпикселя на экране — не двигаем. */
const DEADBAND = 0.5 * R;

/**
 * Наклон телефона → камера комнаты: чуть повернул телефон — дальняя стена
 * сдвинулась, комната «приоткрылась», как окно в настоящую. Датчик гравитации
 * встроен в Reanimated (нового нативного модуля нет), всё на UI-потоке.
 * «Ноль» плавно подстраивается под то, как человек держит телефон, поэтому
 * работает и лёжа, и сидя. Монтируется, только пока комната на экране, —
 * иначе датчик не тратит батарею. На симуляторе датчика нет — сдвиг 0.
 */
export function RoomTilt({ tiltX, tiltY }: { tiltX: SharedValue<number>; tiltY: SharedValue<number> }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const ready = useSharedValue(false);

  useAnimatedReaction(
    () => gravity.sensor.value,
    (v) => {
      const gx = v.x / G;
      const gy = v.y / G;
      if (!ready.value) {
        baseX.value = gx;
        baseY.value = gy;
        ready.value = true;
        return;
      }
      baseX.value += (gx - baseX.value) * BASE_FOLLOW;
      baseY.value += (gy - baseY.value) * BASE_FOLLOW;
      const clamp = (n: number) => Math.min(TILT_MAX, Math.max(-TILT_MAX, n));
      // Правый край ушёл от глаз (вниз) → смотрим «слева» → дальняя стена влево.
      // Верх наклонили к себе → смотрим «сверху» → дальняя стена вверх.
      const nx = clamp(-(gx - baseX.value) * TILT_GAIN);
      const ny = clamp((gy - baseY.value) * TILT_GAIN);
      // Мёртвая зона: дрожание руки не пересчитывает комнату каждый кадр.
      if (Math.abs(nx - tiltX.value) > DEADBAND) tiltX.value = nx;
      if (Math.abs(ny - tiltY.value) > DEADBAND) tiltY.value = ny;
    },
  );

  useEffect(
    () => () => {
      tiltX.value = withTiming(0, { duration: 300 });
      tiltY.value = withTiming(0, { duration: 300 });
    },
    [tiltX, tiltY],
  );
  return null;
}
