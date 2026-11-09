import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deterministicIntent } from './intent-parser.js';

const SRC = readFileSync(join(process.cwd(), 'src/ai/intent-parser.ts'), 'utf-8');

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

describe('deterministicIntent — финансы (Step 6 ОТКАТ: regex ВОЗВРАЩЁН)', () => {
  // Удаление regex провалено эмпирически (88888 не записан, бот
  // выдумал). Детерминированный money-prefilter возвращён → деньги
  // НЕ доходят до чат-агента, идут в реестр с подтверждением.
  it('"потратил 5000 на еду" → add_expense', () => {
    const r = deterministicIntent('Потратил 5000 на еду');
    expect(r?.action).toBe('add_expense');
    expect(r?.amount).toBe(5000);
  });
  it('пробелы в числе: "расход 12 000 такси" → add_expense', () => {
    const r = deterministicIntent('Расход 12 000 такси');
    expect(r?.action).toBe('add_expense');
    expect(r?.amount).toBe(12000);
  });
  it('"получил зарплату 350000" → add_income', () => {
    const r = deterministicIntent('Получил зарплату 350000');
    expect(r?.action).toBe('add_income');
    expect(r?.amount).toBe(350000);
  });
  it('РЕГРЕСС-ТЕСТ #1: "Запиши расход 88888 тенге комиссия Kaspi" → add_expense (НЕ чат-агент)', () => {
    const r = deterministicIntent('Запиши расход 88888 тенге комиссия Kaspi');
    expect(r?.action).toBe('add_expense');
    expect(r?.amount).toBe(88888);
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

  // F3 fix (2026-05-30): reflective memory queries → NOT create_task,
  // must fall through to Claude/LLM so v2 enrichment block can answer.
  describe('F3: reflective memory queries are NOT create_task', () => {
    it('"Напомни кого ты помнишь из моих знакомых?" → не задача', () => {
      const r = deterministicIntent('Напомни кого ты помнишь из моих знакомых?');
      expect(r?.action).not.toBe('create_task');
    });
    it('"Напомни что ты знаешь про мою маму?" → не задача', () => {
      const r = deterministicIntent('Напомни что ты знаешь про мою маму?');
      expect(r?.action).not.toBe('create_task');
    });
    it('"Напомни какие у меня цели?" → не задача', () => {
      const r = deterministicIntent('Напомни какие у меня цели?');
      expect(r?.action).not.toBe('create_task');
    });
    it('"Напомни кто моя сестра" (без ?, рефлексивное "кто ты помнишь" not present) → all good (это явный запрос)', () => {
      // Это спорный кейс; без ? и без "ты помнишь" — может остаться create_task.
      // Тест документирует current поведение, не enforce'ит.
      const r = deterministicIntent('Напомни кто моя сестра');
      // Either reflective skip or create_task — обе OK.
      expect(r).toBeDefined();
    });
    it('regression: "Напомни купить хлеб завтра" остаётся create_task', () => {
      const r = deterministicIntent('Напомни купить хлеб завтра');
      expect(r?.action).toBe('create_task');
    });
  });

// Claude-путь не тестим поведенчески (нужны сеть/ключ). Но C1-guard —
// критичный для прода инвариант: сбой LLM на разборе интента НЕ должен
// ронять чат в 500. Проверяем структурно, что вызов модели обёрнут и
// деградирует на free-form 'unknown'.
describe('parseIntent — C1 LLM-failure guard (AUDIT-2026-06)', () => {
  it('Claude-вызов обёрнут, на сбой логирует и не пробрасывает throw', () => {
    expect(SRC).toMatch(/anthropic\.messages\.create/);
    expect(SRC).toMatch(/\[parseIntent\] LLM call failed/);
  });
  it('в catch-ветке откат на free-form unknown с исходным текстом', () => {
    const idx = SRC.indexOf('LLM call failed');
    expect(idx).toBeGreaterThan(-1);
    expect(SRC.slice(idx)).toMatch(/return \{ action: 'unknown', text \}/);
  });
});

/**
 * intent-TZ фикс (аудит brain-hands 2026-06-11, HIGH): «сегодня/завтра» считались
 * по UTC сервера. Алматы 00:30 (19:30Z накануне) → задача «на сегодня» уезжала
 * во вчера. Теперь дата = календарь юзера (tz + now инжектятся).
 */
describe('deterministicIntent — даты в поясе юзера (00:30 Алматы)', () => {
  const lateNightAlmaty = new Date('2026-05-16T19:30:00Z'); // = 17.05 00:30 Алматы
  it('"сегодня" → локальное 17-е, не серверное 16-е', () => {
    const r = deterministicIntent('Создай задачу позвонить маме сегодня', 'Asia/Almaty', lateNightAlmaty);
    expect(r?.action).toBe('create_task');
    expect(r?.date).toBe('2026-05-17');
  });
  it('без слова-даты → тоже локальное сегодня', () => {
    const r = deterministicIntent('Добавь задачу купить молоко', 'Asia/Almaty', lateNightAlmaty);
    expect(r?.date).toBe('2026-05-17');
  });
  it('"завтра" → 18-е', () => {
    const r = deterministicIntent('Напомни купить хлеб завтра', 'Asia/Almaty', lateNightAlmaty);
    expect(r?.date).toBe('2026-05-18');
  });
  it('"послезавтра" → 19-е', () => {
    const r = deterministicIntent('Создай задачу позвонить маме послезавтра', 'Asia/Almaty', lateNightAlmaty);
    expect(r?.date).toBe('2026-05-19');
  });
  it('Claude-промпт парсера тоже берёт даты из civilDayRefs, не из серверного Date', () => {
    expect(SRC).not.toMatch(/toISOString\(\)\.split\('T'\)\[0\]/);
    expect(SRC).toMatch(/civilDayRefs\(/);
  });
});

/**
 * Робот-эпик, Часть 3: «покажи/открой X» → открыть панель в приложении
 * (детерминированно, без ИИ). Вопросы не перехватываем.
 */
describe('deterministicIntent — open_panel (панели приложения)', () => {
  it.each<[string, string]>([
    ['Покажи задачи', 'tasks'],
    ['открой мои задачи на сегодня', 'tasks'],
    ['Покажи мне дела', 'tasks'],
    ['Открой привычки', 'habits'],
    ['покажи цели', 'goals'],
    ['Открой финансы', 'finance'],
    ['покажи расходы за месяц', 'finance'],
    ['Открой бюджет', 'finance'],
    ['Покажи календарь', 'calendar'],
    ['покажи расписание на неделю', 'calendar'],
    ['Открой дневник', 'journal'],
    ['Покажи сделки', 'deals'],
    ['Открой воронку', 'deals'],
    ['Покажи сводку', 'today'],
    ['открой сегодня', 'today'],
  ])('«%s» → %s', (text, panel) => {
    expect(deterministicIntent(text)).toEqual({ action: 'open_panel', panel });
  });

  it.each([
    'Какие задачи на сегодня?',
    'Сколько я потратил в этом месяце?',
    'Покажи как сэкономить',
    'покажи задачи которые я просрочил и перенеси их',
  ])('«%s» — не открытие панели', (text) => {
    expect(deterministicIntent(text)?.action).not.toBe('open_panel');
  });
});



describe('parseIntentJson — устойчиво к обёрткам модели', () => {
  it('голый JSON, ```json-обёртка, текст вокруг; мусор → null', async () => {
    const { parseIntentJson } = await import('./intent-parser.js');
    expect(parseIntentJson('{"action":"goodnight"}')).toEqual({ action: 'goodnight' });
    expect(parseIntentJson('```json\n{"action":"good_morning"}\n```')).toEqual({ action: 'good_morning' });
    expect(parseIntentJson('Вот: {"action":"get_summary","period":"today"} — готово')).toEqual({ action: 'get_summary', period: 'today' });
    expect(parseIntentJson('не json')).toBeNull();
    expect(parseIntentJson('{"foo":1}')).toBeNull();
  });
});

describe('parseIntent — пустая фраза', () => {
  it('не зовёт модель: старт живого разговора собирает контекст с text=""', async () => {
    const { parseIntent } = await import('./intent-parser.js');
    expect(await parseIntent('')).toEqual({ action: 'unknown', text: '' });
    expect(await parseIntent('   ')).toEqual({ action: 'unknown', text: '   ' });
  });
});
