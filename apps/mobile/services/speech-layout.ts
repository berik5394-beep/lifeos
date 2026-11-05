import type { BalloonTail } from '@/services/comic-balloon';
import { type Pt, RENDER_SCALE, ZOOM_IN, clampPan, itemDepthScale } from '@/services/room-geometry';

/**
 * Робот-эпик: где окажется увеличенный предмет и куда поставить робота с
 * облачком, чтобы реплика НЕ закрывала предмет. Чистые функции (jest).
 *
 * Экран комнаты делится на зоны: внизу — робот и облачко рядом с ним,
 * вверху — запасное место для облачка. Предмет при покупке приближаем так,
 * чтобы он встал в свободную часть; если внизу всё равно тесно (предмет у
 * переднего края пола) — облачко уходит наверх, хвостиком вниз к роботу.
 */
export type RobotSide = 'left' | 'right';
export type BubbleZone = 'bottom' | 'top';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpeechLayout {
  /** Сдвиг панорамы (как у zoomOffset) для приближения в ZOOM_IN. */
  offset: Pt;
  robotSide: RobotSide;
  zone: BubbleZone;
  tail: BalloonTail;
  /** Где предмет на экране после приближения (для проверок). */
  item: Rect;
  /** Где облачко (оценка). */
  bubble: Rect;
}

/** Робот сбоку при приближении (ROBOT_SIZE 150 × масштаб 0.68): ширина и высота на экране. */
export const ROBOT_SIDE_W = 80;
export const ROBOT_SIDE_H = 110;
const EDGE = 8;
const BUBBLE_SIDE_PAD = 60; // контур облачка + хвостик + поля вокруг текста
const LINE_H = 21;
const CHAR_W = 8.4; // средняя ширина символа шрифта реплики (15pt)

/** Высота облачка с текстом (оценка по числу строк — для раскладки до отрисовки). */
export function estimateBubbleHeight(text: string, textWidth: number): number {
  const perLine = Math.max(8, Math.floor(textWidth / CHAR_W));
  const lines = text
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(Array.from(part).length / perLine)), 0);
  return lines * LINE_H + 2 * 14 + 30; // строки + поля обёртки + выступ контура
}

/** Пересекаются ли прямоугольники (площадь пересечения). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Размер предмета на экране вблизи (как в RoomFurnitureItem: 56·R, глубина, «выпрыгивание» ×1.35). */
export function itemScreenSize(y: number): number {
  return 56 * RENDER_SCALE * itemDepthScale(y) * 1.35 * (ZOOM_IN / RENDER_SCALE);
}

/**
 * Раскладка при покупке предмета в точке (x, y) — доли комнаты W×H.
 * Робот встаёт на сторону, противоположную предмету; облачко — рядом с ним
 * внизу, если предмет туда не попадает, иначе — наверху.
 */
export function planPurchaseView(
  x: number,
  y: number,
  W: number,
  H: number,
  text: string,
): SpeechLayout {
  const Z = ZOOM_IN;
  const robotSide: RobotSide = x < 0.5 ? 'right' : 'left';
  const bottomTextW = W - ROBOT_SIDE_W - BUBBLE_SIDE_PAD;
  const bottomH = estimateBubbleHeight(text, bottomTextW);
  const bottomTop = H - Math.max(bottomH, ROBOT_SIDE_H) - EDGE;

  // Ставим предмет в центр свободной части над нижней зоной (сколько позволит край комнаты).
  const want = { x: W / 2, y: bottomTop / 2 };
  const offset = clampPan(
    {
      x: want.x - W / 2 - (x * W - W / 2) * Z,
      y: want.y - H / 2 - (y * H - H / 2) * Z,
    },
    W,
    H,
    Z,
  );
  const size = itemScreenSize(y);
  const cx = W / 2 + offset.x + (x * W - W / 2) * Z;
  const cy = H / 2 + offset.y + (y * H - H / 2) * Z;
  const item: Rect = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };

  const bottom: Rect =
    robotSide === 'left'
      ? { x: ROBOT_SIDE_W, y: H - bottomH - EDGE, w: W - ROBOT_SIDE_W, h: bottomH }
      : { x: 0, y: H - bottomH - EDGE, w: W - ROBOT_SIDE_W, h: bottomH };
  const topH = estimateBubbleHeight(text, W - BUBBLE_SIDE_PAD);
  const top: Rect = { x: 0, y: EDGE, w: W, h: topH };

  const useBottom = overlapArea(item, bottom) === 0 || overlapArea(item, bottom) <= overlapArea(item, top);
  const zone: BubbleZone = useBottom ? 'bottom' : 'top';
  const tail: BalloonTail =
    zone === 'bottom'
      ? robotSide === 'left'
        ? 'left'
        : 'right'
      : robotSide === 'left'
        ? 'bottom-left'
        : 'bottom-right';
  return { offset, robotSide, zone, tail, item, bubble: useBottom ? bottom : top };
}
