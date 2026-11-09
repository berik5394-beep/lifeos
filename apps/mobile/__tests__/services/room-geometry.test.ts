import {
  applyMatrix,
  clampPan,
  itemDepthScale,
  pointDepth,
  quadMatrix,
  roomFaces,
  zoomOffset,
  type Quad,
} from '@/services/room-geometry';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('room-geometry — 3D-комната и приближение', () => {
  it('quadMatrix переводит углы прямоугольника точно в углы четырёхугольника (перспектива)', () => {
    const quad: Quad = [
      { x: 10, y: 20 },
      { x: 300, y: 60 },
      { x: 280, y: 400 },
      { x: 30, y: 500 },
    ];
    const m = quadMatrix(200, 100, quad);
    const corners = [applyMatrix(m, 0, 0), applyMatrix(m, 200, 0), applyMatrix(m, 200, 100), applyMatrix(m, 0, 100)];
    corners.forEach((c, i) => {
      close(c.x, quad[i].x);
      close(c.y, quad[i].y);
    });
  });

  it('прямоугольник → такой же прямоугольник даёт сдвиг/масштаб без перспективы', () => {
    const m = quadMatrix(100, 50, [
      { x: 5, y: 5 },
      { x: 105, y: 5 },
      { x: 105, y: 55 },
      { x: 5, y: 55 },
    ]);
    close(m[3], 0);
    close(m[7], 0);
    const p = applyMatrix(m, 50, 25);
    close(p.x, 55);
    close(p.y, 30);
  });

  it('грани комнаты стыкуются: пол начинается у низа задней стены и доходит до переднего края', () => {
    const f = roomFaces(400, 600);
    expect(f.floor[0]).toEqual(f.back[3]);
    expect(f.floor[1]).toEqual(f.back[2]);
    expect(f.left[1]).toEqual(f.back[0]);
    expect(f.right[3]).toEqual(f.back[2]);
    expect(f.floor[2].y).toBeGreaterThan(f.back[2].y);
  });

  it('предметы ближе к зрителю крупнее', () => {
    expect(itemDepthScale(0.9)).toBeGreaterThan(itemDepthScale(0.3));
  });

  it('zoomOffset ставит точку в центр, но не показывает пустоту за краями комнаты', () => {
    const W = 400;
    const H = 600;
    const center = zoomOffset({ x: 200, y: 300 }, W, H, 2);
    close(center.x, 0);
    close(center.y, 0);
    const near = zoomOffset({ x: 180, y: 300 }, W, H, 2);
    close(near.x, 40);
    // Комната на весь экран: предел — край экрана. 2*0.5*400-200 = 200; 2*0.5*600-300 = 300.
    const corner = zoomOffset({ x: 0, y: 0 }, W, H, 2);
    close(corner.x, 200);
    close(corner.y, 300);
    const far = clampPan({ x: -999, y: -999 }, W, H, 2);
    close(far.x, -200);
    close(far.y, -300);
    // Без приближения двигать нечего.
    expect(clampPan({ x: 50, y: 50 }, W, H, 1)).toEqual({ x: 0, y: 0 });
  });

  it('комната на весь экран: передний проём — углы экрана, без полей и рамки', () => {
    const f = roomFaces(400, 600);
    expect(f.left[0]).toEqual({ x: 0, y: 0 });
    expect(f.right[1]).toEqual({ x: 400, y: 0 });
    expect(f.floor[2]).toEqual({ x: 400, y: 600 });
    expect(f.floor[3]).toEqual({ x: 0, y: 600 });
  });

  it('камера сдвигает только дальнюю стену — передний проём стоит на месте (параллакс)', () => {
    const still = roomFaces(400, 600);
    const moved = roomFaces(400, 600, { x: 12, y: -8 });
    expect(moved.back[0]).toEqual({ x: still.back[0].x + 12, y: still.back[0].y - 8 });
    expect(moved.back[2]).toEqual({ x: still.back[2].x + 12, y: still.back[2].y - 8 });
    expect(moved.left[0]).toEqual(still.left[0]);
    expect(moved.floor[2]).toEqual(still.floor[2]);
    // Грани по-прежнему стыкуются.
    expect(moved.floor[0]).toEqual(moved.back[3]);
    expect(moved.left[1]).toEqual(moved.back[0]);
  });

  it('pointDepth: задняя стена — 1, передний край пола — 0, боковая стена — по ширине', () => {
    close(pointDepth(0.5, 0.3), 1);
    close(pointDepth(0.5, 1), 0);
    expect(pointDepth(0.5, 0.64)).toBeGreaterThan(pointDepth(0.5, 0.9));
    // Часы на левой стене (x 0.13) — где-то посередине глубины.
    const side = pointDepth(0.13, 0.42);
    expect(side).toBeGreaterThan(0.2);
    expect(side).toBeLessThan(0.8);
  });
});

import { placeAt, sceneToSurface, surfaceQuad, surfaceToScene, roomFaces as facesOf, type Surface } from '@/services/room-geometry';

describe('свободная расстановка: поверхность ↔ экран', () => {
  const W = 400;
  const H = 800;
  const cam = { x: 12, y: -6 };
  it.each<[Surface, number, number]>([
    ['floor', 0.3, 0.7],
    ['wall-left', 0.6, 0.4],
    ['wall-back', 0.2, 0.3],
    ['wall-right', 0.35, 0.55],
  ])('%s (%f, %f): туда и обратно — та же точка', (s, u, v) => {
    const p = surfaceToScene(W, H, cam, s, u, v);
    const back = sceneToSurface(surfaceQuad(facesOf(W, H, cam), s), p);
    expect(back.x).toBeCloseTo(u, 5);
    expect(back.y).toBeCloseTo(v, 5);
  });

  it('мебель, отпущенная где угодно, — на полу внутри краёв', () => {
    const r = placeAt(W, H, cam, 'floor', { x: -50, y: 10 });
    expect(r.surface).toBe('floor');
    expect(r.u).toBeGreaterThanOrEqual(0.06);
    expect(r.v).toBeGreaterThanOrEqual(0.06);
  });

  it('картина, отпущенная у левой стены, — на левой стене; у задней — на задней; не ниже пола', () => {
    const left = placeAt(W, H, { x: 0, y: 0 }, 'wall', { x: W * 0.08, y: H * 0.4 });
    expect(left.surface).toBe('wall-left');
    const back = placeAt(W, H, { x: 0, y: 0 }, 'wall', { x: W * 0.5, y: H * 0.35 });
    expect(back.surface).toBe('wall-back');
    const low = placeAt(W, H, { x: 0, y: 0 }, 'wall', { x: W * 0.5, y: H * 0.9 });
    expect(low.v).toBeLessThanOrEqual(0.78);
  });
});
