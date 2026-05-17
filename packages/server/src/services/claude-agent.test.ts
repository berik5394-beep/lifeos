import { describe, it, expect } from 'vitest';
import { hasRub, convertRubInText } from './claude-agent.js';

/**
 * #6 — детерминированная защита от рублей (не промпт-надежда).
 * Промт раз за разом не удерживал ₸; это пост-обработка с реальным
 * курсом. Чистую часть тестируем без сети — ровно тот «структурный
 * тест», которого требовал meta-скепсис.
 */
describe('hasRub', () => {
  it.each(['от 29 814 ₽', '1 271 руб', 'цена 3 637 рублей', '6 207₽'])(
    'детектит «%s»',
    (t) => expect(hasRub(t)).toBe(true),
  );
  it('чистый тенге — не триггерит', () => {
    expect(hasRub('всего 96 678 тенге, бюджет 1 000 000 ₸')).toBe(false);
  });
});

describe('convertRubInText (rate=5.5)', () => {
  it('конвертит ₽ → ₸ и добавляет сноску курса', () => {
    const r = convertRubInText('Билет 29 814 ₽ туда-обратно', 5.5);
    expect(r.touched).toBe(true);
    expect(r.text).not.toMatch(/\d\s*₽/); // суммы в ₽ убраны
    expect(r.text).not.toMatch(/\d\s*руб/);
    expect(r.text).toContain('по курсу ~5.50₸/₽');
    expect(r.text).toMatch(/163 977 ₸/); // 29814*5.5, обычный пробел
  });
  it('несколько сумм + разные формы (руб/рублей)', () => {
    const r = convertRubInText('от 1 271 руб/сутки, всего 6 207 рублей', 5);
    expect(r.text).toMatch(/6 355 ₸\/сутки/); // 1271*5
    expect(r.text).toMatch(/31 035 ₸/); // 6207*5
  });
  it('нет рублей — текст не трогаем, без сноски', () => {
    const r = convertRubInText('всё в тенге: 50 000 ₸', 5.5);
    expect(r.touched).toBe(false);
    expect(r.text).toBe('всё в тенге: 50 000 ₸');
  });
});
