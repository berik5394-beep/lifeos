import { focusScrollDelta, FOCUS_GAP } from '@/services/keyboard-focus';

// Экран 390×844: прокрутка с y=170; без клавиатуры высота 600, с клавиатурой — 300.
const box = { x: 0, y: 170, w: 390, h: 300 };

describe('focusScrollDelta — поле над клавиатурой', () => {
  it('«Новая задача» внизу списка под клавиатурой → докрутить ровно до видимого', () => {
    const field = { x: 16, y: 700, w: 358, h: 44 };
    expect(focusScrollDelta({ box, field, fullHeight: 600 })).toBe(700 + 44 - (170 + 300 - FOCUS_GAP));
  });
  it('поле и так видно — не трогаем', () => {
    expect(focusScrollDelta({ box, field: { x: 16, y: 200, w: 358, h: 44 }, fullHeight: 600 })).toBe(0);
  });
  it('строка «Скажи роботу» под прокруткой — не наше поле', () => {
    expect(focusScrollDelta({ box, field: { x: 70, y: 790, w: 250, h: 44 }, fullHeight: 600 })).toBe(0);
  });
  it('поле в соседнем слайде (другой x) — не трогаем', () => {
    expect(focusScrollDelta({ box, field: { x: 420, y: 700, w: 358, h: 44 }, fullHeight: 600 })).toBe(0);
  });
  it('спрятанная вкладка (высота 0) — не трогаем', () => {
    expect(focusScrollDelta({ box: { x: 0, y: 0, w: 0, h: 0 }, field: { x: 16, y: 700, w: 358, h: 44 }, fullHeight: 600 })).toBe(0);
  });
});
