import type { RoomItem } from '@/services/room-catalog';
import type { Rect } from '@/services/speech-layout';

/**
 * Робот-эпик, Часть 5: геометрия сцены «робот достаёт инструмент» в
 * координатах экрана комнаты W×H (вид издалека). Чистые функции (jest).
 */
/** Робот в покое: низ робота на 96% высоты комнаты, по центру. */
export const ROBOT_REST_BOTTOM = 0.96;

/**
 * Карточка инструмента: вся комната целиком — одна область, без полосы снизу
 * (Berik: «не разделяй»). Маленький робот стоит поверх карточки в углу.
 */
export function toolCardRect(W: number, H: number): Rect {
  return { x: 0, y: 0, w: W, h: H };
}

/** Откуда вылетает карточка: из предмета или «из воздуха» над роботом. */
export function toolOrigin(source: RoomItem | null, W: number, H: number): { x: number; y: number } {
  return source ? { x: source.x * W, y: source.y * H } : { x: W / 2, y: H * ROBOT_REST_BOTTOM - 170 };
}

/**
 * Куда встаёт робот (центр низа робота), чтобы достать из предмета: сбоку от
 * него, со стороны центра комнаты, не выходя за края. Нет предмета — остаётся.
 */
export function robotStandPoint(source: RoomItem | null, W: number, H: number): { x: number; y: number } {
  if (!source) return { x: W / 2, y: H * ROBOT_REST_BOTTOM };
  const side = source.x < 0.5 ? 1 : -1;
  return {
    x: Math.min(W - 50, Math.max(50, source.x * W + side * 60)),
    y: Math.min(H * ROBOT_REST_BOTTOM, Math.max(H * 0.55, source.y * H + 40)),
  };
}

/** Сдвиг оверлея робота от его места покоя до точки (x, y). */
export function robotShift(p: { x: number; y: number }, W: number, H: number): { dx: number; dy: number } {
  return { dx: p.x - W / 2, dy: p.y - H * ROBOT_REST_BOTTOM };
}
