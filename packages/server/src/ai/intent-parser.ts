import { MODELS } from '../lib/models.js';
import { createAnthropic, QUICK_CALL } from '../lib/anthropic.js';
import { civilDayRefs, addCivilDays } from '../lib/tz.js';
import { parseRuWhen } from '../lib/ru-when.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';
import { cachedSystem } from '../lib/prompt-cache.js';

const anthropic = createAnthropic();

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
  'едем в', 'планирую поездку', 'планируем перелёт',
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
/** Задача/напоминание/встреча/дела — это план дня, а не подбор поездки. */
const TASK_FRAME = /(задач|напомн|встреч|созвон|(?:^|[^а-яё])дел[ао]?(?![а-яё])|список дел)/i;
/** Голое движение без направления: «поехать узнать», «съездить забрать». */
const BARE_MOTION = /(?:^|[^а-яё])(поехать|поедем|съездить|съезжу)(?![а-яё])/i;
const MOTION_WITH_DIRECTION = /(?:поехать|поедем|съездить|съезжу)\s+(?:в|во|на|до|к|ко|за\s+границу)\s/i;
// Целыми словами (2026-11-09: «машинным маслом» ловилось как «машина»,
// «номер в контактах» — как номер в отеле).
const TRAVEL_NOUNS = /(?:^|[^а-яё])(рейс[аыов]*|билет(ы|а|ов)?|самол[её]т[аы]?|перел[её]т[аы]?|пол[её]т|такси|машин[ауы]?|отел[ьяюи]|гостиниц[ауы]?|поездк[ауи]|путешестви[еяю]|командировк[ауи]|отпуск[аеу]?|тур[аы]?|путёвк[ауи]?|виз[ауы])(?![а-яё])/i;
/** Однозначные сущности брони — для пути «забронируй/найди/оформи + X»
 *  («оформить отпуск на работе», «нужна машина» — не подбор поездки). */
const BOOKING_NOUNS = /(?:^|[^а-яё])(рейс[аыов]*|билет(ы|а|ов)?|самол[её]т[аы]?|перел[её]т[аы]?|такси|отел[ьяюи]|гостиниц[ауы]?|авиабилет[аыов]*)(?![а-яё])/i;
/** Фраза «v» целиком с начала слова («среду в» ≠ «еду в»). */
function hasPhrase(lower: string, v: string): boolean {
  return new RegExp(`(?:^|[^а-яё])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lower);
}

/**
 * Чек с фото → открыть камеру в приложении (без ИИ). Разные формулировки:
 * сфоткай/сфотографируй/сними/отсканируй/сканируй/распознай/прочитай/считай/
 * загрузи/добавь + чек/квитанцию/фото чека; «запиши (трату) по чеку».
 */
const RECEIPT_TRIGGERS = [
  /^(?:лайфос[, ]+)?(?:сфоткай|сфотографируй|сфоткать|сними|отсканируй|сканируй|отсканировать|распознай|прочитай|считай|загрузи|добавь|открой)\s+(?:мне\s+)?(?:фото\s+)?(?:чек|чеки|квитанци[юя]|чека)(?![а-яё])/i,
  /^(?:лайфос[, ]+)?(?:запиши|добавь|внеси)\s+(?:трату\s+|расход\s+|покупку\s+)?(?:по|с|из)\s+(?:фото\s+)?(?:чек[ау]?|квитанци[иею])(?![а-яё])/i,
  /^(?:лайфос[, ]+)?(?:фото|скан|сканер)\s+чека(?![а-яё])/i,
  /^(?:хочу\s+)?(?:сфоткать|отсканировать|загрузить)\s+чек(?![а-яё])/i,
];

const DICTATION_TRIGGERS = [
  /^лайфос[, ]+диктофон/i,
  /^включи запись/i,
  /^начни запись/i,
  // «записывай» — только сама команда, не «записывай расходы каждый день».
  /^записывай(?:\s+(?:за\s+мной|разговор|всё|все))?[\s.!]*$/i,
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

export type MoneyIntent =
  | { action: 'add_expense'; amount: number; category?: string; description?: string; date?: string }
  | { action: 'add_income'; amount: number; source?: string };

/**
 * Чистый детект денег. Расширен против старого inline-prefilter:
 *  - допускает ведущие слова до money-слова (`(?:[а-яё]+\s+){0,3}?`) —
 *    «я потратил», «сегодня купил на» (живой баг #189: «я потратил
 *    100000» мимо якоря ^ → чат-агент сочинял запись, в БД 0 строк);
 *  - НЕ дефолтит категорию/источник — отсутствует, если не указан
 *    (оркестратор доспросит через FSM, без LLM-нарратива).
 *  Консервативно: нужен money-глагол + число (голое «100000» → null).
 *  `[а-яё]` (НЕ \w — кириллица).
 */
// Сумма + необязательный множитель: «2 млн», «2,5 млн», «3 миллиона», «500 тысяч»,
// «5 тыс», «500к», «5 к», «2 000 000», «1,000». Ревью сделок B2: раньше «2 млн» → сумма 2,
// а «млн …» уезжал в источник. «к» приклеенное к числу («500к») — тысяча; отдельное
// («5 к») — только в конце или перед «на/за/от/тенге» (иначе это предлог: «500 к ужину»).
// Ревью-3 N3: всё прочее — как до сделок: число — цифры через пробелы (как прежнее
// `\d[\d\s]*`, «8 777 123 45 67» — одно число → потолок), без требований к символу
// после числа («5000кофе», «500р», «2x500», «100usd», «100$» — сумма + остаток, как раньше).
// Дробь («2,5») — только перед множителем; без него «12.11», «12,50» — как раньше.
// Множитель — целым словом («5 тысячелетий» — не тысячи).
const WORD_MULT = String.raw`(?:млрд\.?|миллиард(?:ами|ов|а|ы)?|млн\.?|миллион(?:ами|ов|а|ы)?|тыс(?:яч(?:ами|ей|а|и|у)?)?\.?)(?![а-яё])`;
const K_SEP_AHEAD = String.raw`(?=$|[,.!?]|\s+(?:на|за|от|—|-|тенге|тг|₸)(?:\s|$))`;
const K_GLUED_AHEAD = String.raw`(?=\s|$|[,.!?₸]|тг|тенге|руб)`;
const AMOUNT =
  String.raw`(\d{1,3}(?:,\d{3})+(?![.,]?\d)` +
  String.raw`|\d+[.,]\d+(?=\s*(?:${WORD_MULT})|\s+к${K_SEP_AHEAD}|к${K_GLUED_AHEAD})` +
  String.raw`|\d+(?:\s+\d+)*)` +
  String.raw`(?:\s*(${WORD_MULT})|\s+(к)${K_SEP_AHEAD}|(к)${K_GLUED_AHEAD})?`;

/** Валюта после суммы — длинные формы раньше короткой («рублей», не «руб»+«лей»). */
const CURRENCY = String.raw`(?:тенге|тг|₸|рублей|рубля|рубль|руб)`;

/**
 * Остаток после суммы (источник/категория). Ревью-3 N1: «получил 5000, от Ахмета» —
 * без ведущей запятой. Но если за знаком цифра («12.11», «12,50») — это хвост числа,
 * оставляем как было до сделок.
 */
function cleanRest(rest: string): string {
  const t = rest.trim();
  const stripped = t.replace(/^[,.!?\s]+/, '');
  return /^\d/.test(stripped) ? t : stripped;
}

function parseAmount(num: string, word: string | undefined, k: string | undefined): number {
  const n = num.replace(/\s/g, '');
  const w = (word ?? '').toLowerCase();
  const hasMult = !!w || !!k;
  // «1,000» / «1,000,000» без множителя — запятая разделяет тысячи; «2,5 млн» — десятичная.
  const base = !hasMult && /^\d{1,3}(?:,\d{3})+$/.test(n) ? Number(n.replace(/,/g, '')) : Number(n.replace(',', '.'));
  const mult = w.startsWith('млрд') || w.startsWith('миллиард')
    ? 1_000_000_000
    : w.startsWith('млн') || w.startsWith('миллион')
      ? 1_000_000
      : w.startsWith('тыс') || k
        ? 1_000
        : 1;
  return Math.round(base * mult);
}

/** После числа — не деньги: «потратил 2 часа», «получил 2 письма», «5 баллов». */
const NON_MONEY_UNIT =
  /^(?:час|минут|секунд|дн[яеи]|день|сут|недел|месяц|год|лет|км|кг|килограмм|раз|страниц|письм|балл|звонк|сообщени|шт|штук|попыт|очк|подписчик|лайк|комментари|задач|книг|слов|шаг)/i;
const HAS_CURRENCY = /(?:\d\s*(?:тенге|тг|₸|руб|р\.|\$|usd|€|eur)|(?:тенге|тг|₸)(?![а-яё]))/i;
/** Сумма похожа на деньги: не единица измерения после числа и не «5» без валюты. */
function looksLikeMoney(amount: number, rest: string, hasMult: boolean, text: string): boolean {
  if (NON_MONEY_UNIT.test(rest.trim())) return false;
  if (amount < 50 && !hasMult && !HAS_CURRENCY.test(text)) return false;
  return true;
}

export function detectMoneyIntent(text: string): MoneyIntent | null {
  let m = text.match(
    new RegExp(
      String.raw`^(?:[а-яё]+\s+){0,3}?(?:запиши\s+)?(?:доход|получил[аи]?|заработал[аи]?|пришла зарплата|зарплат[ауы]?|преми[яю])\s+(?:[а-яё]+\s+){0,2}?(?:на\s+)?` +
        AMOUNT +
        String.raw`\s*${CURRENCY}?\s*(?:от|за|—|-)?\s*(.*)$`,
      'i',
    ),
  );
  if (m) {
    const amount = parseAmount(m[1], m[2], m[3] ?? m[4]);
    if (amount > MAX_MONEY_AMOUNT) return null;
    if (!looksLikeMoney(amount, m[5] ?? '', !!(m[2] || m[3] || m[4]), text)) return null;
    // «выплатил зарплату 200000 Айгерим» — это расход, не доход: в мозг.
    if (/^(?:[а-яё]+\s+){0,3}?(?:вы|за|о)платил|отдал|перев[её]л/i.test(text) && !/^(?:получил|заработал|доход)/i.test(text)) return null;
    if (Number.isFinite(amount) && amount > 0) {
      // «получил зарплату 350000» — источник уже назван, не переспрашиваем.
      const source = cleanRest(m[5]) || (/зарплат/i.test(text) ? 'Зарплата' : /преми/i.test(text) ? 'Премия' : '');
      return source
        ? { action: 'add_income', amount, source }
        : { action: 'add_income', amount };
    }
  }
  m = text.match(
    new RegExp(
      String.raw`^(?:[а-яё]+\s+){0,3}?(?:запиши\s+)?(?:расход|потратил[аи]?|потрачено|трата|купил[аи]?\s+на)\s+(?:на\s+)?` +
        AMOUNT +
        String.raw`\s*${CURRENCY}?\s*(?:на|за|—|-)?\s*(.*)$`,
      'i',
    ),
  );
  if (m) {
    const amount = parseAmount(m[1], m[2], m[3] ?? m[4]);
    if (amount > MAX_MONEY_AMOUNT) return null;
    if (!looksLikeMoney(amount, m[5] ?? '', !!(m[2] || m[3] || m[4]), text)) return null;
    if (Number.isFinite(amount) && amount > 0) {
      const rest = cleanRest(m[5]);
      return rest
        ? { action: 'add_expense', amount, category: rest, description: rest }
        : { action: 'add_expense', amount };
    }
  }
  m = text.match(/^(\d[\d\s]{2,})\s*(?:тенге|тг|₸)?\s+на\s+(.+)$/i);
  if (m) {
    const amount = Number(m[1].replace(/\s/g, ''));
    if (amount > MAX_MONEY_AMOUNT) return null;
    if (Number.isFinite(amount) && amount > 0) {
      const rest = m[2].trim();
      return { action: 'add_expense', amount, category: rest, description: rest };
    }
  }
  return null;
}

/**
 * tz/now — пояс юзера и «сейчас» (инжект для тестов). «сегодня/завтра»
 * считаются в КАЛЕНДАРЕ юзера (civilDayRefs). Дефолт 'UTC' = прежнее поведение.
 */
// Робот-эпик, Часть 3: «покажи/открой X» → открыть панель приложения.
// Строгий шаблон: только глагол + (мне) (мои) + слово панели + необязательный
// хвост периода — вопросы и составные просьбы («покажи задачи … и перенеси»)
// не перехватываем, они идут в мозг.
const PANEL_WORDS: Array<[RegExp, string]> = [
  [/^(задачи|задач|дела|таски)$/, 'tasks'],
  [/^(привычки|привычек)$/, 'habits'],
  [/^(цели|целей)$/, 'goals'],
  [/^(финансы|расходы|траты|бюджет|деньги)$/, 'finance'],
  [/^(календарь|расписание|встречи|события)$/, 'calendar'],
  [/^(дневник)$/, 'journal'],
  [/^(сделки|сделок|воронку|воронка|продажи)$/, 'deals'],
  [/^(сегодня|день|сводку|главную)$/, 'today'],
];
const OPEN_PANEL_RE =
  /^(?:покажи|открой|открыть|выведи)(?:\s+мне)?(?:\s+(?:мои|мой|мою))?\s+([а-яё]+)(?:\s+(?:на\s+сегодня|на\s+неделю|за\s+неделю|за\s+месяц|на\s+месяц|на\s+завтра))?[.!]?$/i;

/**
 * disabledPanels — панели за выключенным флагом (сделки): их слова не
 * перехватываем, фраза идёт дальше как до фичи (ревью сделок I4).
 */
export interface IntentOptions {
  disabledPanels?: ReadonlySet<string>;
/** Модель для LLM-шага (замер Sonnet/Haiku); по умолчанию INTENT_MODEL. */
  model?: string;
}

export function detectOpenPanel(text: string, disabledPanels?: ReadonlySet<string>): string | null {
  const m = text.trim().match(OPEN_PANEL_RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  for (const [re, panel] of PANEL_WORDS) {
    if (re.test(word)) return disabledPanels?.has(panel) ? null : panel;
  }
  return null;
}

const HABIT_PREPS = /(?:^|\s)(?:в|во|для|на|по|с|со|про|у|к|ко|из|от|за)(?=\s)/i;
const NOT_HABIT_NOUN = /(задач|встреч|календар|сч[её]т|отч[её]т|банк|договор|письм|звон[ко]|проект|сделк)/i;
/** «бег», «зарядку и чтение» — короткое имя привычки (≤3 слов на каждую). */
export function isHabitShorthand(rest: string): boolean {
  const r = rest.trim();
  if (HABIT_PREPS.test(` ${r} `) || NOT_HABIT_NOUN.test(r)) return false;
  return r.split(/\s+и\s+|,|\+/).every((part) => part.trim().split(/\s+/).filter(Boolean).length <= 3);
}

export function deterministicIntent(
  text: string,
  tz: string = 'UTC',
  now: Date = new Date(),
  opts: IntentOptions = {},
): VoiceIntent | null {
  const lower = text.toLowerCase();

  const panel = detectOpenPanel(text, opts.disabledPanels);
  if (panel) return { action: 'open_panel', panel };
  // Чек с фото: мозг фото из чата не видит — открываем камеру приложения.
  // С суммой («добавь чек на 5000») — это трата словами, камера не нужна (ревью).
  if (!/\d/.test(text) && RECEIPT_TRIGGERS.some((re) => re.test(text.trim()))) return { action: 'open_panel', panel: 'receipt' };

  for (const re of DICTATION_TRIGGERS) {
    if (re.test(text)) return { action: 'start_dictation' };
  }
  // «помнишь про отчёт? поставь задачу» — это действие, не поиск в памяти.
  const memoryAction = /(?:^|[^а-яё])(?:поставь|создай|добавь|запиши|перенеси|отметь|удали|напомни|закинь|внеси)/i.test(text);
  for (const re of memoryAction ? [] : MEMORY_TRIGGERS) {
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
    /(?:^|[^а-яё])(слетать|слетаю|полететь|полечу|полетим|поехать|поедем|съездить|съезжу|едем в|лечу в|хочу слетать|хочу поехать|хочу съездить|надо слетать|надо съездить|собираюсь в|планирую слетать|планирую поехать|планирую съездить|планирую поездку|спланируй поездку)(?=\s|$|[,.!?])/i;
  // Прод 2026-11-08: «Задача на завтра поехать узнать насчёт работы … и встреча
  // в 14:00» уходило в подбор билетов («Куда летим/едем?»). Дела/задачи/встречи
  // — не поездка; голое «поехать/съездить» — поездка, только если дальше
  // направление («в Астану», «на море») или travel-сущность (билет, отель…).
  const taskFrame = TASK_FRAME.test(lower);
  const motionOk = !BARE_MOTION.test(lower) || MOTION_WITH_DIRECTION.test(lower) || TRAVEL_NOUNS.test(text);
  if (!taskFrame && STRONG_TRAVEL.test(lower) && motionOk) {
    return { action: 'plan_travel', query: text };
  }
  // Слабые глаголы: нужна travel-сущность чтобы не путать
  // ("закажи такси" ок, но "закажи пиццу" — нет).
  for (const v of TRAVEL_VERBS) {
    if (!taskFrame && hasPhrase(lower, v) && TRAVEL_NOUNS.test(text)) {
      return { action: 'plan_travel', query: text };
    }
  }
  // Booking-глагол + travel-сущность в ЛЮБОМ порядке/со словами между
  // (тест выявил дыру: «найди МНЕ отель» мимо точных пар TRAVEL_VERBS).
  // NOUN-гард тот же — «купи продукты»/«закажи пиццу» НЕ travel.
  const BOOK_VERB =
    /(?:^|\s)(?:забронир[а-яё]*|закаж[а-яё]*|заказать|купи[а-яё]*|купить|найд[а-яё]*|подбер[а-яё]*|нужн[а-яё]*|возьми|оформ[а-яё]*)(?=\s|$|[,.!?])/i;
  if (!taskFrame && BOOK_VERB.test(lower) && BOOKING_NOUNS.test(text)) {
    return { action: 'plan_travel', query: text };
  }

  // ── Детерминированные исполняемые действия ───────────────────────────
  // Claude в intent-parser ненадёжно классифицирует эти частые команды
  // (возвращает unknown) — та же беда что была с plan_travel. Регекс
  // надёжнее, 0мс, 0$. Извлекаем параметры прямо здесь.

  // send_telegram: "отправь/напиши/пришли (мне) в телеграм <текст>".
  // Реальная исходящая отправка себе — пойдёт через подтверждение.
  const tgM = text.match(
    /^(?:отправь|напиши|пришли|скинь|кинь)\s+(?:мне\s+)?(?:в\s+)?(?:телеграм|telegram|тг)\s*:?\s*(.+)$/i,
  );
  if (tgM) {
    const msg = tgM[1].trim();
    if (msg) return { action: 'send_telegram', text: msg };
  }

  // SSOT Step 6 (ОТКАТ удаления, доказан тестом): детерминированный
  // money-prefilter ВОЗВРАЩЁН. Удаление regex (надежда на Claude
  // parseIntent) эмпирически провалилось: «Запиши расход 88888 …
  // Kaspi» → Claude НЕ классифицировал → чат-агент (без money-tool)
  // ВЫДУМАЛ «записан», в БД 0 строк (баг #1 регресс). Решение по
  // тесту: ловим деньги детерминированно ЗДЕСЬ → intent add_expense/
  // add_income → оркестратор → РЕЕСТР (needsConfirm:true) →
  // подтверждение → аудируемая запись. Чат-агент денег не видит.

  // SSOT Step 6 + #189: деньги — через чистый detectMoneyIntent
  // (расширенный детект «я потратил…», без 'other'-дефолта). Чат-агент
  // денег не видит → не сочиняет запись.
  // Аудит 2026-11-09: «вчера потратил 12000» писалось сегодня (1-го числа — уже
  // другой месяц); «потратил 5000 на такси и 3000 на кофе» — одна трата 5000
  // с категорией «такси и 3000 на кофе». Вторая сумма — мозгу (две записи),
  // «вчера/позавчера» — датой траты.
  const dayWord = text.match(/(?:^|\s)(позавчера|вчера)(?=$|[\s,.!])/i);
  const money = detectMoneyIntent(dayWord ? text.replace(dayWord[0], ' ').replace(/\s{2,}/g, ' ').trim() : text);
  if (money) {
    const rest = money.action === 'add_expense' ? (money.category ?? '') : (money.source ?? '');
    if (/\d/.test(rest) && /(?:^|\s)(?:и|ещё|еще|плюс|а)\s|,/.test(rest)) return null;
    if (dayWord) {
      // Доход задним числом инструмент не пишет — пусть решает мозг, а не «сегодня».
      if (money.action !== 'add_expense') return null;
      const { today } = civilDayRefs(tz, now);
      return { ...money, date: addCivilDays(today, /позавчера/i.test(dayWord[1]) ? -2 : -1) };
    }
    return money;
  }

  let m: RegExpMatchArray | null = null;

  // complete_task: "закрой/заверши/закончи/выполни задачу X", "отметь
  // задачу X". ISSUE-5: раньше «закрой задачу отчёт» ловилось
  // complete_habit-регексом ниже как привычка «задачу отчёт» →
  // "Привычка не найдена". Слово «задачу» обязательно и проверяется
  // ПЕРВЫМ, чтобы не пересекаться с привычками и с create_task
  // (там глаголы созда/добавь/поставь).
  m = text.match(
    /^(?:закрой|заверши(?:ть)?|законч(?:и|ить)|выполни(?:л[аи]?|ть)?|отметь)\s+задачу\s+(.+)$/i,
  );
  if (m) {
    return { action: 'complete_task', taskTitle: m[1].trim() };
  }

  // complete_habit: "отметь привычку бег", "отметь бег", "выполнил чтение",
  // "сделал зарядку" (одна привычка)
  // «сделал зарядку вчера» — отметка за вчера (раньше — сегодня с «отмечена ✅»).
  const habitDay = text.match(/(?:^|\s)(позавчера|вчера)(?=$|[\s,.!])/i);
  const habitText = habitDay ? text.replace(habitDay[0], ' ').replace(/\s{2,}/g, ' ').trim() : text;
  const habitDate = habitDay ? addCivilDays(civilDayRefs(tz, now).today, /позавчера/i.test(habitDay[1]) ? -2 : -1) : null;
  m = habitText.match(/^(?:отметь|выполнил[аи]?|сделал[аи]?|закрой)\s+(?:привычку\s+)?(.+)$/i);
  // Только короткое «отметь бег / сделал зарядку и чтение». «сделал отчёт для
  // банка», «закрой счёт в банке», «отметь в календаре встречу» — не привычки:
  // пусть решает модель (2026-11-09).
  if (m && !isHabitShorthand(m[1])) m = null;
  if (m) {
    const rest = m[1].trim();
    // несколько через "и"/","/"+" → complete_multiple_habits
    if (/\s+и\s+|,|\+/.test(rest)) {
      const habitNames = rest
        .split(/\s+и\s+|,|\+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (habitNames.length > 1) {
        return { action: 'complete_multiple_habits', habitNames, ...(habitDate ? { date: habitDate } : {}) } as VoiceIntent;
      }
    }
    return { action: 'complete_habit', habitName: rest, ...(habitDate ? { date: habitDate } : {}) } as VoiceIntent;
  }

  // create_task: "создай задачу купить хлеб завтра", "добавь задачу X",
  // "напомни купить молоко"
  // НО: рефлексивный вопрос ("Напомни кого ты помнишь?", "Напомни что ты знаешь")
  // — это запрос к памяти, НЕ создание задачи. Поэтому отсеиваем по двум
  // признакам: (а) текст заканчивается на "?", (б) после "напомни"
  // идёт вопросительное "кого/что/какие/кто/какой ты помнишь/знаешь/...".
  // Прецедент 2026-05-30: бот создал task "кого ты помнишь из моих знакомых?"
  // вместо ответа из v2 памяти. Fix F3 закрывает эту дыру.
  m = text.match(/^(?:созда[йять]+|добавь|поставь)\s+задачу\s+(.+)$/i) ||
      text.match(/^напомни(?:ть)?\s+(?:мне\s+)?(.+)$/i);
  if (m) {
    const title = m[1].trim();
    const isReflectiveMemoryQuery =
      title.endsWith('?') ||
      /^(?:кого|что|какие|кто|какой|какая|какое|сколько)\s+(?:ты|вы)\s+(?:помнишь|помните|знаешь|знаете|можешь|можете)/i.test(title) ||
      // «напомни, что у меня завтра», «напомни какие задачи на неделю» — вопрос,
      // а не новое дело (2026-11-09).
      /^[,\s]*(?:что|какие|какой|какая|какое|когда|где|сколько|кто|как|о\s+ч[её]м|про\s+что)(?![а-яё])/i.test(title);
    if (isReflectiveMemoryQuery) {
      // Пропускаем create_task — это запрос к памяти, пусть идёт в LLM.
      m = null;
    }
  }
  if (m) {
    const title = m[1].trim();
    const days = civilDayRefs(tz, now);
    // Аудит 2026-11-09: день недели / «20 ноября» / «через 2 дня» / «в 15:00».
    // Названо, но не бывает («31 ноября», «в 25:00», «вчера») — решает мозг.
    const when = parseRuWhen(title, days.today);
    if (when.invalid) return null;
    return {
      action: 'create_task',
      title: when.rest || title,
      date: when.date,
      ...(when.time ? { time: when.time } : {}),
      category: 'personal',
      priority: 'medium',
    };
  }

  return null;
}

/**
 * Модель разбора намерений. По умолчанию Haiku (этап 6: второй вызов модели на
 * каждое сообщение — быстрее и дешевле Sonnet). Откат без кода: в Railway
 * INTENT_MODEL=sonnet. Замер точности: scripts/intent-eval.ts.
 */
export const INTENT_MODEL: string =
  process.env.INTENT_MODEL === 'sonnet' ? MODELS.sonnet : process.env.INTENT_MODEL === 'haiku' || !process.env.INTENT_MODEL ? MODELS.haiku : process.env.INTENT_MODEL;

/** JSON из ответа модели: голый объект, в ```json-обёртке или с текстом вокруг. */
export function parseIntentJson(raw: string): VoiceIntent | null {
  const t = raw.trim();
  const candidates = [t, t.replace(/^```(?:json)?\s*|\s*```$/g, '')];
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) candidates.push(t.slice(s, e + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as VoiceIntent;
      if (v && typeof v === 'object' && typeof v.action === 'string') return v;
    } catch {
      /* следующий вариант */
    }
  }
  return null;
}

export async function parseIntent(
  text: string,
  tz: string = 'UTC',
  now: Date = new Date(),
  opts: IntentOptions = {},
): Promise<VoiceIntent> {
  // Fast path: детерминированные интенты без вызова Claude.
  const det = deterministicIntent(text, tz, now, opts);
  if (det) return det;

  // Даты для Claude — в календаре юзера (intent-TZ фикс), не UTC сервера.
  const days = civilDayRefs(tz, now);

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

Текущая дата: ${days.today}. "завтра" = ${days.tomorrow}, "послезавтра" = ${days.dayAfter}.
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

  try {
    const response = await anthropic.messages.create({
      // Этап 6: Haiku вместо Sonnet — второй вызов модели на КАЖДОЕ сообщение;
      // быстрее и дешевле. Замер на 30 фразах — в коммите. opts.model — для замера.
      model: opts.model ?? INTENT_MODEL,
      max_tokens: 256,
      // Кэш: промпт парсера одинаков весь день (меняются только даты).
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: text }],
    }, QUICK_CALL);

    const content = response.content[0];
    if (content.type !== 'text') {
      return { action: 'unknown', text };
    }

    const parsed = parseIntentJson(content.text);
    return parsed ?? { action: 'unknown', text: content.text };
  } catch (err) {
    // C1 (AUDIT-2026-06): Claude недоступен / таймаут / rate-limit на шаге
    // разбора интента. НЕ роняем весь чат в 500 — откатываемся на free-form
    // 'unknown'. Orchestrator уведёт это в agent-путь, у которого есть своя
    // лестница деградации (честный «сбой на моей стороне» вместо краша).
    console.warn(
      '[parseIntent] LLM call failed, degrading to unknown:',
      err instanceof Error ? err.message : err,
    );
    return { action: 'unknown', text };
  }
}
