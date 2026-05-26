/**
 * Travelpayouts integration (Aviasales + Hotellook).
 *
 * Phase 7 — закрывает «active search flights» capability (раньше
 * get_trip только показывал existing TravelPlan, не искал новые).
 *
 * Auth: X-Access-Token header (server-level, не user OAuth).
 * Affiliate marker подмешивается в query → Travelpayouts возвращает
 * `link` уже с tracking; revenue share при покупке через эту ссылку.
 *
 * ENV (в packages/server/.env + Railway production vars):
 *   TRAVELPAYOUTS_TOKEN — обязателен, иначе throws TravelpayoutsError
 *   TRAVELPAYOUTS_MARKER — опционально, без него ссылка без affiliate
 *
 * Friend-UX (defense-in-depth, по AGENTS.md §12 pattern):
 *   tool-layer (search-flights.ts) ловит TravelpayoutsError и
 *   возвращает structured graceful response вместо throw в orchestrator.
 *   Тут throws — это «честный сигнал», что что-то не так с конфигом
 *   или API.
 */

const TP_AVIA_BASE = 'https://api.travelpayouts.com/aviasales/v3';
const TIMEOUT_MS = 8_000;

export class TravelpayoutsError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_configured' | 'api_error' | 'invalid_input',
  ) {
    super(message);
    this.name = 'TravelpayoutsError';
  }
}

export interface FlightSearchResult {
  price: number;
  currency: string;
  airline: string;
  flightNumber: string;
  departureAt: string; // ISO
  returnAt: string | null;
  link: string; // affiliate-enabled (если marker задан)
  origin: string; // IATA
  destination: string;
  transfers: number; // 0 = direct
  duration: number; // в минутах
}

/** Внутренний типизированный fragment ответа Aviasales API v3. */
interface AviasalesPriceItem {
  price: number;
  airline: string;
  flight_number: string | number;
  departure_at: string;
  return_at: string | null;
  link: string;
  origin: string;
  destination: string;
  transfers?: number;
  duration?: number;
}

interface AviasalesResponse {
  success: boolean;
  data: AviasalesPriceItem[];
  currency?: string;
  error?: string;
}

/**
 * Поиск авиабилетов через Aviasales `prices_for_dates`.
 * Возвращает массив, отсортированный по цене ascending (cheapest first).
 *
 * @throws TravelpayoutsError с code:
 *   - 'not_configured' если нет TRAVELPAYOUTS_TOKEN
 *   - 'invalid_input' если IATA коды неверной длины
 *   - 'api_error' если Aviasales вернул non-2xx или success=false
 */
export async function searchFlights(params: {
  origin: string; // IATA (3 буквы, напр. 'ALA' для Алматы)
  destination: string; // IATA
  departureAt: string; // YYYY-MM-DD
  returnAt?: string; // YYYY-MM-DD (для round-trip)
  currency?: string; // 'KZT' (default), 'USD', 'EUR', 'RUB'
}): Promise<FlightSearchResult[]> {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) {
    throw new TravelpayoutsError(
      'TRAVELPAYOUTS_TOKEN не задан в env',
      'not_configured',
    );
  }
  if (params.origin.length !== 3 || params.destination.length !== 3) {
    throw new TravelpayoutsError(
      `IATA код должен быть 3 буквы (origin="${params.origin}", destination="${params.destination}")`,
      'invalid_input',
    );
  }

  const marker = process.env.TRAVELPAYOUTS_MARKER;
  const qs = new URLSearchParams({
    origin: params.origin.toUpperCase(),
    destination: params.destination.toUpperCase(),
    departure_at: params.departureAt,
    currency: params.currency || 'KZT',
    sorting: 'price',
    direct: 'false',
    limit: '10',
  });
  if (params.returnAt) qs.set('return_at', params.returnAt);
  if (marker) qs.set('marker', marker);

  const url = `${TP_AVIA_BASE}/prices_for_dates?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'X-Access-Token': token, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new TravelpayoutsError(
        `Aviasales API HTTP ${res.status}: ${txt.slice(0, 150)}`,
        'api_error',
      );
    }
    const json = (await res.json()) as AviasalesResponse;
    if (!json.success) {
      throw new TravelpayoutsError(
        `Aviasales вернул success=false: ${json.error ?? 'no error message'}`,
        'api_error',
      );
    }
    const currency = json.currency || params.currency || 'KZT';
    return json.data.map((item) => ({
      price: item.price,
      currency,
      airline: item.airline,
      flightNumber: String(item.flight_number),
      departureAt: item.departure_at,
      returnAt: item.return_at,
      link: item.link.startsWith('http')
        ? item.link
        : `https://www.aviasales.com${item.link}`,
      origin: item.origin,
      destination: item.destination,
      transfers: item.transfers ?? 0,
      duration: item.duration ?? 0,
    }));
  } finally {
    clearTimeout(timer);
  }
}
