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
): Promise<string> {
  if (intent.type === 'unknown' || intent.confidence < 0.4) {
    return 'Не до конца понял — куда и когда летим/едем? Скажи город и дату.';
  }

  const systemPrompt = `Ты — JARVIS, личный ассистент пользователя ${context.userName}. Не блокнот, а помощник который ДЕЙСТВУЕТ и ДУМАЕТ наперёд.

Юзер попросил помочь с поездкой/бронированием. Твоя задача:

1. **НАЙДИ в интернете** актуальную цену через web search (цена ${intent.type === 'flight' ? 'авиабилета' : intent.type === 'hotel' ? 'отеля' : 'поездки'}). Используй web_search — это ОБЯЗАТЕЛЬНО, не отвечай по памяти.
2. Дай конкретный ориентир по цене ("прямые рейсы ${intent.fromCity || ''}–${intent.toCity || intent.city || ''} сейчас от X тенге, утренние дороже").
3. Учти расписание юзера: ${
    context.eventsOnDate.length > 0
      ? `в день поездки есть — ${context.eventsOnDate.map((e) => `${e.title}${e.startTime ? ' в ' + e.startTime : ''}`).join(', ')}. Порекомендуй рейс/время с учётом этого (успеть/не опоздать).`
      : 'событий в этот день нет.'
  }
4. **ЗАДАЙ уточняющие вопросы** как настоящий ассистент (выбери релевантные):
   - Для рейса: "Обратный билет нужен — когда летишь назад?", "Бронируем отель в ${intent.toCity || intent.city || 'городе'}?", "Такси до аэропорта заказать?"
   - Для отеля: "На сколько ночей?", "Бюджет на ночь?", "Ближе к центру или к месту встречи?"
   - Для такси: "Когда подавать машину?", "Эконом или комфорт?"
5. Ссылку на поиск НЕ вставляй в текст сам — система добавит её отдельно. Можешь сослаться "по ссылке ниже посмотри варианты".

Тон: тёплый, по-человечески, как друг который реально помогает. 3-6 предложений. Без markdown, без JSON, без списков-буллетов — живая речь.`;

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
      webSearch: true,
      maxSearches: 3,
      maxTokens: 700,
    });
  } catch {
    // Если web search/Claude упал — не падаем целиком, даём базовый ответ.
    const dest = intent.toCity || intent.city || 'туда';
    return `Окей, ищу варианты ${dest}${intent.departDate ? ` на ${intent.departDate}` : ''}. Глянь по ссылке ниже. Обратный билет нужен? Отель бронируем?`;
  }
}
