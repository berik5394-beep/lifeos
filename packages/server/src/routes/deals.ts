import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import {
  createDeal, updateDeal, listDeals, recordDealIncome, setSalesPlan, salesPlanStatus, isDealStage, type DealStage,
  describePossibleDuplicate,
} from '../services/deals/index.js';

const civil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const stage = z.string().refine((s) => isDealStage(s), 'неизвестная стадия');
const createSchema = z.object({
  personName: z.string().min(1).max(120),
  title: z.string().max(200).nullable().optional(),
  amount: z.number().positive().nullable().optional(),
  stage: stage.optional(),
  nextStepDate: civil.nullable().optional(),
  nextStepText: z.string().max(200).nullable().optional(),
});
const updateSchema = z.object({
  stage: stage.optional(),
  amount: z.number().positive().nullable().optional(),
  nextStepDate: civil.nullable().optional(),
  nextStepText: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  lostReason: z.string().max(300).nullable().optional(),
});
const planSchema = z.object({ amount: z.number().positive() });

/** Флаг выключен → 404: мобилка прячет инструмент «Сделки». */
async function dealsGate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  // async-хук: после send ОБЯЗАТЕЛЬНО вернуть reply, иначе Fastify пойдёт в хендлер.
  if (!isV2DealsEnabled(request.userId)) return reply.status(404).send({ message: 'Не найдено' });
}

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', dealsGate);

  app.get('/deals', async (request) => {
    const q = request.query as { status?: string };
    const deals = await listDeals(request.userId, q.status === 'closed' ? 'closed' : 'open');
    return { deals };
  });

  app.get('/deals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deal = await prisma.deal.findFirst({
      where: { id, userId: request.userId },
      include: { events: { orderBy: { at: 'desc' }, take: 30 } },
    });
    if (!deal) return reply.status(404).send({ message: 'Сделка не найдена' });
    return { deal };
  });

  app.post('/deals', { preHandler: validate(createSchema) }, async (request, reply) => {
    const body = request.body as z.infer<typeof createSchema>;
    const r = await createDeal(request.userId, { ...body, stage: body.stage as DealStage | undefined });
    return reply.status(201).send({ deal: r.deal, step: r.step, taggedClient: r.taggedClient, incomeOffer: r.incomeOffer });
  });

  app.put('/deals/:id', { preHandler: validate(updateSchema) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof updateSchema>;
    try {
      const r = await updateDeal(request.userId, id, { ...body, stage: body.stage as DealStage | undefined });
      return { deal: r.deal, step: r.step, incomeOffer: r.incomeOffer };
    } catch (err) {
      if (err instanceof Error && err.message === 'not_found') return reply.status(404).send({ message: 'Сделка не найдена' });
      throw err;
    }
  });

  app.post('/deals/:id/income', async (request, reply) => {
    const { id } = request.params as { id: string };
    const force = (request.query as { force?: string }).force === 'true';
    const r = await recordDealIncome(request.userId, id, new Date(), { force });
    if (!r.ok && r.reason === 'not_found') return reply.status(404).send({ message: 'Сделка не найдена' });
    if (!r.ok && r.reason === 'possible_duplicate') {
      // Страховка B2: похожий доход уже есть — приложение переспрашивает и шлёт ?force=true.
      return reply.status(409).send({ message: describePossibleDuplicate(r.amount, r.personName, r.existingDate), reason: r.reason });
    }
    if (!r.ok) return reply.status(422).send({ message: r.reason === 'no_amount' ? 'У сделки нет суммы' : 'Сделка ещё не выиграна' });
    return r;
  });

  app.get('/sales-plan', async (request) => ({ plan: await salesPlanStatus(request.userId) }));

  app.put('/sales-plan', { preHandler: validate(planSchema) }, async (request) => {
    const { amount } = request.body as z.infer<typeof planSchema>;
    await setSalesPlan(request.userId, amount);
    return { plan: await salesPlanStatus(request.userId) };
  });
}
