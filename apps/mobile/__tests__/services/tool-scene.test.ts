import { robotShift, robotStandPoint, toolCardRect, toolOrigin } from '@/services/tool-scene';

const W = 380;
const H = 640;

describe('tool-scene — робот достаёт инструмент', () => {
  it('карточка — вся комната целиком, без полосы снизу', () => {
    expect(toolCardRect(W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });
  it('карточка вылетает из предмета, а без предмета — над роботом', () => {
    expect(toolOrigin({ id: 'a', itemKey: 'desk', x: 0.2, y: 0.8 }, W, H)).toEqual({ x: 76, y: 512 });
    expect(toolOrigin(null, W, H).x).toBe(W / 2);
  });
  it('робот встаёт сбоку от предмета со стороны центра и не выходит за края', () => {
    const left = robotStandPoint({ id: 'a', itemKey: 'desk', x: 0.05, y: 0.8 }, W, H);
    expect(left.x).toBeGreaterThan(0.05 * W);
    expect(left.x).toBeGreaterThanOrEqual(50);
    const right = robotStandPoint({ id: 'b', itemKey: 'desk', x: 0.95, y: 0.8 }, W, H);
    expect(right.x).toBeLessThan(0.95 * W);
    expect(right.x).toBeLessThanOrEqual(W - 50);
  });
  it('без предмета робот остаётся на месте (сдвиг 0)', () => {
    expect(robotShift(robotStandPoint(null, W, H), W, H)).toEqual({ dx: 0, dy: 0 });
  });
});
