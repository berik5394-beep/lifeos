import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { createObligation, listObligations, settleObligation, cancelObligation } from '../services/obligations/index.js';

/**
 * Долги в «Финансах» (этап 3, честность). Раньше экран держал долги в памяти
 * (пропадали при выходе), хотя голосом «Ахмет должен мне 500 000» они уже
 * писались в Obligation. Теперь экран и голос — одна таблица.
 */
const civil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const createSchema = z.object({
  personName: z.string().trim().min(1).max(120),
  direction: z.enum(['i_owe', 'owed_to_me']),
  amount: z.number().positive().max(MAX_MONEY_AMOUNT),
  dueDate: civil.nullable().optional(),
  description: z.string().max(200).nullable().optional(),
});

export async function obligationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** Открытые денежные долги (в обе стороны). */
  app.get('/obligations', async (request) => {
    const all = await listObligations(request.userId, { status: 'open' });
    return { obligations: all.filter((o) => o.kind === 'money') };
  });

  app.post('/obligations', { preHandler: validate(createSchema) }, async (request, reply) => {
    const b = request.body as z.infer<typeof createSchema>;
    const o = await createObligation({
      userId: request.userId,
      personName: b.personName,
      direction: b.direction,
      kind: 'money',
      description: b.description?.trim() || (b.direction === 'i_owe' ? 'долг' : 'должен мне'),
      amount: b.amount,
      dueDate: b.dueDate ? new Date(`${b.dueDate}T00:00:00Z`) : null,
      source: 'manual',
    });
    // Как у трат/задач: запись с экрана — в память мозга (раньше только голосом).
    captureActivity(request.userId, {
      type: 'obligation_added',
      content:
        b.direction === 'i_owe'
          ? `Долг: я должен ${b.personName} ${b.amount} ₸${b.dueDate ? ` до ${b.dueDate}` : ''}`
          : `Долг: ${b.personName} должен мне ${b.amount} ₸${b.dueDate ? ` до ${b.dueDate}` : ''}`,
      importance: 6,
    });
    return reply.status(201).send({ obligation: o });
  });

  /** Вернули / отдал — закрыть. */
  app.post('/obligations/:id/settle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const o = await settleObligation(request.userId, id);
    if (!o) return reply.status(404).send({ message: 'Долг не найден' });
    captureActivity(request.userId, {
      type: 'obligation_settled',
      content: o.direction === 'i_owe' ? `Отдал долг ${o.personName}${o.amount ? ` ${o.amount} ₸` : ''}` : `${o.personName} вернул долг${o.amount ? ` ${o.amount} ₸` : ''}`,
    });
    return { obligation: o };
  });

  /** Убрать (ошибся / уже не актуально) — отмена, не удаление: история остаётся. */
  app.delete('/obligations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const o = await cancelObligation(request.userId, id);
    if (!o) return reply.status(404).send({ message: 'Долг не найден' });
    captureActivity(request.userId, {
      type: 'obligation_cancelled',
      content: `Убрал долг ${o.direction === 'i_owe' ? 'перед' : 'от'} ${o.personName}${o.amount ? ` ${o.amount} ₸` : ''} (не актуален)`,
    });
    return { obligation: o };
  });
}
