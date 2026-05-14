import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { searchFlights, searchHotels, buildRoute, getWeather, convertCurrency } from '../services/external-apis.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import {
  parseBookingIntent,
  buildBookingUrl,
  narrateBooking,
  type BookingContext,
} from '../services/smart-booking.js';

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

// JARVIS smart-book: естественный запрос → ссылка на агрегатор + умная озвучка
const smartBookSchema = z.object({
  text: z.string().min(2, 'Слишком короткий запрос').max(500, 'Слишком длинный запрос'),
});

// Отдельный rate-limit поверх aiDailyLimiter: smart-book зовёт Claude дважды
// (parse intent + narrate) — дороже обычного chat. 10/мин — комфортно для
// бытового использования, защищает от спамных циклов.
const smartBookLimiter = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'smart-book' });

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

  // JARVIS Smart-book — главный JARVIS-эндпоинт: естественная речь →
  // распознанные параметры + deeplink + контекстная озвучка.
  // Пример: "забронируй рейс в Астану на завтра" →
  //   { type: "flight", url: "https://www.aviasales.kz/search/ALA1505NQZ1",
  //     spokenResponse: "Опять в Астану! В 14:00 у тебя встреча — успеешь.
  //                       Глянь утренние рейсы, посмотри что есть." }
  app.post(
    '/travel/smart-book',
    {
      preHandler: [smartBookLimiter, aiDailyLimiter, validate(smartBookSchema)],
    },
    async (request, reply) => {
      const { text } = request.body as z.infer<typeof smartBookSchema>;
      const userId = request.userId;

      const todayIso = new Date().toISOString().slice(0, 10);
      const intent = await parseBookingIntent(text, todayIso);

      // Дата(ы) для подтягивания событий — для авиа берём departDate, для
      // отеля checkIn, для такси — сегодня (поездка чаще всего сейчас).
      const targetDate =
        intent.departDate ||
        intent.checkIn ||
        todayIso;

      const [user, eventsOnDate, destMemory] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        }),
        prisma.calendarEvent.findMany({
          where: {
            userId,
            date: new Date(targetDate + 'T00:00:00Z'),
          },
          select: { title: true, date: true, startTime: true },
          take: 10,
        }),
        // Был ли юзер в этом городе раньше — проверяем по Memory
        intent.toCity || intent.city
          ? prisma.memory.findFirst({
              where: {
                userId,
                content: {
                  contains: (intent.toCity || intent.city) as string,
                  mode: 'insensitive',
                },
              },
              select: { id: true },
            })
          : null,
      ]);

      const url = buildBookingUrl(intent);

      const context: BookingContext = {
        userName: user?.name || 'друг',
        eventsOnDate: eventsOnDate.map((e) => ({
          title: e.title,
          date: e.date.toISOString().slice(0, 10),
          startTime: e.startTime,
        })),
        destinationKnown: !!destMemory,
      };

      const spokenResponse = await narrateBooking(intent, context);

      // Сохраняем намерение в TravelPlan для истории (если flight/hotel и
      // достаточная уверенность). Такси не сохраняем — слишком эфемерно.
      let planId: string | null = null;
      if (
        intent.confidence >= 0.5 &&
        (intent.type === 'flight' || intent.type === 'hotel')
      ) {
        const destination =
          intent.type === 'flight'
            ? intent.toCity || intent.toCode || 'неизвестно'
            : intent.city || 'неизвестно';
        const dateFrom = intent.departDate || intent.checkIn;
        if (dateFrom) {
          const plan = await prisma.travelPlan.create({
            data: {
              userId,
              destination: destination.slice(0, 128),
              dateFrom: new Date(dateFrom + 'T00:00:00Z'),
              dateTo: intent.returnDate || intent.checkOut
                ? new Date((intent.returnDate || intent.checkOut)! + 'T00:00:00Z')
                : null,
              purpose: intent.rawText.slice(0, 200),
              status: 'planning',
              routes: { bookingUrl: url, intent: JSON.parse(JSON.stringify(intent)) },
            },
          });
          planId = plan.id;
        }
      }

      return reply.send({
        type: intent.type,
        url,
        spokenResponse,
        intent,
        eventsOnDate: context.eventsOnDate,
        planId,
      });
    },
  );
}
