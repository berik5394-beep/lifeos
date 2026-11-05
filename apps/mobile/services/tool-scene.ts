import type { RoomItem } from '@/services/room-catalog';
import type { Rect } from '@/services/speech-layout';

/**
 * Робот-эпик, Часть 5: геометрия сцены «робот достаёт инструмент» в
 * координатах экрана комнаты W×H (вид издалека). Чистые функции (jest).
 */
/** Полоса внизу под маленького робота и его облачко, пока инструмент открыт. */
export const ROBOT_STRIP_H = 132;
/** Робот в покое: низ робота на 96% высоты комнаты, по центру. */
export const ROBOT_REST_BOTTOM = 0.96;
const MARGIN = 8;

/** Карточка инструмента: почти весь экран, оставляя полосу для робота. */
export function toolCardRect(W: number, H: number): Rect {
  return { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - ROBOT_STRIP_H - MARGIN * 2 };
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
