import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

interface VoiceIntent {
  action: string;
  [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Deterministic prefilter — критичные интенты ловим до Claude. Зачем:
//   • Claude систематически путает booking-команды с create_task — три
//     попытки промптинга не помогли. Регекс надёжнее.
//   • Эти 3 интента (plan_travel / start_dictation / search_memory) имеют
//     характерные триггер-слова, легко детектятся без модели.
//   • Скорость + ноль cost: 0мс + $0 vs ~500мс + $0.001 на Claude.
// Если регекс не сработал, падаем на Claude как раньше.
// -----------------------------------------------------------------------------

const TRAVEL_VERBS = [
  'забронируй', 'забронируем', 'забронируй-ка', 'забронировать',
  'закажи', 'закажем', 'заказать',
  'купи билет', 'купить билет', 'купи билеты', 'купить билеты',
  'найди билет', 'найди рейс', 'найди отель', 'найди гостиницу', 'найди номер',
  'найди тур', 'найди путёвку', 'найди где',
  'вызови такси', 'закажи такси', 'позови такси',
  'поедем в', 'полетим в', 'полечу в', 'съезжу в', 'слетаю в', 'лечу в',
  'еду в', 'едем в', 'планирую поездку', 'планируем перелёт',
  'планируем поездку', 'спланируй поездку', 'organize trip',
  'нужен отель', 'нужна гостиница', 'нужен билет', 'нужны билеты',
  'где остановиться', 'где поселиться', 'куда поселиться',
  'подбери отель', 'подбери билет', 'подбери рейс',
  // намерение "хочу/надо/собираюсь + поехать/слетать/съездить + куда-то"
  'хочу слетать', 'хочу полететь', 'хочу поехать', 'хочу съездить',
  'хочу в ', 'надо слетать', 'надо съездить', 'надо в ', 'надо поехать',
  'собираюсь в ', 'собираюсь слетать', 'собираюсь поехать',
  'слетать в', 'полететь в', 'поехать в', 'съездить в',
  'планирую слетать', 'планирую поехать', 'планирую съездить',
  'organize a trip', 'plan a trip', 'book a',
];

// Travel-существительные. Расширено: командировка, перелёт, отпуск, виза.
const TRAVEL_NOUNS = /(рейс|билет(ы|а)?|самол[её]т|перел[её]т|пол[её]т|такси|машин[ауы]?|отел[ьья]|гостиниц[ауы]?|номер в|поездк[ауи]|путешестви|командировк|отпуск|тур[аы]?(?=\s|$|[,.!?])|путёвк[ауи]?|виз[ауы])/i;

const DICTATION_TRIGGERS = [
  /^лайфос[, ]+диктофон/i,
  /^включи запись/i,
  /^начни запись/i,
  /^записывай/i,
  /^запиши разговор/i,
  /^запиши за мной/i,
];

const MEMORY_TRIGGERS = [
  /^что я говорил про /i,
  /^что я рассказывал про /i,
  /^помнишь про /i,
  /^помнишь о /i,
  /^ты помнишь /i,
  /^найди в памяти /i,
  /^что ты знаешь о /i,
  /^что ты знаешь про /i,
];

function deterministicIntent(text: string): VoiceIntent | null {
  const lower = text.toLowerCase();

  for (const re of DICTATION_TRIGGERS) {
    if (re.test(text)) return { action: 'start_dictation' };
  }
  for (const re of MEMORY_TRIGGERS) {
    const m = text.match(re);
    if (m) {
      const query = text.slice(m[0].length).trim() || text;
      return { action: 'search_memory', query };
    }
  }
  // Сильные travel-глаголы: сами по себе = поездка ("слетать в Астану" —
  // существительного "рейс/билет" нет, но это явно travel). Глагол + " в " /
  // " на " (предлог направления) достаточно.
  // ВАЖНО: НЕ используем \b — в JS \w это [A-Za-z0-9_], кириллица вся \W,
  // граница слова \b после кириллического слова не срабатывает. Вместо
  // \b — lookahead на пробел/конец/пунктуацию.
  const STRONG_TRAVEL =
    /(слетать|слетаю|полететь|полечу|полетим|поехать|поедем|съездить|съезжу|еду в|едем в|лечу в|хочу слетать|хочу поехать|хочу съездить|надо слетать|надо съездить|собираюсь в|планирую слетать|планирую поехать|планирую съездить|планирую поездку|спланируй поездку)(?=\s|$|[,.!?])/i;
  if (STRONG_TRAVEL.test(lower)) {
    return { action: 'plan_travel', query: text };
  }
  // Слабые глаголы: нужна travel-сущность чтобы не путать
  // ("закажи такси" ок, но "закажи пиццу" — нет).
  for (const v of TRAVEL_VERBS) {
    if (lower.includes(v) && TRAVEL_NOUNS.test(text)) {
      return { action: 'plan_travel', query: text };
    }
  }

  // ── Детерминированные исполняемые действия ───────────────────────────
  // Claude в intent-parser ненадёжно классифицирует эти частые команды
  // (возвращает unknown) — та же беда что была с plan_travel. Регекс
  // надёжнее, 0мс, 0$. Извлекаем параметры прямо здесь.

  // add_income: "получил/заработал зарплату 350000", "доход 50000 от ..."
  let m =
    text.match(/^(?:запиши\s+)?(?:доход|получил|заработал|пришла зарплата|зарплата)\s+(?:на\s+)?(\d[\d\s]*)\s*(?:тенге|тг|₸|руб|рублей)?\s*(?:от|за|—|-)?\s*(.*)$/i);
  if (m) {
    const amount = Number(m[1].replace(/\s/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return { action: 'add_income', amount, source: m[2].trim() || 'доход' };
    }
  }

  // add_expense: "потратил 5000 на еду", "запиши расход 5000 тенге на еду",
  // "расход 3000 продукты", "5000 на такси"
  m =
    text.match(/^(?:запиши\s+)?(?:расход|потратил[аи]?|трата|купил[аи]?\s+на)\s+(?:на\s+)?(\d[\d\s]*)\s*(?:тенге|тг|₸|руб|рублей)?\s*(?:на|за|—|-)?\s*(.*)$/i) ||
    text.match(/^(\d[\d\s]{2,})\s*(?:тенге|тг|₸)?\s+на\s+(.+)$/i);
  if (m) {
    const amount = Number(m[1].replace(/\s/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      const rest = m[2].trim();
      return {
        action: 'add_expense',
        amount,
        category: rest || 'other',
        description: rest,
      };
    }
  }

  // complete_habit: "отметь привычку бег", "отметь бег", "выполнил чтение",
  // "сделал зарядку" (одна привычка)
  m = text.match(/^(?:отметь|выполнил[аи]?|сделал[аи]?|закрой)\s+(?:привычку\s+)?(.+)$/i);
  if (m) {
    const rest = m[1].trim();
    // несколько через "и"/","/"+" → complete_multiple_habits
    if (/\s+и\s+|,|\+/.test(rest)) {
      const habitNames = rest
        .split(/\s+и\s+|,|\+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (habitNames.length > 1) {
        return { action: 'complete_multiple_habits', habitNames };
      }
    }
    return { action: 'complete_habit', habitName: rest };
  }

  // create_task: "создай задачу купить хлеб завтра", "добавь задачу X",
  // "напомни купить молоко"
  m = text.match(/^(?:созда[йять]+|добавь|поставь)\s+задачу\s+(.+)$/i) ||
      text.match(/^напомни(?:ть)?\s+(?:мне\s+)?(.+)$/i);
  if (m) {
    const title = m[1].trim();
    const today = new Date();
    let date = today.toISOString().split('T')[0];
    let cleanTitle = title;
    // НЕ \b — Cyrillic word boundary в JS не работает (\w = [A-Za-z0-9_]).
    // Слова достаточно характерные, ловим без границы.
    // послезавтра проверяем ПЕРВЫМ — оно содержит подстроку "завтра".
    if (/послезавтра/i.test(title)) {
      const tm = new Date(today);
      tm.setDate(tm.getDate() + 2);
      date = tm.toISOString().split('T')[0];
      cleanTitle = title.replace(/\s*послезавтра\s*/i, ' ').trim();
    } else if (/завтра/i.test(title)) {
      const tm = new Date(today);
      tm.setDate(tm.getDate() + 1);
      date = tm.toISOString().split('T')[0];
      cleanTitle = title.replace(/\s*завтра\s*/i, ' ').trim();
    } else if (/сегодня/i.test(title)) {
      cleanTitle = title.replace(/\s*сегодня\s*/i, ' ').trim();
    }
    return {
      action: 'create_task',
      title: cleanTitle || title,
      date,
      category: 'personal',
      priority: 'medium',
    };
  }

  return null;
}

export async function parseIntent(text: string): Promise<VoiceIntent> {
  // Fast path: детерминированные интенты без вызова Claude.
  const det = deterministicIntent(text);
  if (det) return det;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const systemPrompt = `Ты — парсер голосовых команд приложения LifeOS. Пользователь дал команду голосом. Определи намерение и верни ТОЛЬКО валидный JSON.

ПОРЯДОК ПРОВЕРКИ (обязательный — не нарушай):

ШАГ 1: Команда про БРОНИРОВАНИЕ / ПОЕЗДКУ?
Признаки (хватит ОДНОГО):
  • Глагол: забронируй / закажи / купи / найди / вызови / поедем / полетим / съезди / слетай / возьми
  • Сущность: рейс / билет / самолёт / полёт / такси / машину / отель / гостиницу / номер / поездка / путешествие
  • Город как назначение: Москва, Астана, Дубай, Анталья, Стамбул, Бишкек, Ташкент, Шымкент, Алматы, Караганда, Сочи и т.д.
Если ДА → возвращай { "action": "plan_travel", "query": "<весь исходный текст команды>" } и СТОП. Не парси параметры здесь — это сделает дальше /travel/smart-book.

ШАГ 2: Команда про память (что-то спрашивает что юзер говорил/упоминал раньше)?
Признаки: "что я говорил про", "помнишь про", "ты помнишь", "что знаешь о", "найди в памяти".
Если ДА → { "action": "search_memory", "query": "<суть запроса>" } и СТОП.

ШАГ 3: Команда включить диктофон?
Признаки: "лайфос диктофон", "записывай", "включи запись", "запиши разговор", "записывай меня".
Если ДА → { "action": "start_dictation" } и СТОП.

ШАГ 4: Что-то другое — выбери из:
- create_task: { "action": "create_task", "title": string, "date": "YYYY-MM-DD", "time"?: "HH:MM", "category"?: string, "priority"?: string }
- complete_task: { "action": "complete_task", "taskTitle": string }
- complete_habit: { "action": "complete_habit", "habitName": string }
- complete_multiple_habits: { "action": "complete_multiple_habits", "habitNames": string[] }
- add_expense: { "action": "add_expense", "amount": number, "category"?: string, "description"?: string }
- add_income: { "action": "add_income", "amount": number, "source"?: string }
- create_event: { "action": "create_event", "title": string, "date": "YYYY-MM-DD", "startTime"?: "HH:MM", "endTime"?: "HH:MM" }
- get_summary: { "action": "get_summary", "period": "today" | "week" | "month" }
- get_finance: { "action": "get_finance", "period": "week" | "month" }
- get_finance_advice: { "action": "get_finance_advice" }
- ask_assistant: { "action": "ask_assistant", "question": string }
- goodnight: { "action": "goodnight" }
- good_morning: { "action": "good_morning" }
- unknown: { "action": "unknown", "text": string }
- (plan_travel / search_memory / start_dictation — см. ШАГИ 1-3 выше, не сюда)

Текущая дата: ${formatDate(today)}. "завтра" = ${formatDate(tomorrow)}, "послезавтра" = ${formatDate(dayAfter)}.
Категории задач: work, personal, health, finance, education, home.
Приоритеты: low, medium, high, critical.
Категории расходов: food (еда), transport (транспорт), entertainment (развлечения), clothing (одежда), health (здоровье), home (дом), other (другое).

Примеры для шага 4 (после того как ШАГИ 1-3 не сработали):
- "Отметь привычки бег и чтение" → complete_multiple_habits
- "Создай событие встреча с врачом завтра в 14:00" → create_event
- "Купи продукты завтра" (БЕЗ слов про билет/такси/отель) → create_task
- "Спокойной ночи" → goodnight
- "Доброе утро" → good_morning
- "Как мне сэкономить?" → get_finance_advice
- "Расскажи про инвестиции" / "что такое X" → ask_assistant

Примеры что должно сработать на ШАГЕ 1 (plan_travel):
- "Забронируй рейс в Астану на завтра" → plan_travel { query: "Забронируй рейс в Астану на завтра" }
- "Найди билет в Москву на пятницу" → plan_travel
- "Купи билеты до Анталии на 20 мая" → plan_travel
- "Вызови такси до аэропорта" → plan_travel
- "Найди отель в Дубае на 5 ночей" → plan_travel
- "Полечу в Стамбул в субботу" → plan_travel`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { action: 'unknown', text };
  }

  try {
    return JSON.parse(content.text) as VoiceIntent;
  } catch {
    return { action: 'unknown', text: content.text };
  }
}
