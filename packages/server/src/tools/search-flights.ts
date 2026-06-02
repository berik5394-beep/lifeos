import { z } from 'zod';
import {
  searchFlights,
  TravelpayoutsError,
} from '../integrations/travelpayouts.js';
import { defineTool } from './_types.js';

/**
 * Phase 7 — active flight search через Travelpayouts (Aviasales).
 *
 * Отдельно от get_trip: get_trip = «что у меня в плане» (existing
 * TravelPlan rows), search_flights = «найди новые билеты» (active
 * search API). Friend-UX: graceful fallback если ключ не задан или
 * Aviasales temporarily down — bot объясняет по-человечески, не
 * throw'ит в orchestrator.
 *
 * Не помечен `requires` (это server-level integration, не user OAuth
 * — tool-filter по integration availability к нему не применяется).
 * Защита от hollow-tool — try/catch + structured response.
 */
export const searchFlightsTool = defineTool({
  name: 'search_flights',
  description:
    'НАЙТИ авиабилеты по маршруту и датам (Aviasales). Используй для ' +
    '«найди билет в X», «сколько стоит долететь до Y», «когда дешевле ' +
    'лететь в Z». Возвращает топ-5 самых дешёвых вариантов с affiliate ' +
    'ссылками. НЕ путать с get_trip — тот показывает УЖЕ запланированные ' +
    'поездки юзера, search_flights ищет НОВЫЕ. IATA коды 3 буквы ' +
    '(Алматы=ALA, Астана=NQZ, Москва=MOW, Дубай=DXB).',
  category: 'travel',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { from: 'origin', to: 'destination', fromCity: 'origin', toCity: 'destination', departureDate: 'departureAt', departure: 'departureAt', departAt: 'departureAt' },
  schema: z.object({
    origin: z
      .string()
      .length(3)
      .describe('IATA код города вылета, 3 буквы (Алматы=ALA, Астана=NQZ)'),
    destination: z
      .string()
      .length(3)
      .describe('IATA код города назначения, 3 буквы'),
    departureAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'формат YYYY-MM-DD')
      .describe('дата вылета YYYY-MM-DD'),
    returnAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'формат YYYY-MM-DD')
      .optional()
      .describe('дата возврата YYYY-MM-DD, опц. (без неё — one-way)'),
    currency: z
      .enum(['KZT', 'USD', 'EUR', 'RUB'])
      .optional()
      .describe('валюта цены, по умолчанию KZT'),
  }),
  needsConfirm: false,
  sideEffects: 'external',
  examples: [
    'найди билет в Алматы на 15 июля',
    'сколько стоит долететь до Москвы',
    'когда дешевле лететь в Дубай в августе',
  ],
  handler: async (input) => {
    try {
      const flights = await searchFlights({
        origin: input.origin,
        destination: input.destination,
        departureAt: input.departureAt,
        returnAt: input.returnAt,
        currency: input.currency,
      });
      if (flights.length === 0) {
        return {
          connected: true,
          count: 0,
          note: 'По этому маршруту/датам билетов не найдено.',
        };
      }
      // Top-5 cheapest, без сырого dump
      const top = flights.slice(0, 5).map((f) => ({
        price: f.price,
        currency: f.currency,
        airline: f.airline,
        flightNumber: f.flightNumber,
        departureAt: f.departureAt,
        returnAt: f.returnAt,
        transfers: f.transfers,
        durationMinutes: f.duration,
        link: f.link,
      }));
      return {
        connected: true,
        count: flights.length,
        topResults: top,
      };
    } catch (err) {
      // Friend-UX: structured fallback вместо throw в orchestrator
      // (как get-email-triage pattern).
      if (err instanceof TravelpayoutsError) {
        if (err.code === 'not_configured') {
          return {
            connected: false,
            reason: 'not_configured',
            message:
              'Поиск билетов сейчас не подключён. Скажу Berik\'у — он добавит ключи.',
          };
        }
        if (err.code === 'invalid_input') {
          return {
            connected: false,
            reason: 'invalid_input',
            message:
              'Не понял маршрут — нужны IATA коды по 3 буквы ' +
              '(Алматы=ALA, Астана=NQZ, Москва=MOW).',
          };
        }
        // api_error
        return {
          connected: false,
          reason: 'api_error',
          message:
            'Поиск билетов временно недоступен (Aviasales API). ' +
            'Попробую позже — пока поищи сам на aviasales.kz.',
        };
      }
      console.warn('[search_flights] unexpected:', err);
      return {
        connected: false,
        reason: 'unexpected_error',
        message: 'Не смог найти билеты сейчас, попробую позже.',
      };
    }
  },
});
