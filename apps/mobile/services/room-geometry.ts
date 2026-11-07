/**
 * Робот-эпик: геометрия 3D-комнаты-диорамы (вид издалека, одна точка схода)
 * и приближения-панорамы. Чистые функции — покрыты jest.
 *
 * Грани комнаты рисуются обычными View, которые матрицей перспективы
 * натягиваются на заданный четырёхугольник экрана (гомография прямоугольник →
 * четырёхугольник, встроенная в 4×4 матрицу как в CSS matrix3d).
 */
export interface Pt {
  x: number;
  y: number;
}
/** Четырёхугольник по часовой: верх-лево, верх-право, низ-право, низ-лево. */
export type Quad = [Pt, Pt, Pt, Pt];

/**
 * 4×4 матрица (по столбцам, как CSS matrix3d / RN `matrix`), которая
 * переводит прямоугольник w×h с началом в левом верхнем углу в `quad`.
 * Требует transformOrigin в левом верхнем углу View.
 */
export function quadMatrix(w: number, h: number, quad: Quad): number[] {
  'worklet';
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const hh = den === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + hh * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + hh * p3.y;
  // H (3×3) для координат в пикселях прямоугольника.
  const H = [
    [a / w, b / h, p0.x],
    [d / w, e / h, p0.y],
    [g / w, hh / h, 1],
  ];
  return [
    H[0][0], H[1][0], 0, H[2][0],
    H[0][1], H[1][1], 0, H[2][1],
    0, 0, 1, 0,
    H[0][2], H[1][2], 0, H[2][2],
  ];
}

/** Применить матрицу quadMatrix к точке (для тестов и попаданий пальцем). */
export function applyMatrix(m: number[], x: number, y: number): Pt {
  'worklet';
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return { x: X / W, y: Y / W };
}

export interface RoomFaces {
  back: Quad;
  left: Quad;
  right: Quad;
  floor: Quad;
  ceiling: Quad;
}

/**
 * Передний проём комнаты и задняя стена — доли сцены. Комната на весь экран:
 * передний проём совпадает с краями экрана (без полей и рамки), стены и пол
 * уходят прямо из углов экрана к задней стене — одна точка схода.
 */
export const FRONT = { l: 0, r: 1, t: 0, b: 1 };
export const BACK = { l: 0.2, r: 0.8, t: 0.2, b: 0.56 };

/**
 * Грани комнаты на экране. `cam` — сдвиг «камеры» в пикселях сцены: двигается
 * только дальняя стена (передний проём — край экрана), поэтому при повороте
 * головы робота или наклоне телефона комната «приоткрывается» как настоящая.
 */
export function roomFaces(W: number, H: number, cam: Pt = { x: 0, y: 0 }): RoomFaces {
  'worklet';
  const f = { tl: { x: FRONT.l * W, y: FRONT.t * H }, tr: { x: FRONT.r * W, y: FRONT.t * H }, br: { x: FRONT.r * W, y: FRONT.b * H }, bl: { x: FRONT.l * W, y: FRONT.b * H } };
  const k = {
    tl: { x: BACK.l * W + cam.x, y: BACK.t * H + cam.y },
    tr: { x: BACK.r * W + cam.x, y: BACK.t * H + cam.y },
    br: { x: BACK.r * W + cam.x, y: BACK.b * H + cam.y },
    bl: { x: BACK.l * W + cam.x, y: BACK.b * H + cam.y },
  };
  return {
    back: [k.tl, k.tr, k.br, k.bl],
    left: [f.tl, k.tl, k.bl, f.bl],
    right: [k.tr, f.tr, f.br, k.br],
    floor: [k.bl, k.br, f.br, f.bl],
    ceiling: [f.tl, f.tr, k.tr, k.tl],
  };
}

/**
 * Глубина точки сцены (доли): 1 — задняя стена, 0 — передний край. Предмет
 * сдвигается вместе с камерой на cam × глубина — дальние сильнее, ближние почти
 * стоят: так и выглядит объём.
 */
export function pointDepth(x: number, y: number): number {
  'worklet';
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (y < BACK.b) {
    // Выше низа задней стены: на задней стене или на боковой (тогда — по ширине).
    if (x < BACK.l) return clamp((x - FRONT.l) / (BACK.l - FRONT.l));
    if (x > BACK.r) return clamp((FRONT.r - x) / (FRONT.r - BACK.r));
    return 1;
  }
  return clamp((FRONT.b - y) / (FRONT.b - BACK.b));
}

/** Чем ближе к зрителю (ниже по сцене), тем крупнее предмет. */
export function itemDepthScale(y: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (y - BACK.t) / (FRONT.b - BACK.t)));
  return 0.7 + 0.55 * t;
}

/**
 * Сцена комнаты рисуется сразу крупно (в RENDER_SCALE раз) и уменьшается для
 * вида издалека — так при приближении всё чёткое, без мыла. Все пиксельные
 * размеры деталей комнаты умножаются на него. Приближение = ровно этот масштаб.
 */
export const RENDER_SCALE = 2.2;
export const ZOOM_IN = RENDER_SCALE;

/**
 * Ограничить сдвиг панорамы при приближении: окно просмотра не выходит за
 * передний проём комнаты (FRONT) — пустоту за стенами и под полом не видно.
 * Масштаб — относительно центра сцены.
 */
export function clampPan(t: Pt, W: number, H: number, scale: number): Pt {
  'worklet';
  const lim = (v: number, size: number, lo: number, hi: number) => {
    const max = scale * (size / 2 - lo * size) - size / 2;
    const min = scale * (size / 2 - hi * size) + size / 2;
    // Если проём меньше окна (масштаб ~1) — не двигаем.
    if (min > max) return 0;
    return Math.min(max, Math.max(min, v));
  };
  return { x: lim(t.x, W, FRONT.l, FRONT.r), y: lim(t.y, H, FRONT.t, FRONT.b) };
}

/** Сдвиг для приближения в `scale` раз так, чтобы точка `p` оказалась в центре (в пределах clampPan). */
export function zoomOffset(p: Pt, W: number, H: number, scale: number): Pt {
  return clampPan({ x: (W / 2 - p.x) * scale, y: (H / 2 - p.y) * scale }, W, H, scale);
}
