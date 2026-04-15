/**
 * External APIs for JARVIS — flights, routes, weather, currency.
 * All keys come from .env — if missing, returns mock data.
 *
 * All fetch() calls use fetchWithTimeout to prevent hanging requests
 * from tying up the event loop when upstream services are slow/down.
 */

import { logger } from '../lib/logger.js';

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Fetch wrapper with a hard timeout. If the upstream doesn't respond within
 * `timeoutMs`, the request is aborted and AbortError is thrown.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ── City → IATA mapping (KZ cities focus) ──
const CITY_IATA: Record<string, string> = {
  'астана': 'NQZ', 'нур-султан': 'NQZ', 'алматы': 'ALA', 'шымкент': 'CIT',
  'караганда': 'KGF', 'актау': 'SCO', 'атырау': 'GUW', 'павлодар': 'PWQ',
  'стамбул': 'IST', 'анталья': 'AYT', 'москва': 'MOW', 'санкт-петербург': 'LED',
  'дубай': 'DXB', 'бангкок': 'BKK', 'бали': 'DPS', 'пхукет': 'HKT',
  'тбилиси': 'TBS', 'батуми': 'BUS', 'бишкек': 'FRU', 'ташкент': 'TAS',
  'лондон': 'LON', 'париж': 'PAR', 'нью-йорк': 'NYC', 'токио': 'TYO',
};

function resolveIATA(city: string): string {
  return CITY_IATA[city.toLowerCase().trim()] || city.toUpperCase();
}

// ── Flights (Aviasales / Travelpayouts) ──
export async function searchFlights(params: {
  from: string; to: string; departDate: string; returnDate?: string; passengers?: number;
}): Promise<Array<{ airline: string; price: number; currency: string; departure: string; duration: string; stops: number; link: string }>> {
  const token = process.env.AVIASALES_API_TOKEN;
  const origin = resolveIATA(params.from);
  const destination = resolveIATA(params.to);

  if (!token) {
    // Mock data when no API key
    return [
      { airline: 'Air Astana', price: 85000, currency: 'KZT', departure: `${params.departDate} 06:00`, duration: '4ч 30м', stops: 0, link: '#' },
      { airline: 'FlyArystan', price: 52000, currency: 'KZT', departure: `${params.departDate} 14:00`, duration: '5ч 00м', stops: 1, link: '#' },
      { airline: 'Turkish Airlines', price: 110000, currency: 'KZT', departure: `${params.departDate} 22:00`, duration: '4ч 00м', stops: 0, link: '#' },
    ];
  }

  try {
    const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${destination}&departure_at=${params.departDate}${params.returnDate ? '&return_at=' + params.returnDate : ''}&sorting=price&limit=5&token=${token}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json() as { data?: Array<{ airline: string; price: number; departure_at: string; duration: number; transfers: number; link: string }> };

    return (data.data || []).slice(0, 5).map((f) => ({
      airline: f.airline || 'Unknown',
      price: f.price,
      currency: 'KZT',
      departure: f.departure_at,
      duration: `${Math.floor(f.duration / 60)}ч ${f.duration % 60}м`,
      stops: f.transfers,
      link: `https://www.aviasales.ru${f.link}`,
    }));
  } catch (err) {
    console.error('Aviasales API error:', err);
    return [];
  }
}

// ── Routes (Google Maps deep link + optional Directions API) ──
export async function buildRoute(params: {
  from: string; to: string; mode?: string;
}): Promise<{ distance: string; duration: string; durationMinutes: number; steps: string[]; link: string; message: string }> {
  const mode = params.mode || 'driving';
  const link = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&travelmode=${mode}`;
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return {
      distance: '~15 км',
      duration: '~25 мин',
      durationMinutes: 25,
      steps: [],
      link,
      message: `Маршрут ${params.from} → ${params.to}. Открой ссылку для навигации: ${link}`,
    };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&mode=${mode}&language=ru&key=${key}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json() as { routes: Array<{ legs: Array<{ distance: { text: string }; duration: { text: string; value: number }; steps: Array<{ html_instructions: string }> }> }> };

    if (!data.routes?.length) {
      return { distance: 'неизвестно', duration: 'неизвестно', durationMinutes: 0, steps: [], link, message: `Маршрут ${params.from} → ${params.to}. Открой ссылку для навигации: ${link}` };
    }

    const leg = data.routes[0].legs[0];
    return {
      distance: leg.distance.text,
      duration: leg.duration.text,
      durationMinutes: Math.round(leg.duration.value / 60),
      steps: leg.steps.map((s) => s.html_instructions.replace(/<[^>]*>/g, '')).slice(0, 5),
      link,
      message: `Маршрут ${params.from} → ${params.to} (${leg.distance.text}, ${leg.duration.text}). Навигация: ${link}`,
    };
  } catch (err) {
    console.error('Google Maps API error:', err);
    return { distance: 'ошибка', duration: 'ошибка', durationMinutes: 0, steps: [], link, message: `Маршрут ${params.from} → ${params.to}. Открой ссылку для навигации: ${link}` };
  }
}

// ── Weather (Open-Meteo — free, no API key) ──

/** Known city coordinates for Open-Meteo geocoding fallback */
const CITY_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  'алматы':    { lat: 43.24, lon: 76.95, name: 'Алматы' },
  'almaty':    { lat: 43.24, lon: 76.95, name: 'Алматы' },
  'астана':    { lat: 51.17, lon: 71.43, name: 'Астана' },
  'astana':    { lat: 51.17, lon: 71.43, name: 'Астана' },
  'нур-султан': { lat: 51.17, lon: 71.43, name: 'Астана' },
  'шымкент':   { lat: 42.32, lon: 69.60, name: 'Шымкент' },
  'караганда': { lat: 49.80, lon: 73.10, name: 'Караганда' },
  'москва':    { lat: 55.75, lon: 37.62, name: 'Москва' },
  'moscow':    { lat: 55.75, lon: 37.62, name: 'Москва' },
  'стамбул':   { lat: 41.01, lon: 28.98, name: 'Стамбул' },
  'istanbul':  { lat: 41.01, lon: 28.98, name: 'Стамбул' },
  'дубай':     { lat: 25.28, lon: 55.30, name: 'Дубай' },
  'dubai':     { lat: 25.28, lon: 55.30, name: 'Дубай' },
};

/** Map WMO weather codes to Russian descriptions */
function wmoToDescription(code: number): string {
  const map: Record<number, string> = {
    0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно',
    45: 'туман', 48: 'туман с инеем',
    51: 'лёгкая морось', 53: 'морось', 55: 'сильная морось',
    61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь',
    66: 'ледяной дождь', 67: 'сильный ледяной дождь',
    71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа',
    80: 'небольшой ливень', 81: 'ливень', 82: 'сильный ливень',
    85: 'небольшой снегопад', 86: 'сильный снегопад',
    95: 'гроза', 96: 'гроза с градом', 99: 'гроза с сильным градом',
  };
  return map[code] ?? 'неизвестно';
}

/** Day-of-week in Russian */
function dayOfWeekRu(dateStr: string): string {
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  return days[new Date(dateStr).getDay()] ?? '';
}

async function resolveCoords(city: string): Promise<{ lat: number; lon: number; name: string }> {
  const key = city.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];

  // Try Open-Meteo geocoding API
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`;
    const res = await fetchWithTimeout(url);
    const data = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> };
    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      return { lat: r.latitude, lon: r.longitude, name: r.name };
    }
  } catch {
    // fall through to default
  }

  // Default: Almaty
  return { lat: 43.24, lon: 76.95, name: city };
}

interface OpenMeteoResponse {
  current_weather: {
    temperature: number;
    windspeed: number;
    weathercode: number;
    is_day: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

export async function getWeather(city: string): Promise<{
  temp: number;
  feelsLike: number;
  description: string;
  humidity: number;
  wind: number;
  forecast: string;
  cityName: string;
}> {
  try {
    const coords = await resolveCoords(city);

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current_weather=true` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=3`;

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json() as OpenMeteoResponse;

    const cw = data.current_weather;
    const daily = data.daily;

    // Build 3-day forecast string in Russian
    const forecastLines: string[] = [];
    for (let i = 0; i < daily.time.length; i++) {
      const day = dayOfWeekRu(daily.time[i]);
      const dateShort = daily.time[i].slice(5); // "MM-DD"
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const precip = daily.precipitation_probability_max[i];
      forecastLines.push(
        `${day} ${dateShort}: ${min}°..${max}°C` + (precip > 0 ? `, осадки ${precip}%` : ''),
      );
    }

    return {
      temp: Math.round(cw.temperature),
      feelsLike: Math.round(cw.temperature), // Open-Meteo current_weather doesn't include feels_like
      description: wmoToDescription(cw.weathercode),
      humidity: 0, // not available in current_weather; use 0 as placeholder
      wind: Math.round(cw.windspeed),
      forecast: forecastLines.join('\n'),
      cityName: coords.name,
    };
  } catch (err) {
    console.error('Open-Meteo API error:', err);
    return {
      temp: 0, feelsLike: 0, description: 'ошибка получения данных', humidity: 0, wind: 0,
      forecast: '', cityName: city,
    };
  }
}

// ── Currency Conversion (Frankfurter API — free, no API key) ──
export async function convertCurrency(amount: number, from: string, to: string): Promise<{ converted: number; rate: number; formatted: string }> {
  const fromCode = from === '₸' ? 'KZT' : from.toUpperCase();
  const toCode = to === '₸' ? 'KZT' : to.toUpperCase();

  if (fromCode === toCode) {
    return { converted: amount, rate: 1, formatted: `${amount} ${fromCode} = ${amount} ${toCode}` };
  }

  try {
    // Frankfurter supports: USD, EUR, GBP, RUB, KZT, TRY and many more
    const url = `https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${fromCode}&to=${toCode}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);
    const data = await response.json() as { rates: Record<string, number> };
    const converted = data.rates?.[toCode];

    if (converted == null) throw new Error(`No rate for ${toCode}`);

    const rate = converted / amount;
    const formattedConverted = converted < 1 ? converted.toFixed(4) : converted.toFixed(2);

    return {
      converted: Math.round(converted * 100) / 100,
      rate: Math.round(rate * 10000) / 10000,
      formatted: `${amount} ${fromCode} = ${formattedConverted} ${toCode} (курс: ${rate.toFixed(4)})`,
    };
  } catch (err) {
    console.error('Frankfurter API error:', err);
    // Fallback rates (approximate, as of 2025)
    const fallbackToUsd: Record<string, number> = { USD: 1, KZT: 0.00204, EUR: 1.08, RUB: 0.0104, GBP: 1.27, TRY: 0.031 };
    const fromRate = fallbackToUsd[fromCode] ?? 1;
    const toRate = fallbackToUsd[toCode] ?? 1;
    const rate = toRate / fromRate;
    const converted = Math.round(amount * rate * 100) / 100;
    return {
      converted,
      rate: Math.round(rate * 10000) / 10000,
      formatted: `${amount} ${fromCode} ≈ ${converted} ${toCode} (оффлайн курс)`,
    };
  }
}

// ── Hotels (Booking.com deep link + mock results) ──
export async function searchHotels(params: {
  city: string; checkIn: string; checkOut: string; maxPrice?: number;
}): Promise<{ hotels: Array<{ name: string; price: number; currency: string; rating: number; distance: string }>; link: string; message: string }> {
  const link = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(params.city)}&checkin=${params.checkIn}&checkout=${params.checkOut}`;

  const hotels = [
    { name: `${params.city} Grand Hotel`, price: 25000, currency: 'KZT', rating: 4.5, distance: '1.2 км от центра' },
    { name: `${params.city} Boutique`, price: 35000, currency: 'KZT', rating: 4.7, distance: '0.8 км от центра' },
    { name: `${params.city} Premium`, price: 55000, currency: 'KZT', rating: 4.9, distance: '0.3 км от центра' },
  ];

  return {
    hotels,
    link,
    message: `Отели в ${params.city} на ${params.checkIn} — ${params.checkOut}. Смотри варианты: ${link}`,
  };
}

// ── Send Telegram message ──
export async function sendTelegramMessage(userId: string, text: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return 'Telegram бот будет доступен после настройки TELEGRAM_BOT_TOKEN.';
  }

  try {
    // Dynamic import to avoid circular dependency issues
    const { prisma: db } = await import('../lib/prisma.js');

    const integration = await db.integration.findFirst({
      where: { userId, provider: 'telegram', active: true },
      select: { settings: true },
    });

    if (!integration) {
      return 'Telegram не подключён. Подключи бота в настройках интеграций.';
    }

    const settings = integration.settings as unknown as { chatId: string };
    if (!settings.chatId) {
      return 'Telegram chatId не найден. Напиши /start боту @LifeOS_bot.';
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.chatId, text, parse_mode: 'HTML' }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Telegram sendMessage error:', err);
      return 'Ошибка отправки сообщения в Telegram. Попробуй позже.';
    }

    return `Сообщение отправлено в Telegram.`;
  } catch (err) {
    console.error('Telegram send error:', err);
    return 'Ошибка отправки сообщения в Telegram.';
  }
}
