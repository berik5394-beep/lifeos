import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import {
  createDeal, updateDeal, listDeals, recordDealIncome, dealIncomeDue, setSalesPlan, salesPlanStatus, isDealStage, type DealStage,
  describePossibleDuplicate, STAGE_LABEL, fmtMoneyExact,
} from '../services/deals/index.js';
import { captureActivity } from '../services/tool-activity-summary.js';

/** «Сделка «Окна» (Серик)» — для памяти мозга. */
function dealHead(d: { title: string; personName: string }): string {
  return `«${d.title}» (${d.personName})`;
}
import { MAX_MONEY_AMOUNT } from '../lib/money.js';

const civil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const money = z.number().positive().max(MAX_MONEY_AMOUNT);
const stage = z.string().refine((s) => isDealStage(s), 'неизвестная стадия');
const createSchema = z.object({
  personName: z.string().min(1).max(120),
  title: z.string().max(200).nullable().optional(),
  amount: money.nullable().optional(),
  stage: stage.optional(),
  nextStepDate: civil.nullable().optional(),
  nextStepText: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
const updateSchema = z.object({
  stage: stage.optional(),
  amount: money.nullable().optional(),
  nextStepDate: civil.nullable().optional(),
  nextStepText: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  lostReason: z.string().max(300).nullable().optional(),
});
const planSchema = z.object({ amount: money, month: monthStr.optional() });

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
    // Сделка с экрана — в память мозга (раньше сделки мозг не «помнил» вовсе).
    captureActivity(request.userId, {
      type: 'deal_created',
      content:
        `Новая сделка ${dealHead(r.deal)}` +
        (r.deal.amount != null ? ` на ${fmtMoneyExact(r.deal.amount)}` : '') +
        `, стадия «${STAGE_LABEL[r.deal.stage as DealStage] ?? r.deal.stage}»`,
      importance: 6,
    });
    return reply.status(201).send({ deal: r.deal, step: r.step, taggedClient: r.taggedClient, incomeOffer: r.incomeOffer });
  });

  app.put('/deals/:id', { preHandler: validate(updateSchema) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof updateSchema>;
    try {
      const r = await updateDeal(request.userId, id, { ...body, stage: body.stage as DealStage | undefined });
      captureActivity(
        request.userId,
        r.stageChanged
          ? {
              type: 'deal_stage_changed',
              content: `Сделка ${dealHead(r.deal)} → «${STAGE_LABEL[r.deal.stage as DealStage] ?? r.deal.stage}»`,
              importance: r.deal.stage === 'won' || r.deal.stage === 'lost' ? 7 : 5,
            }
          : { type: 'deal_updated', content: `Обновил сделку ${dealHead(r.deal)}` },
      );
      // Сколько записать доходом при «выиграна»: сумма − авансы (аудит 2026-11-09).
      const incomeDue = r.incomeOffer ? await dealIncomeDue(r.deal) : null;
      return { deal: r.deal, step: r.step, incomeOffer: r.incomeOffer && incomeDue !== 0, incomeDue };
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
    if (!r.already) {
      // Доход по сделке идёт мимо /finance/incomes — пишем в память здесь.
      const d = await prisma.deal.findFirst({ where: { id, userId: request.userId }, select: { title: true, personName: true } });
      captureActivity(request.userId, {
        type: 'income_added',
        content: `Доход ${fmtMoneyExact(r.amount)} по сделке ${d ? dealHead(d) : ''}`.trim(),
        importance: 6,
      });
    }
    return r;
  });

  app.get('/sales-plan', async (request, reply) => {
    const { month } = request.query as { month?: string };
    if (month !== undefined && !monthStr.safeParse(month).success) {
      return reply.status(400).send({ message: 'month — в формате YYYY-MM' });
    }
    return { plan: await salesPlanStatus(request.userId, new Date(), month) };
  });

  app.put('/sales-plan', { preHandler: validate(planSchema) }, async (request) => {
    const { amount, month } = request.body as z.infer<typeof planSchema>;
    await setSalesPlan(request.userId, amount, new Date(), month);
    captureActivity(request.userId, {
      type: 'sales_plan_set',
      content: `План продаж${month ? ` на ${month}` : ' на месяц'}: ${fmtMoneyExact(amount)}`,
      importance: 5,
    });
    return { plan: await salesPlanStatus(request.userId, new Date(), month) };
  });
}
