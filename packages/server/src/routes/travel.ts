import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import { searchFlights, searchHotels, buildRoute, getWeather, convertCurrency } from '../services/external-apis.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Travel-роуты стучатся в платные external API (Amadeus flights, Booking
// hotels, Google Maps directions). Каждый вызов — реальные деньги. Без
// лимита кривой ретрай на клиенте может выставить нам счёт на сотни $.
// Search-роуты — 10/мин на юзера, weather/currency — 30/мин (они дешевле).
const searchLimiter = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'travel:search' });
const utilLimiter = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'travel:util' });

// ---------------------------------------------------------------------------
// Схемы валидации. Ограничение длин строк — защита от payload-abuse и мусорных
// запросов к платным внешним API (Amadeus, Booking, Google Maps).
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата должна быть в формате YYYY-MM-DD');

const searchFlightsSchema = z.object({
  from: z.string().min(2).max(64),
  to: z.string().min(2).max(64),
  departDate: isoDate,
  returnDate: isoDate.optional(),
  passengers: z.number().int().min(1).max(9).optional(),
});

const searchHotelsSchema = z.object({
  city: z.string().min(2).max(64),
  checkIn: isoDate,
  checkOut: isoDate,
  maxPrice: z.number().positive().max(100_000_000).optional(),
});

const buildRouteSchema = z.object({
  from: z.string().min(2).max(128),
  to: z.string().min(2).max(128),
  mode: z.enum(['driving', 'walking', 'transit', 'bicycling']).optional(),
});

export async function travelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Search flights
  app.post(
    '/travel/search-flights',
    { preHandler: [searchLimiter, validate(searchFlightsSchema)] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof searchFlightsSchema>;
      const flights = await searchFlights(body);
      return reply.send(flights);
    },
  );

  // Search hotels
  app.post(
    '/travel/search-hotels',
    { preHandler: [searchLimiter, validate(searchHotelsSchema)] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof searchHotelsSchema>;
      const hotels = await searchHotels(body);
      return reply.send(hotels);
    },
  );

  // Build route
  app.post(
    '/travel/build-route',
    { preHandler: [searchLimiter, validate(buildRouteSchema)] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof buildRouteSchema>;
      const route = await buildRoute(body);
      return reply.send(route);
    },
  );

  // Travel plans CRUD
  app.get('/travel/plans', async (request, reply) => {
    const plans = await prisma.travelPlan.findMany({
      where: { userId: request.userId },
      orderBy: { dateFrom: 'desc' },
    });
    return reply.send(plans);
  });

  app.get('/travel/plans/:id', async (request) => {
    const { id } = request.params as { id: string };
    const plan = await prisma.travelPlan.findFirst({ where: { id, userId: request.userId } });
    if (!plan) throw new NotFoundError('План');
    return plan;
  });

  // Weather
  app.get('/weather', { preHandler: utilLimiter }, async (request) => {
    const { city } = request.query as { city?: string };
    if (!city || city.length < 2 || city.length > 64) {
      throw new ValidationError('Параметр city обязателен (2-64 символа)', { field: 'city' });
    }
    return await getWeather(city);
  });

  // Currency conversion
  app.get('/currency/convert', { preHandler: utilLimiter }, async (request) => {
    const { amount, from, to } = request.query as { amount?: string; from?: string; to?: string };
    if (!amount || !from || !to) {
      throw new ValidationError('Параметры amount, from, to обязательны', {
        fields: ['amount', 'from', 'to'],
      });
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1_000_000_000) {
      throw new ValidationError('amount должен быть положительным числом', { field: 'amount' });
    }
    if (from.length !== 3 || to.length !== 3) {
      throw new ValidationError('from и to должны быть кодами валют (3 буквы, например USD)', {
        fields: ['from', 'to'],
      });
    }
    return await convertCurrency(numAmount, from, to);
  });
}
