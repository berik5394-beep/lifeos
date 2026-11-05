import { normalizeStyle, thanksFor } from '@/services/robot-thanks';

describe('robot-thanks — робот благодарит за новый предмет', () => {
  it('называет предмет в нужном падеже и обращается по имени', () => {
    const t = thanksFor('picture', 'friendly', 'Берик Курмангалиев', () => 0);
    expect(t).toMatch(/^Берик, /);
    expect(t).toContain('картину');
  });
  it('без имени — фраза начинается с заглавной', () => {
    const t = thanksFor('sofa', 'calm', null, () => 0);
    expect(t.charAt(0)).toBe(t.charAt(0).toUpperCase());
    expect(t).toContain('диван');
  });
  it('тон по стилю: токсичный — с сарказмом, но благодарит', () => {
    const t = thanksFor('plant', 'toxic', 'Берик', () => 0);
    expect(t).toMatch(/спасибо|щедро/i);
  });
  it('неизвестный стиль → дружелюбный', () => {
    expect(normalizeStyle('weird')).toBe('friendly');
    expect(normalizeStyle(undefined)).toBe('friendly');
  });
  it('любая случайность даёт фразу (без выхода за массив)', () => {
    expect(thanksFor('clock', 'strict', 'А', () => 0.9999)).toContain('часы');
  });
  it('во всех фразах всех стилей предмет в правильном падеже («за картину», «мне — картину»)', () => {
    for (const style of ['friendly', 'strict', 'calm', 'toxic']) {
      for (let k = 0; k < 10; k++) {
        const t = thanksFor('picture', style, null, () => k / 10);
        expect(t).toMatch(/(за|мне —) картину/i);
      }
    }
  });
});
