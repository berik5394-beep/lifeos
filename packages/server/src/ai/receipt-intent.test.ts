import { describe, it, expect } from 'vitest';
import { deterministicIntent } from './intent-parser.js';
import { autoStepsOf } from '../services/habit-auto.js';
import { mayNeedLocalTools } from '../services/jarvis-orchestrator.js';

describe('чек с фото — разные слова → камера', () => {
  it.each([
    'сфоткай чек', 'Сфотографируй чек', 'отсканируй чек', 'сканируй чек', 'распознай квитанцию', 'прочитай чек',
    'загрузи чек', 'добавь чек', 'запиши по чеку', 'запиши трату по чеку', 'внеси расход из чека', 'фото чека',
    'хочу сфоткать чек', 'лайфос, сфоткай чек', 'открой чек',
  ])('«%s»', (t) => {
    expect(deterministicIntent(t)).toEqual({ action: 'open_panel', panel: 'receipt' });
  });
  it.each(['проверь чек-лист', 'чек на 5000 был вчера', 'сфоткай чеклист задач', 'потратил 3000 на еду', 'добавь чек на 5000', 'добавь расход по чеку на 3500'])('«%s» — НЕ камера', (t) => {
    expect(deterministicIntent(t)?.panel).not.toBe('receipt');
  });
});

describe('шаги → привычка', () => {
  it('настройка строгая', () => {
    expect(autoStepsOf({ type: 'steps', min: 8000 })).toBe(8000);
    expect(autoStepsOf({ type: 'steps', min: 10 })).toBeNull();
    expect(autoStepsOf({ type: 'steps', min: 8000, extra: 1 })).toBeNull();
    expect(autoStepsOf(null)).toBeNull();
    expect(autoStepsOf('8000')).toBeNull();
  });
  it.each(['отмечай ходьбу сама при 8000 шагов', 'засчитывай прогулку автоматически если пройду 10 тысяч', 'по шагомеру закрывай зарядку'])('«%s» → инструменты', (t) => {
    expect(mayNeedLocalTools(t)).toBe(true);
  });
});
