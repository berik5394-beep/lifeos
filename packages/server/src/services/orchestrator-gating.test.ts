import { describe, it, expect } from 'vitest';
import {
  mayNeedLocalTools,
  isTelegramDataRequest,
  DEGRADED_ACTIONABLE_REFUSAL,
} from './jarvis-orchestrator.js';

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
    'кто такой Серик',
    'дай телефон Айгерим',
    'что я говорил про брата',
    'помнишь про мою цель накопить',
    'какая сегодня погода',
    'что надеть на встречу',
    'во сколько выезжать в аэропорт',
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

/**
 * ISSUE-1 — страховка перед 9A.8. Контракт: при падении tool-пути
 * сообщение, требующее инструментов, ДОЛЖНО получить честный отказ
 * (mayNeedLocalTools=true → отказ), а не деградированную выдумку.
 * Болтовня/инфо (false) деградирует нормально.
 */
describe('ISSUE-1 degraded-mode honest-refusal contract', () => {
  it('отказ явно говорит, что действие НЕ выполнено', () => {
    expect(DEGRADED_ACTIONABLE_REFUSAL).toMatch(/НЕ выполнен/i);
    expect(DEGRADED_ACTIONABLE_REFUSAL.length).toBeGreaterThan(20);
  });

  it.each([
    'добавь задачу купить хлеб завтра',
    'сколько я потратил в этом месяце',
    'разбери почту',
    'запиши расход 5000 на еду',
  ])('actionable «%s» → mayNeedLocalTools=true → при деградации отказ', (t) => {
    expect(mayNeedLocalTools(t)).toBe(true);
  });

  it.each(['расскажи анекдот', 'как дела', 'привет'])(
    'болтовня «%s» → false → деградирует нормально (web_search ок)',
    (t) => expect(mayNeedLocalTools(t)).toBe(false),
  );
});

/**
 * ISSUE-2: send_telegram должен резолвить дата-запрос мозгом, а не
 * слать литерал. Классификатор решает: резолвить (true) или слать
 * как есть (false). Confirm-гейт — подстраховка на ложные срабатывания.
 */
describe('isTelegramDataRequest', () => {
  it.each([
    'список задач на сегодня',
    'мой бюджет на месяц',
    'что у меня сегодня',
    'план на неделю',
    'сколько я потратил',
    'итоги дня',
    'прогресс по целям',
    'какие встречи завтра',
  ])('дата-запрос «%s» → true (резолвим мозгом)', (t) =>
    expect(isTelegramDataRequest(t)).toBe(true),
  );

  it.each([
    'напомни купить хлеб',
    'позвонить маме в 5',
    'купи продукты',
    'привет',
    'спасибо большое',
  ])('литеральная заметка «%s» → false (шлём как есть)', (t) =>
    expect(isTelegramDataRequest(t)).toBe(false),
  );
});
