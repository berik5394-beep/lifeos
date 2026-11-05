/**
 * Робот-эпик: форма облачка реплики как в комиксе — «пухлый» овал
 * (суперэллипс) с лёгкой неровностью, будто нарисован от руки, и острым
 * хвостиком, который вырастает из самого контура (а не приклеен сбоку).
 * Чистые функции → SVG path; покрыто jest.
 */
export type BalloonTail = 'bottom' | 'bottom-left' | 'bottom-right' | 'left' | 'right' | 'none';

interface Node {
  x: number;
  y: number;
  sharp: boolean;
}

/** Отступ контура от текста по горизонтали и вертикали. */
export const BALLOON_PAD_X = 16;
export const BALLOON_PAD_Y = 12;
/** Запас холста вокруг текста: облачко + хвостик + тень. */
export const BALLOON_MARGIN = 60;
/** Длина хвостика от контура и половина ширины его основания. */
const TAIL_LEN = 16;
const TAIL_HALF_BASE = 11;

const N = 72; // точек по контуру

/** Детерминированный «шум» 0..1 — каждое облачко чуть своё, но стабильное между рендерами. */
function noise(i: number, seed: number): number {
  const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Радиусы и «округлость» облачка. Отступ от текста постоянный, а степень
 * суперэллипса подбирается, чтобы углы текста точно влезли: короткая реплика
 * получается круглее, длинная — ближе к скруглённому прямоугольнику (как в комиксах).
 */
export function balloonShape(w: number, h: number): { rx: number; ry: number; exp: number } {
  const rx = w / 2 + BALLOON_PAD_X;
  const ry = h / 2 + BALLOON_PAD_Y;
  const a = w / 2 / rx;
  const b = h / 2 / ry;
  let exp = 2.5;
  while (a ** exp + b ** exp > 0.97 && exp < 16) exp += 0.25;
  return { rx, ry, exp };
}

/** Кончик хвостика относительно прямоугольника текста w×h. */
export function tailTip(w: number, h: number, tail: BalloonTail): { x: number; y: number } | null {
  const y = Math.min(24, h / 2);
  switch (tail) {
    case 'bottom':
      return { x: w / 2, y: h + BALLOON_PAD_Y + TAIL_LEN + 4 };
    case 'bottom-left':
      return { x: Math.min(34, w * 0.25), y: h + BALLOON_PAD_Y + TAIL_LEN + 4 };
    case 'bottom-right':
      return { x: w - Math.min(34, w * 0.25), y: h + BALLOON_PAD_Y + TAIL_LEN + 4 };
    case 'left':
      return { x: -BALLOON_PAD_X - TAIL_LEN, y };
    case 'right':
      return { x: w + BALLOON_PAD_X + TAIL_LEN, y };
    default:
      return null;
  }
}

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * SVG path облачка для текста w×h. Координаты сдвинуты на `offset`
 * (обычно BALLOON_MARGIN — холст больше текста, чтобы влезли хвостик и тень).
 */
export function balloonPath(
  w: number,
  h: number,
  tail: BalloonTail,
  { seed = 1, wobble = 1.4, offset = BALLOON_MARGIN }: { seed?: number; wobble?: number; offset?: number } = {},
): string {
  const cx = w / 2;
  const cy = h / 2;
  const { rx, ry, exp } = balloonShape(w, h);

  let nodes: Node[] = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const jitter = (noise(i, seed) - 0.5) * 2 * wobble; // ± px «от руки»
    nodes.push({
      x: cx + (rx + jitter) * Math.sign(c) * Math.abs(c) ** (2 / exp),
      y: cy + (ry + jitter) * Math.sign(s) * Math.abs(s) ** (2 / exp),
      sharp: false,
    });
  }

  const tip = tailTip(w, h, tail);
  if (tip) {
    // Точка контура, ближайшая к кончику; основание — точки на TAIL_HALF_BASE в обе стороны.
    let best = 0;
    nodes.forEach((p, i) => {
      if (dist(p, tip) < dist(nodes[best], tip)) best = i;
    });
    const at = (i: number) => nodes[((i % N) + N) % N];
    let back = 1;
    while (back < N / 4 && dist(at(best - back), at(best)) < TAIL_HALF_BASE) back++;
    let fwd = 1;
    while (fwd < N / 4 && dist(at(best + fwd), at(best)) < TAIL_HALF_BASE) fwd++;
    const startIdx = ((best - back) % N + N) % N;
    const drop = new Set<number>();
    for (let d = -back; d <= fwd; d++) drop.add(((best + d) % N + N) % N);
    const out: Node[] = [];
    nodes.forEach((p, i) => {
      if (i === startIdx) {
        out.push({ ...at(best - back), sharp: true }, { x: tip.x, y: tip.y, sharp: true }, { ...at(best + fwd), sharp: true });
      } else if (!drop.has(i)) {
        out.push(p);
      }
    });
    nodes = out;
  }

  // Начинаем с гладкой точки, у которой и сосед слева гладкий.
  const start = nodes.findIndex((p, i) => !p.sharp && !nodes[(i - 1 + nodes.length) % nodes.length].sharp);
  const ring = [...nodes.slice(start), ...nodes.slice(0, start)];
  const n = ring.length;
  const f = (v: number) => (v + offset).toFixed(1);
  const mid = (p: Node, q: Node) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

  const first = mid(ring[n - 1], ring[0]);
  let d = `M ${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    if (p.sharp) {
      d += ` L ${f(p.x)} ${f(p.y)}`;
    } else {
      const m = q.sharp ? q : mid(p, q);
      d += ` Q ${f(p.x)} ${f(p.y)} ${f(m.x)} ${f(m.y)}`;
    }
  }
  return `${d} Z`;
}
