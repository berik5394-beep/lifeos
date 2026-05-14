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
  'забронируй', 'забронируем', 'забронируй-ка',
  'закажи', 'закажем',
  'купи билет', 'купить билет', 'купи билеты',
  'найди билет', 'найди рейс', 'найди отель', 'найди гостиницу', 'найди номер',
  'найди тур', 'найди путёвку',
  'вызови такси', 'закажи такси', 'позови такси',
  'поедем в', 'полетим в', 'полечу в', 'съезжу в', 'слетаю в',
];

const TRAVEL_NOUNS = /(рейс|билет(ы|а)?|самолёт|полёт|такси|машин[ауы]?|отель|гостиниц[ауы]?|номер|поездк[ауи]|путешествие|тур|путёвк[ауи]?)/i;

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
  // Travel: верб + сущность (или верб + город — но город детектить дорого,
  // полагаемся на верб + сущность; если без сущности но с городом, Claude разберёт).
  for (const v of TRAVEL_VERBS) {
    if (lower.includes(v) && TRAVEL_NOUNS.test(text)) {
      return { action: 'plan_travel', query: text };
    }
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
