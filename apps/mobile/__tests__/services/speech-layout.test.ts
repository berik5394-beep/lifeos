import { estimateBubbleHeight, overlapArea, planPurchaseView } from '@/services/speech-layout';

const W = 380;
const H = 640;
const LONG = 'Берик, это мне?! Спасибо за диван — просто идеально. С тобой у меня самый уютный дом!';

describe('speech-layout — реплика робота не закрывает купленный предмет', () => {
  it('облачко не перекрывает предмет при любом месте покупки', () => {
    const spots = [
      [0.5, 0.78], // мебель на полу по центру
      [0.5, 0.92], // у самого переднего края пола
      [0.2, 0.85],
      [0.85, 0.85],
      [0.5, 0.38], // картина на стене
      [0.3, 0.3],
      [0.7, 0.62],
    ];
    for (const [x, y] of spots) {
      const plan = planPurchaseView(x, y, W, H, LONG);
      expect({ spot: [x, y], overlap: overlapArea(plan.item, plan.bubble) }).toEqual({ spot: [x, y], overlap: 0 });
    }
  });

  it('робот встаёт на сторону, противоположную предмету', () => {
    expect(planPurchaseView(0.2, 0.8, W, H, LONG).robotSide).toBe('right');
    expect(planPurchaseView(0.8, 0.8, W, H, LONG).robotSide).toBe('left');
  });

  it('хвостик облачка смотрит на робота', () => {
    const left = planPurchaseView(0.8, 0.38, W, H, LONG);
    expect(left.zone).toBe('bottom');
    expect(left.tail).toBe('left');
    const right = planPurchaseView(0.2, 0.38, W, H, LONG);
    expect(right.tail).toBe('right');
  });

  it('если внизу тесно — облачко уходит наверх, хвостиком вниз к роботу', () => {
    const plan = planPurchaseView(0.5, 0.95, W, H, LONG);
    if (plan.zone === 'top') {
      expect(plan.tail).toMatch(/^bottom-/);
    }
    expect(overlapArea(plan.item, plan.bubble)).toBe(0);
  });

  it('оценка высоты облачка растёт с длиной текста', () => {
    expect(estimateBubbleHeight(LONG + LONG, 260)).toBeGreaterThan(estimateBubbleHeight(LONG, 260));
  });
});
