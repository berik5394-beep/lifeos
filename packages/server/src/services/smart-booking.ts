import Anthropic from '@anthropic-ai/sdk';
import { AiModelError } from '../lib/errors.js';

/**
 * Smart Booking — JARVIS-style: юзер говорит "забронируй рейс в Астану на
 * завтра", мы парсим намерение через Claude, строим deeplink на сайт-агрегатор
 * (Aviasales / Yandex Taxi / Booking) с предзаполнением, и озвучиваем умный
 * контекст ("прилетишь в 12:30, успеешь до встречи в 14:00").
 *
 * Партнёрки нет пока — модель честная: даём ссылку, юзер бронирует там.
 * Когда подключим affiliate API, заменим URL builder, остальное не меняем.
 */

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

export type BookingType = 'flight' | 'taxi' | 'hotel' | 'unknown';

export interface BookingIntent {
  type: BookingType;
  // Авиа
  fromCity?: string;        // "Алматы"
  fromCode?: string;        // "ALA" (IATA)
  toCity?: string;          // "Астана"
  toCode?: string;          // "NQZ"
  departDate?: string;      // YYYY-MM-DD
  returnDate?: string;      // YYYY-MM-DD
  passengers?: number;
  // Такси
  fromAddress?: string;
  toAddress?: string;
  taxiClass?: 'econom' | 'comfort' | 'business';
  // Отель
  city?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  // Общее
  confidence: number;       // 0-1
  rawText: string;          // что распарсили
  reasoning?: string;       // короткое почему так распознали (для debugging)
}

export async function parseBookingIntent(
  text: string,
  todayIso: string,
): Promise<BookingIntent> {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const dayAfter = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const systemPrompt = `Ты — парсер запросов на бронирование (рейсы / такси / отели) для приложения LifeOS. Юзер говорит на русском. Извлеки структурированные параметры и верни ТОЛЬКО валидный JSON.

Текущая дата: ${todayIso}. "завтра" = ${tomorrow}, "послезавтра" = ${dayAfter}.

Формат JSON:
{
  "type": "flight" | "taxi" | "hotel" | "unknown",
  "fromCity": "...", "fromCode": "IATA",   // для flight
  "toCity": "...", "toCode": "IATA",       // для flight
  "departDate": "YYYY-MM-DD",              // для flight
  "returnDate": "YYYY-MM-DD",              // опц
  "passengers": N,                          // по умолчанию 1
  "fromAddress": "...",                    // для taxi
  "toAddress": "...",                      // для taxi
  "taxiClass": "econom" | "comfort" | "business",
  "city": "...",                           // для hotel
  "checkIn": "YYYY-MM-DD",                 // для hotel
  "checkOut": "YYYY-MM-DD",                // для hotel
  "guests": N,                              // для hotel, по умолчанию 1
  "confidence": 0.0-1.0,
  "reasoning": "1 предложение почему распознал так"
}

IATA коды городов Казахстана и СНГ:
- Алматы → ALA, Астана/Нур-Султан → NQZ, Шымкент → CIT, Караганда → KGF, Атырау → GUW
- Москва → MOW, Санкт-Петербург → LED, Сочи → AER, Екатеринбург → SVX, Казань → KZN, Новосибирск → OVB
- Бишкек → FRU, Ташкент → TAS, Самарканд → SKD, Душанбе → DYU, Тбилиси → TBS, Ереван → EVN, Баку → GYD
- Стамбул → IST, Дубай → DXB, Анталья → AYT, Бангкок → BKK, Пхукет → HKT
- Если не уверен — оставь fromCode/toCode пустыми, но fromCity/toCity заполни.

Правила:
1. **Откуда** — если не указано, считай Алматы (ALA). Юзер скорее всего из Казахстана.
2. **Когда** — "завтра" / "в субботу" / "через неделю" разрешай в YYYY-MM-DD относительно текущей даты.
3. **Тип**:
   - "рейс" / "билет" / "самолёт" / "полёт" → flight
   - "такси" / "доехать до" / "вызови машину" / "поедем" → taxi
   - "отель" / "забронируй гостиницу" / "номер на N ночей" → hotel
   - Если непонятно → unknown
4. **confidence**: 0.9+ если всё чётко, 0.5-0.8 если часть угадал, <0.5 если очень неуверен.
5. **reasoning**: 1 предложение что было ключом ("сказал 'в Астану на завтра' → flight ALA→NQZ").`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }

  let json = content.text.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(json) as Omit<BookingIntent, 'rawText'>;
    return { ...parsed, rawText: text };
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Строит deeplink на сайт-агрегатор. URL-only, без партнёрки — пока юзер
 * сам подтверждает покупку на сайте партнёра. Когда подключим affiliate,
 * добавим referral-параметры; интерфейс не меняется.
 */
export function buildBookingUrl(intent: BookingIntent): string | null {
  switch (intent.type) {
    case 'flight':
      return buildFlightUrl(intent);
    case 'taxi':
      return buildTaxiUrl(intent);
    case 'hotel':
      return buildHotelUrl(intent);
    default:
      return null;
  }
}

function buildFlightUrl(i: BookingIntent): string | null {
  // Aviasales format: /search/{ORIGIN}{DDMM}{DEST}{RDDMM}{N}
  //   ORIGIN/DEST — 3-letter IATA
  //   DDMM — день+месяц (без года; сервис подставляет ближайший)
  //   RDDMM — обратный (опционально)
  //   N — количество пассажиров (1 по умолчанию)
  const from = (i.fromCode || 'ALA').toUpperCase();
  const to = (i.toCode || '').toUpperCase();
  if (!to) {
    // Без IATA назначения — отдаём общий поиск, юзер уточнит
    return `https://www.aviasales.kz/?marker=lifeos&origin=${from}`;
  }
  if (!i.departDate) {
    return `https://www.aviasales.kz/search?origin_iata=${from}&destination_iata=${to}`;
  }
  const ddmm = i.departDate.slice(8, 10) + i.departDate.slice(5, 7); // YYYY-MM-DD → DDMM
  const rddmm = i.returnDate
    ? i.returnDate.slice(8, 10) + i.returnDate.slice(5, 7)
    : '';
  const passengers = i.passengers ?? 1;
  return `https://www.aviasales.kz/search/${from}${ddmm}${to}${rddmm}${passengers}`;
}

function buildTaxiUrl(i: BookingIntent): string {
  // Yandex Taxi web deeplink — принимает строковые адреса, можно открыть
  // как https-ссылку, на телефоне сама перехватит в приложение через
  // Universal Link.
  const params = new URLSearchParams();
  if (i.fromAddress) params.set('gfrom', i.fromAddress);
  if (i.toAddress) params.set('gto', i.toAddress);
  if (i.taxiClass) params.set('class', i.taxiClass);
  params.set('ref', 'lifeos');
  return `https://taxi.yandex.kz/?${params.toString()}`;
}

function buildHotelUrl(i: BookingIntent): string {
  // Booking.com — без партнёрки. Поля: ss (search string), checkin/checkout, group_adults
  const params = new URLSearchParams();
  if (i.city) params.set('ss', i.city);
  if (i.checkIn) params.set('checkin', i.checkIn);
  if (i.checkOut) params.set('checkout', i.checkOut);
  params.set('group_adults', String(i.guests ?? 1));
  params.set('group_children', '0');
  params.set('no_rooms', '1');
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/**
 * Контекстно-зависимая озвучка — что JARVIS говорит юзеру голосом.
 * Учитывает события юзера в день бронирования: успеет ли он на встречу,
 * не пересечётся ли с другой задачей, есть ли резерв на сборы.
 */
export interface BookingContext {
  userName: string;
  /** События юзера в день/диапазон бронирования */
  eventsOnDate: { title: string; date: string; startTime: string | null }[];
  /** Есть ли вообще память о городе назначения (был ли уже) */
  destinationKnown: boolean;
}

/**
 * Агентное бронирование: JARVIS реально ИЩЕТ в интернете актуальные цены
 * (web search), даёт ссылку с предзаполнением, и — главное — задаёт
 * уточняющие вопросы как настоящий ассистент (обратный билет? отель?
 * такси?). Это не "блокнот", а помощник который ведёт диалог.
 */
export async function narrateBooking(
  intent: BookingIntent,
  context: BookingContext,
  bookingUrl: string | null,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  if (intent.type === 'unknown' || intent.confidence < 0.4) {
    return 'Куда летим/едем и когда? Скажи город и примерные даты — дальше я всё подберу.';
  }

  const dest = intent.toCity || intent.city || 'место';
  const route = `${intent.fromCity || 'Алматы'}–${dest}`;

  const systemPrompt = `Ты — JARVIS, личный travel-консьерж пользователя ${context.userName}. Не поисковик и не блокнот. Ты ВЕДЁШЬ человека к забронированной поездке: спрашиваешь нужное, ищешь лучшее под бюджет, советуешь конкретное, даёшь рабочие ссылки.

КОНТЕКСТ РАЗГОВОРА: тебе передана история диалога. Если юзер раньше называл бюджет/даты/предпочтения — НЕ переспрашивай, используй. Продолжай тот же план поездки, а не начинай заново.

ТВОЙ АЛГОРИТМ:

1. **Сезон/направление — ПРЕДУПРЕЖДАЙ ПЕРВЫМ.** Через web_search проверь погоду/сезон на даты в этом направлении. Если это низкий/дождливый/неудачный сезон — СКАЖИ СРАЗУ, до цен, и предложи 1-2 альтернативы (другой регион/соседняя страна) с обоснованием. Не молчи о плохом сезоне ради позитива.

2. **Уточни критичное или прими ЯВНЫЕ допущения.** Убедись или озвучь допущением: аэропорт вылета (Алматы/Астана/Шымкент?), тип отдыха (пляж/тусовка/экскурсии/семья), кто летит, загранпаспорт действует 6+ мес после возврата, виза (для KZ часто визфри ≤30 дн — но «подтверди на сайте посольства», не как факт), страховка (без неё в Азию не лететь). Не допрос списком — 1-2 ключевых вопроса, остальное прими и напиши «считаю, что…, поправь если нет».

3. **Бюджет.** Не назван — спроси одной фразой + 1 ориентир. Назван — держись его.

4. **Конкретика через web_search.** 2-3 реальных варианта (авиакомпания/отель + цена + почему), не «от X». Назови источник (сайт/ссылку конкретного предложения) — юзер должен проверить. Обязательно web_search, не по памяти.

5. **Советуй, а не перечисляй.** ОДИН лучший под бюджет + объясни цена/качество.

6. **План день-в-день** (если поездка осмысленная): короткий ориентир по дням (прилёт+трансфер с ценой → активности с ценами если web_search дал → выезд). Помечай «ориентировочно».

7. **Ссылки = действие.** «Ссылку с забитыми параметрами кину ниже». Нашёл прямой сайт/контакт — назови.

8. **Расписание:** ${
    context.eventsOnDate.length > 0
      ? `в день поездки — ${context.eventsOnDate.map((e) => `${e.title}${e.startTime ? ' в ' + e.startTime : ''}`).join(', ')}. Время с запасом.`
      : 'событий в этот день нет.'
  }

9. **Один вопрос за раз** в конце — двигай к завершению («вот лучшее под бюджет, бронируй здесь; план и напоминания я уже завёл»).

ВАЛЮТА — КРИТИЧНО: юзер из Казахстана. ВСЕ цены ТОЛЬКО в тенге (₸). web_search часто даёт рубли с рос. сайтов — пересчитай по АКТУАЛЬНОМУ курсу (узнай текущий ₽→₸ через web_search, НЕ по фиксированному числу) и покажи ТОЛЬКО тенге. НИКОГДА не пиши «₽»/«рублей»/«руб» даже в скобках. Рубли — только если поездка в Россию И юзер сам спросил.

Тон: тёплый, уверенный, как друг-турагент, единый характер (не скакать официальное↔фамильярное). Живая речь, без markdown/буллетов/JSON. До 8 предложений если поездка большая (сезон+вариант+день-в-день+вопрос) — но без воды.`;

  const ctx = [
    `Тип: ${intent.type}`,
    intent.fromCity ? `Откуда: ${intent.fromCity}` : null,
    intent.toCity || intent.city ? `Куда: ${intent.toCity || intent.city}` : null,
    intent.departDate ? `Дата вылета/выезда: ${intent.departDate}` : null,
    intent.returnDate ? `Обратно: ${intent.returnDate}` : null,
    intent.checkIn ? `Заезд: ${intent.checkIn}` : null,
    intent.checkOut ? `Выезд: ${intent.checkOut}` : null,
    intent.passengers ? `Пассажиров: ${intent.passengers}` : null,
    context.eventsOnDate.length > 0
      ? `События в день поездки: ${context.eventsOnDate
          .map((e) => `${e.title}${e.startTime ? ' в ' + e.startTime : ''}`)
          .join(', ')}`
      : 'Событий в день поездки нет.',
    context.destinationKnown ? 'Юзер уже бывал в этом месте.' : null,
    bookingUrl ? `Ссылка на поиск (НЕ цитируй её, система добавит сама): ${bookingUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const { runAgent } = await import('./claude-agent.js');
    return await runAgent({
      system: systemPrompt,
      userMessage: `Запрос: "${intent.rawText}"\n\nКонтекст:\n${ctx}`,
      history,
      webSearch: true,
      maxSearches: 4,
      // Концьерж теперь даёт сезон+вариант+день-в-день+вопрос —
      // 700 обрезало. Больше места (claude-agent всё равно
      // подстрахует обрезкой по границе предложения).
      maxTokens: 1100,
    });
  } catch {
    // Если web search/Claude упал — не падаем целиком, даём базовый ответ.
    return `Окей, ищу варианты по ${route}${intent.departDate ? ` на ${intent.departDate}` : ''}. Какой бюджет — подберу лучшее под него. Ссылка ниже.`;
  }
}
