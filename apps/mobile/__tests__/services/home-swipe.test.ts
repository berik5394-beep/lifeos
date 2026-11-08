import { dragOffset, swipeDecision } from '@/services/home-swipe';

const W = 390;

describe('свайп по дому, как в Instagram', () => {
  it('инструменты: влево — комната (далеко или быстро)', () => {
    expect(swipeDecision('tools', -120, -100, W, true)).toBe('room');
    expect(swipeDecision('tools', -40, -900, W, true)).toBe('room');
  });
  it('инструменты: вправо — «Сегодня»; уже на «Сегодня» — остаёмся', () => {
    expect(swipeDecision('tools', 120, 100, W, false)).toBe('today');
    expect(swipeDecision('tools', 120, 100, W, true)).toBe('stay');
  });
  it('комната: вправо — «Сегодня», влево — некуда', () => {
    expect(swipeDecision('room', 150, 0, W, false)).toBe('today');
    expect(swipeDecision('room', -150, 0, W, false)).toBe('stay');
  });
  it('короткий медленный сдвиг — остаёмся', () => {
    expect(swipeDecision('tools', -50, -100, W, true)).toBe('stay');
    expect(swipeDecision('room', 50, 100, W, true)).toBe('stay');
  });
  it('экран тянется за пальцем только туда, куда можно', () => {
    expect(dragOffset('tools', -100, W)).toBe(100);
    expect(dragOffset('tools', -999, W)).toBe(W);
    expect(dragOffset('tools', 100, W)).toBeNull();
    expect(dragOffset('room', 100, W)).toBe(W - 100);
    expect(dragOffset('room', -50, W)).toBeNull();
  });
});
