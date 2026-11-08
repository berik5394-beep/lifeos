/**
 * Свайп по всему дому, как в Instagram (Berik: «с любого места»). На
 * инструментах: влево — комната, вправо — назад на «Сегодня». В комнате:
 * вправо — на «Сегодня». Экран тянется за пальцем; отпустил — решаем по
 * расстоянию (четверть экрана) или по скорости (быстрый смах).
 */
export type HomePage = 'tools' | 'room';
export type SwipeAction = 'room' | 'today' | 'stay';

const FAST = 600; // pt/s
const MIN_FAST_DX = 30;

export function swipeDecision(page: HomePage, dx: number, vx: number, width: number, onToday: boolean): SwipeAction {
  const thr = width * 0.25;
  const left = dx < -thr || (dx < -MIN_FAST_DX && vx < -FAST);
  const right = dx > thr || (dx > MIN_FAST_DX && vx > FAST);
  if (page === 'tools') {
    if (left) return 'room';
    if (right && !onToday) return 'today';
    return 'stay';
  }
  return right ? 'today' : 'stay';
}

/** Куда сдвинуть страницы, пока палец ведёт (x прокрутки); null — не тянем. */
export function dragOffset(page: HomePage, dx: number, width: number): number | null {
  if (page === 'tools' && dx < 0) return Math.min(width, -dx);
  if (page === 'room' && dx > 0) return Math.max(0, width - dx);
  return null;
}
