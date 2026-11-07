/**
 * На сколько докрутить, чтобы поле, в котором пишешь, встало над клавиатурой.
 * box — прокрутка сейчас (уже сжата клавиатурой), field — поле; координаты окна.
 * fullHeight — высота прокрутки без клавиатуры: поле должно лежать внутри неё
 * (иначе это не наше поле: соседний слайд или строка «Скажи роботу» под ней).
 */
export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Зазор над клавиатурой, чтобы было видно и строку под полем. */
export const FOCUS_GAP = 24;

export function focusScrollDelta({ box, field, fullHeight }: { box: FocusRect; field: FocusRect; fullHeight: number }): number {
  if (box.h <= 0 || box.w <= 0 || field.h <= 0) return 0; // прокрутка спрятана (другая вкладка)
  const midX = field.x + field.w / 2;
  if (midX < box.x || midX > box.x + box.w) return 0; // поле в соседнем слайде
  const full = Math.max(fullHeight, box.h);
  if (field.y < box.y || field.y >= box.y + full) return 0; // поле не в этой прокрутке
  const visibleBottom = box.y + box.h - FOCUS_GAP;
  const fieldBottom = field.y + field.h;
  return fieldBottom > visibleBottom ? Math.ceil(fieldBottom - visibleBottom) : 0;
}
