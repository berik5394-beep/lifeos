import { BALLOON_MARGIN, balloonPath, balloonShape, tailTip } from '@/services/comic-balloon';

const coords = (d: string) =>
  (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('comic-balloon — облачко реплики как в комиксе', () => {
  it('замкнутый путь: начинается с M, кончается Z, без NaN', () => {
    const d = balloonPath(200, 60, 'left');
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toContain('NaN');
  });

  it('хвостик вырастает из контура: кончик есть в пути ровно как точка L', () => {
    for (const tail of ['left', 'right', 'bottom-left', 'bottom-right'] as const) {
      const tip = tailTip(200, 60, tail)!;
      const d = balloonPath(200, 60, tail);
      expect(d).toContain(`L ${(tip.x + BALLOON_MARGIN).toFixed(1)} ${(tip.y + BALLOON_MARGIN).toFixed(1)}`);
    }
  });

  it('без хвостика нет острых точек; облачко шире текста и влезает в холст', () => {
    const d = balloonPath(200, 60, 'none');
    expect(d).not.toContain(' L ');
    const xs = coords(d).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeLessThan(BALLOON_MARGIN); // выступает левее текста
    expect(Math.min(...xs)).toBeGreaterThan(0); // но в пределах холста
  });

  it('один и тот же seed — одинаковая форма (не дрожит между рендерами)', () => {
    expect(balloonPath(180, 50, 'right', { seed: 3 })).toBe(balloonPath(180, 50, 'right', { seed: 3 }));
    expect(balloonPath(180, 50, 'right', { seed: 3 })).not.toBe(balloonPath(180, 50, 'right', { seed: 4 }));
  });
  it('углы прямоугольника текста внутри облачка (текст не вылезает за контур)', () => {
    for (const [w, h] of [[300, 60], [120, 24], [260, 180]]) {
      const { rx, ry, exp } = balloonShape(w, h);
      expect((w / 2 / rx) ** exp + (h / 2 / ry) ** exp).toBeLessThanOrEqual(1);
    }
  });
  it('основание хвостика узкое и одинаковое для низкого и высокого облачка', () => {
    const base = (w: number, h: number) => {
      const d = balloonPath(w, h, 'left', { wobble: 0 });
      const ls = [...d.matchAll(/L (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
      return Math.hypot(ls[0].x - ls[2].x, ls[0].y - ls[2].y);
    };
    expect(base(300, 40)).toBeLessThan(40);
    expect(base(300, 260)).toBeLessThan(40);
  });
  it('короткая реплика круглее длинной', () => {
    expect(balloonShape(80, 22).exp).toBeLessThan(balloonShape(320, 260).exp);
  });
});
