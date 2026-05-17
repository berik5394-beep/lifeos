import { describe, it, expect } from 'vitest';
import { deterministicIntent } from './intent-parser.js';

/**
 * Тесты детерминированного префильтра. Это критичный путь: 0мс, 0$,
 * надёжнее Claude — и именно сюда чаще всего бьют регрессии (Cyrillic
 * \b баг ломал travel и create_task дважды). Claude-fallback не тестим
 * (требует сети/ключа) — префильтр покрывает частотные команды.
 */

const today = new Date();
const iso = (d: Date) => d.toISOString().split('T')[0];
const plus = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

describe('deterministicIntent — dictation', () => {
  it('ловит "записывай"', () => {
    expect(deterministicIntent('Записывай')?.action).toBe('start_dictation');
  });
  it('ловит "лайфос диктофон ..."', () => {
    expect(deterministicIntent('Лайфос, диктофон включи')?.action).toBe(
      'start_dictation',
    );
  });
});

describe('deterministicIntent — memory', () => {
  it('"что я говорил про X" → search_memory с query', () => {
    const r = deterministicIntent('Что я говорил про Серика?');
    expect(r?.action).toBe('search_memory');
    expect(String(r?.query)).toContain('Серика');
  });
  it('"помнишь про X"', () => {
    expect(deterministicIntent('Помнишь про мою цель?')?.action).toBe(
      'search_memory',
    );
  });
});

describe('deterministicIntent — travel', () => {
  it('сильный глагол без существительного: "слетать в Астану"', () => {
    expect(deterministicIntent('Хочу слетать в Астану')?.action).toBe(
      'plan_travel',
    );
  });
  it('слабый глагол + travel-существительное: "найди отель в Дубае"', () => {
    expect(deterministicIntent('Найди отель в Дубае')?.action).toBe(
      'plan_travel',
    );
  });
  it('слабый глагол БЕЗ travel-существительного travel НЕ триггерит: "закажи пиццу"', () => {
    expect(deterministicIntent('Закажи пиццу')?.action).not.toBe('plan_travel');
  });
});

describe('deterministicIntent — финансы (SSOT Step 6: regex УДАЛЁН)', () => {
  // Детерминированный money-путь намеренно убран: узкий regex ловил
  // лишь часть фраз, остальное проваливалось мимо → выдумка #1.
  // Теперь add_expense/add_income классифицирует Claude parseIntent,
  // исполняет аудируемый реестр с needsConfirm:true. deterministic
  // на money-фразах ОБЯЗАН вернуть null (нет money-shortcut).
  it.each([
    'Потратил 5000 на еду',
    'Расход 12 000 такси',
    'Получил зарплату 350000',
    '40000 — комиссия Kaspi Gold за перевод',
  ])('«%s» → deterministic null (уходит в Claude→реестр)', (t) => {
    expect(deterministicIntent(t)).toBeNull();
  });
});

describe('deterministicIntent — привычки', () => {
  it('"отметь бег" → complete_habit', () => {
    const r = deterministicIntent('Отметь бег');
    expect(r?.action).toBe('complete_habit');
    expect(r?.habitName).toBe('бег');
  });
  it('несколько через "и" → complete_multiple_habits', () => {
    const r = deterministicIntent('Отметь бег и чтение');
    expect(r?.action).toBe('complete_multiple_habits');
    expect(r?.habitNames).toEqual(['бег', 'чтение']);
  });
});

describe('deterministicIntent — задачи (регрессия Cyrillic-даты)', () => {
  it('"напомни купить хлеб завтра" → create_task на завтра, дата вычищена', () => {
    const r = deterministicIntent('Напомни купить хлеб завтра');
    expect(r?.action).toBe('create_task');
    expect(r?.date).toBe(plus(1));
    expect(String(r?.title)).not.toMatch(/завтра/i);
    expect(String(r?.title)).toContain('хлеб');
  });
  it('"послезавтра" не путается с "завтра" (проверяется первым)', () => {
    const r = deterministicIntent('Создай задачу позвонить маме послезавтра');
    expect(r?.action).toBe('create_task');
    expect(r?.date).toBe(plus(2));
  });
  it('"сегодня" → дата сегодня, слово вычищено', () => {
    const r = deterministicIntent('Добавь задачу убраться сегодня');
    expect(r?.action).toBe('create_task');
    expect(r?.date).toBe(iso(today));
    expect(String(r?.title)).not.toMatch(/сегодня/i);
  });
});

describe('deterministicIntent — send_telegram (Phase 3.6)', () => {
  it('"отправь мне в телеграм купи молоко" → send_telegram', () => {
    const r = deterministicIntent('Отправь мне в телеграм купи молоко');
    expect(r?.action).toBe('send_telegram');
    expect(r?.text).toBe('купи молоко');
  });
  it('"напиши в тг список дел" → send_telegram', () => {
    const r = deterministicIntent('Напиши в тг список дел');
    expect(r?.action).toBe('send_telegram');
    expect(r?.text).toBe('список дел');
  });
  it('обычная фраза про телеграм без команды отправки → не перехват', () => {
    expect(deterministicIntent('что такое телеграм')).toBeNull();
  });
});

describe('deterministicIntent — обычный чат не перехватывается', () => {
  it('вопрос без триггеров → null (уйдёт в Claude/чат)', () => {
    expect(deterministicIntent('Как думаешь, стоит ли менять работу?')).toBeNull();
  });
});
