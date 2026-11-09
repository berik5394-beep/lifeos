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
  /** Передняя стена (за спиной в обычном виде) — видна, когда поворачиваешься. */
  front: Quad;
}
export type FaceName = keyof RoomFaces;

/**
 * Передний проём комнаты и задняя стена — доли сцены. Комната на весь экран:
 * передний проём совпадает с краями экрана (без полей и рамки), стены и пол
 * уходят прямо из углов экрана к задней стене — одна точка схода.
 */
export const FRONT = { l: 0, r: 1, t: 0, b: 1 };
export const BACK = { l: 0.2, r: 0.8, t: 0.2, b: 0.56 };

/**
 * Камера комнаты. x, y — сдвиг (пиксели сцены): поворот головы робота, наклон
 * телефона. turn — куда смотрим (Berik 2026-11-09: «встать перед предметом,
 * вся комната видна»): 0 — на заднюю стену, 1 — на правую, 2 — на переднюю,
 * 3 — на левую; дробное — посреди поворота (плавно).
 */
export interface RoomCam extends Pt {
  turn?: number;
}

/**
 * Углы комнаты: x ±1 (лево/право), y 0/1 (пол/потолок), z ±1 (перед/зад).
 * У каждой грани — углы в порядке её рисунка: верх-лево, верх-право, низ-право, низ-лево.
 */
type Corner = readonly [number, number, number];
const FACE_CORNERS: Record<FaceName, readonly [Corner, Corner, Corner, Corner]> = {
  back: [[-1, 1, 1], [1, 1, 1], [1, 0, 1], [-1, 0, 1]],
  left: [[-1, 1, -1], [-1, 1, 1], [-1, 0, 1], [-1, 0, -1]],
  right: [[1, 1, 1], [1, 1, -1], [1, 0, -1], [1, 0, 1]],
  front: [[1, 1, -1], [-1, 1, -1], [-1, 0, -1], [1, 0, -1]],
  floor: [[-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1]],
  ceiling: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
};
/** Куда смотрим (вперёд) и что справа — оси комнаты [x, z] для направлений 0..3. */
const FWD: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const RIGHT: readonly (readonly [number, number])[] = [[1, 0], [0, -1], [-1, 0], [0, 1]];

/** Стена за спиной при направлении h (её не рисуем). */
export function nearWall(h: number): FaceName {
  'worklet';
  const i = ((h % 4) + 4) % 4;
  return i === 0 ? 'front' : i === 1 ? 'left' : i === 2 ? 'back' : 'right';
}

/**
 * Точка угла на экране при взгляде в направлении h. Дальние углы — к задней
 * «стене-напротив» (BACK + сдвиг камеры), ближние — к краям экрана. collapse —
 * стена за спиной: её углы прижаты к краю экрана (−1 лево, 1 право), откуда
 * она выедет при повороте.
 */
function cornerAt(c: Corner, h: number, W: number, H: number, cam: Pt, collapse: number): Pt {
  'worklet';
  const f = FWD[h];
  const r = RIGHT[h];
  const far = f[0] * c[0] + f[1] * c[2] > 0;
  const right = collapse !== 0 ? collapse > 0 : r[0] * c[0] + r[1] * c[2] > 0;
  const top = c[1] === 1;
  if (far && collapse === 0) {
    return { x: (right ? BACK.r : BACK.l) * W + cam.x, y: (top ? BACK.t : BACK.b) * H + cam.y };
  }
  return { x: (right ? FRONT.r : FRONT.l) * W, y: (top ? FRONT.t : FRONT.b) * H };
}

function faceAt(face: FaceName, h: number, W: number, H: number, cam: Pt, collapse: number): Quad {
  'worklet';
  const c = FACE_CORNERS[face];
  return [cornerAt(c[0], h, W, H, cam, collapse), cornerAt(c[1], h, W, H, cam, collapse), cornerAt(c[2], h, W, H, cam, collapse), cornerAt(c[3], h, W, H, cam, collapse)];
}

const lerpPt = (a: Pt, b: Pt, t: number): Pt => {
  'worklet';
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

/**
 * Грани комнаты на экране. `cam` — сдвиг «камеры» в пикселях сцены: двигается
 * только дальняя стена (передний проём — край экрана), поэтому при повороте
 * головы робота или наклоне телефона комната «приоткрывается» как настоящая.
 * cam.turn — поворот: между направлениями a и a+1 грани плавно перетекают;
 * стена, уходящая за спину, прижимается к левому краю, выходящая из-за
 * спины — выезжает с правого.
 */
export function roomFaces(W: number, H: number, cam: RoomCam = { x: 0, y: 0 }): RoomFaces {
  'worklet';
  const turn = cam.turn ?? 0;
  const base = Math.floor(turn);
  const t = turn - base;
  const a = ((base % 4) + 4) % 4;
  const b = (a + 1) % 4;
  const nearA = nearWall(a);
  const nearB = nearWall(b);
  const one = (face: FaceName): Quad => {
    const qa = faceAt(face, a, W, H, cam, face === nearA ? 1 : 0);
    if (t === 0) return qa;
    const qb = faceAt(face, b, W, H, cam, face === nearB ? -1 : 0);
    return [lerpPt(qa[0], qb[0], t), lerpPt(qa[1], qb[1], t), lerpPt(qa[2], qb[2], t), lerpPt(qa[3], qb[3], t)];
  };
  return { back: one('back'), left: one('left'), right: one('right'), floor: one('floor'), ceiling: one('ceiling'), front: one('front') };
}

/** Насколько грань видна (0 — за спиной, 1 — видна): стены за спиной гаснут при повороте. */
export function faceWeight(face: FaceName, turn = 0): number {
  'worklet';
  if (face === 'floor' || face === 'ceiling') return 1;
  const base = Math.floor(turn);
  const t = turn - base;
  const a = ((base % 4) + 4) % 4;
  const b = (a + 1) % 4;
  if (face === nearWall(a)) return t;
  if (face === nearWall(b)) return 1 - t;
  return 1;
}

/** Куда смотреть, чтобы стена была прямо перед тобой. Пол/потолок — null (текущее направление). */
export function headingFor(s: Surface): number | null {
  'worklet';
  return s === 'wall-back' ? 0 : s === 'wall-right' ? 1 : s === 'wall-left' ? 3 : null;
}

/** Ближайшее по кругу значение turn с направлением h (поворот короткой дорогой). */
export function nearestTurn(current: number, h: number): number {
  const base = Math.round((current - h) / 4) * 4 + h;
  return base;
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

// ─── Свободная расстановка (Berik 2026-11-09: «каждый юзер сам дизайнер») ────
/**
 * Поверхность комнаты, на которой стоит/висит предмет. Позиция — (u, v) в долях
 * поверхности, не в долях экрана: так предмет «приклеен» к стене/полу при любом
 * движении камеры (и для будущего вида «встать перед предметом»).
 *  - floor: u слева→направо, v от задней стены (0) к зрителю (1);
 *  - wall-left: u от зрителя (0) к задней стене (1), v сверху вниз;
 *  - wall-back: u слева→направо, v сверху вниз;
 *  - wall-right: u от задней стены (0) к зрителю (1), v сверху вниз.
 */
export type Surface = 'floor' | 'wall-left' | 'wall-back' | 'wall-right';
export const SURFACES: readonly Surface[] = ['floor', 'wall-left', 'wall-back', 'wall-right'];
export const WALL_SURFACES: readonly Surface[] = ['wall-left', 'wall-back', 'wall-right'];

export function surfaceQuad(faces: RoomFaces, s: Surface): Quad {
  'worklet';
  return s === 'floor' ? faces.floor : s === 'wall-left' ? faces.left : s === 'wall-back' ? faces.back : faces.right;
}

/** Точка (u, v) поверхности → пиксели сцены. */
export function surfaceToScene(W: number, H: number, cam: RoomCam, s: Surface, u: number, v: number): Pt {
  'worklet';
  return applyMatrix(quadMatrix(1, 1, surfaceQuad(roomFaces(W, H, cam), s)), u, v);
}

/** Пиксели сцены → (u, v) на плоскости грани (обратная гомография). Может выйти за 0..1. */
export function sceneToSurface(q: Quad, p: Pt): Pt {
  'worklet';
  const m = quadMatrix(1, 1, q);
  // H = [[a b c],[d e f],[g h i]] из столбцовой 4×4.
  const a = m[0], b = m[4], c = m[12];
  const d = m[1], e = m[5], f = m[13];
  const g = m[3], h = m[7], i = m[15];
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
  const w = G * p.x + Hh * p.y + I;
  return { x: (A * p.x + B * p.y + C) / w, y: (D * p.x + E * p.y + F) / w };
}

/** Поля, чтобы предмет не уходил за край поверхности. */
const EDGE = 0.06;
function clamp01(v: number, lo = EDGE, hi = 1 - EDGE): number {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Куда встанет предмет, отпущенный в точке экрана p: пол — на полу (с полями),
 * настенный — на ту стену, над которой палец (или ближайшую), не ниже пола.
 */
export function placeAt(W: number, H: number, cam: RoomCam, spot: 'floor' | 'wall', p: Pt): { surface: Surface; u: number; v: number } {
  'worklet';
  const faces = roomFaces(W, H, cam);
  if (spot === 'floor') {
    const uv = sceneToSurface(faces.floor, p);
    return { surface: 'floor', u: clamp01(uv.x), v: clamp01(uv.y) };
  }
  let best: { surface: Surface; u: number; v: number } = { surface: 'wall-back', u: 0.5, v: 0.4 };
  let bestOut = Infinity;
  const walls: Surface[] = ['wall-left', 'wall-back', 'wall-right'];
  for (const s of walls) {
    const uv = sceneToSurface(surfaceQuad(faces, s), p);
    // Насколько точка вне грани (0 — внутри); w<0 (за плоскостью) — мимо.
    if (!Number.isFinite(uv.x) || !Number.isFinite(uv.y)) continue;
    const out = Math.max(0, -uv.x, uv.x - 1) + Math.max(0, -uv.y, uv.y - 1);
    if (out < bestOut) {
      bestOut = out;
      best = { surface: s, u: clamp01(uv.x), v: clamp01(uv.y, 0.1, 0.78) };
    }
  }
  return best;
}

/** Масштаб предмета по глубине: ближе к зрителю — крупнее. */
export function surfaceScale(s: Surface, u: number, v: number): number {
  'worklet';
  if (s === 'floor') return 0.7 + 0.55 * v;
  if (s === 'wall-back') return 0.72;
  if (s === 'wall-left') return 1.2 - 0.48 * u;
  return 0.72 + 0.48 * u;
}

/** Грань комнаты, на которой поверхность. */
export function surfaceFace(s: Surface): FaceName {
  'worklet';
  return s === 'floor' ? 'floor' : s === 'wall-left' ? 'left' : s === 'wall-back' ? 'back' : 'right';
}

/**
 * Масштаб предмета по тому, насколько близко его место — при любом повороте.
 * Мера — неискажённый перспективой отрезок: у стены вертикаль, у пола — более
 * длинная из осей; относительно задней стены в обычном виде. 0.65 подобран
 * так, что в обычном виде размеры прежние (0.72 у стены напротив, ~1.2 у ближнего пола).
 */
export function surfaceScaleAt(W: number, H: number, cam: RoomCam, s: Surface, u: number, v: number): number {
  'worklet';
  const m = quadMatrix(1, 1, surfaceQuad(roomFaces(W, H, cam), s));
  const e = 0.01;
  const p0 = applyMatrix(m, u, v);
  const pu = applyMatrix(m, u + e, v);
  const pv = applyMatrix(m, u, v + e);
  const lu = Math.hypot(pu.x - p0.x, pu.y - p0.y) / e;
  const lv = Math.hypot(pv.x - p0.x, pv.y - p0.y) / e;
  const L = s === 'floor' ? Math.max(lu, lv) / ((BACK.r - BACK.l) * W) : lv / ((BACK.b - BACK.t) * H);
  if (!Number.isFinite(L) || L <= 0) return 0.72;
  return Math.min(2.4, 0.72 * Math.pow(L, 0.65));
}
