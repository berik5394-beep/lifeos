import { describe, it, expect } from 'vitest';
import { formatRobotSelf, mergeSelf, selfStatements } from './robot-self.js';

/** L (2026-11-10): робот помнит, что говорил о себе. */
describe('robot-self', () => {
  it('ловит фразы робота о себе, не о человеке и не вопросы', () => {
    expect(selfStatements('Мне очень нравится джаз — особенно вечером. А тебе?')).toEqual(['Мне очень нравится джаз — особенно вечером.']);
    expect(selfStatements('Я люблю, когда ты рассказываешь о планах!')).toEqual(['Я люблю, когда ты рассказываешь о планах!']);
    expect(selfStatements('Но мне искренне интересно, когда люди рассказывают про музыку.')).toHaveLength(1);
    expect(selfStatements('Я правда очень люблю рассветы.')).toHaveLength(1);
    expect(selfStatements('Мне как-то особенно запоминаются рассказы про осень.')).toHaveLength(1);
    expect(selfStatements('Наверное, именно такой «сезон открытий» мне ближе всего.')).toHaveLength(1);
    expect(selfStatements('Я ИИ, так что музыку не слушаю в обычном смысле — но мне запоминается, когда люди рассказывают о треках, которые меняли их настроение или помогали в трудный момент.')).toHaveLength(1);
    expect(selfStatements('Тебе нравится бегать?')).toEqual([]);
    expect(selfStatements('Записала задачу на завтра.')).toEqual([]);
  });
  it('без почти-повторов, последние 12', () => {
    const m = mergeSelf(['Мне нравится джаз.'], ['Мне очень нравится джаз.', 'Мой любимый цвет — синий.']);
    expect(m).toEqual(['Мне очень нравится джаз.', 'Мой любимый цвет — синий.']);
    const many = ['джаз', 'горы', 'море', 'книги', 'кофе', 'дождь', 'шахматы', 'футбол', 'кино', 'рассветы', 'математику', 'историю', 'астрономию', 'путешествия'].map((w) => `Мне нравится ${w}`);
    expect(mergeSelf([], many)).toEqual(many.slice(-12));
  });
  it('строка для мозга — последние 5', () => {
    expect(formatRobotSelf([])).toBeNull();
    expect(formatRobotSelf(['Мне нравится джаз.'])).toContain('не противоречь');
  });
});
