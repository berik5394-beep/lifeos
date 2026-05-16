import { describe, it, expect } from 'vitest';
import { mayNeedLocalTools } from './jarvis-orchestrator.js';

/**
 * Fix D: localTools не должны включаться на болтовню (лишняя
 * стоимость/латентность + риск web_search+tools комбо). Регресс-тест
 * на эвристику включения.
 */

describe('mayNeedLocalTools', () => {
  it.each([
    'что у меня сегодня по задачам',
    'добавь задачу купить хлеб завтра',
    'сколько я потратил в этом месяце',
    'перенеси встречу на вечер',
    'разбери почту',
    'как я иду к годовой цели',
  ])('«%s» → нужны инструменты', (t) => expect(mayNeedLocalTools(t)).toBe(true));

  it.each([
    'привет',
    'спасибо',
    'расскажи анекдот',
    'как дела',
    'ок',
  ])('«%s» → инструменты не нужны', (t) => expect(mayNeedLocalTools(t)).toBe(false));

  it('короткая реплика (<12 символов) всегда без инструментов', () => {
    expect(mayNeedLocalTools('задач?')).toBe(false);
  });
});
