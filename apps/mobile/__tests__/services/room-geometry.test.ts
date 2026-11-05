import {
  applyMatrix,
  clampPan,
  itemDepthScale,
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

  it('zoomOffset ставит точку в центр, но не показывает пустоту за стенами и под полом', () => {
    const W = 400;
    const H = 600;
    const center = zoomOffset({ x: 200, y: 300 }, W, H, 2);
    close(center.x, 0);
    close(center.y, 0);
    const near = zoomOffset({ x: 180, y: 300 }, W, H, 2);
    close(near.x, 40);
    // Предел — передний проём комнаты: 2*(0.5-0.03)*400-200 = 176; 2*(0.5-0.06)*600-300 = 228.
    const corner = zoomOffset({ x: 0, y: 0 }, W, H, 2);
    close(corner.x, 176);
    close(corner.y, 228);
    const far = clampPan({ x: -999, y: -999 }, W, H, 2);
    close(far.x, -176);
    close(far.y, -264); // низ проёма 0.97: 2*(0.5-0.97)*600+300
    // Без приближения двигать нечего.
    expect(clampPan({ x: 50, y: 50 }, W, H, 1)).toEqual({ x: 0, y: 0 });
  });
});
