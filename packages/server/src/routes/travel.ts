import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { searchFlights, searchHotels, buildRoute, getWeather, convertCurrency } from '../services/external-apis.js';

export async function travelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Search flights
  app.post('/travel/search-flights', async (request, reply) => {
    const body = z.object({
      from: z.string(), to: z.string(), departDate: z.string(),
      returnDate: z.string().optional(), passengers: z.number().optional(),
    }).parse(request.body);
    const flights = await searchFlights({
      from: body.from, to: body.to, departDate: body.departDate,
      returnDate: body.returnDate, passengers: body.passengers,
    });
    return reply.send(flights);
  });

  // Search hotels
  app.post('/travel/search-hotels', async (request, reply) => {
    const body = z.object({
      city: z.string(), checkIn: z.string(), checkOut: z.string(), maxPrice: z.number().optional(),
    }).parse(request.body);
    const hotels = await searchHotels({
      city: body.city, checkIn: body.checkIn, checkOut: body.checkOut, maxPrice: body.maxPrice,
    });
    return reply.send(hotels);
  });

  // Build route
  app.post('/travel/build-route', async (request, reply) => {
    const body = z.object({
      from: z.string(), to: z.string(), mode: z.string().optional(),
    }).parse(request.body);
    const route = await buildRoute({
      from: body.from, to: body.to, mode: body.mode,
    });
    return reply.send(route);
  });

  // Travel plans CRUD
  app.get('/travel/plans', async (request, reply) => {
    const plans = await prisma.travelPlan.findMany({
      where: { userId: request.userId },
      orderBy: { dateFrom: 'desc' },
    });
    return reply.send(plans);
  });

  app.get('/travel/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = await prisma.travelPlan.findFirst({ where: { id, userId: request.userId } });
    if (!plan) return reply.status(404).send({ message: 'План не найден' });
    return reply.send(plan);
  });

  // Weather
  app.get('/weather', async (request, reply) => {
    const { city } = request.query as { city?: string };
    if (!city) return reply.status(400).send({ message: 'city required' });
    const weather = await getWeather(city);
    return reply.send(weather);
  });

  // Currency conversion
  app.get('/currency/convert', async (request, reply) => {
    const { amount, from, to } = request.query as { amount?: string; from?: string; to?: string };
    if (!amount || !from || !to) return reply.status(400).send({ message: 'amount, from, to required' });
    const result = await convertCurrency(Number(amount), from, to);
    return reply.send(result);
  });
}
