import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { handleMessage, runConfirmedAction } from '../services/jarvis-orchestrator.js';
import { takePendingAction, peekPendingAction } from '../services/pending-actions.js';

// AI chat is expensive (Claude API + web search) — limit per minute and per hour
const chatRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'ai-chat' });

const chatSchema = z.object({
  // Cap protects Claude billing: 4000 chars ≈ 1000 tokens на запрос юзера —
  // больше не имеет смысла для диалога (модель усечёт контекст).
  text: z.string().min(1, 'Текст обязателен').max(4000, 'Сообщение слишком длинное'),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- AI Chat ---

  // AI Chat — теперь через единый JARVIS-оркестратор (тот же мозг что у
  // Telegram-бота): web search, консьерж-бронирование, intent routing,
  // память + история диалога. Раньше мобилка использовала упрощённый
  // путь без web search и оркестратора — была "тупее" бота. Теперь равны.
  app.post('/voice/chat', {
    preHandler: [chatRateLimit, aiDailyLimiter, validate(chatSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof chatSchema>;
    try {
      const res = await handleMessage(request.userId, text);
      let message = res.reply;
      if (res.bookingUrl) message += `\n\n\u{1F517} ${res.bookingUrl}`;
      // SSOT Step 7: бейдж — ТОЛЬКО реальные исполненные инструменты
      // из аудита ToolCall. Никакого NLP-«+N в задачи» из воздуха.
      if (res.auditedActions && res.auditedActions > 0) {
        message += `\n\n— \u{2705} выполнено действий: ${res.auditedActions}`;
      }
      return reply.send({
        message,
        intent: res.intent,
        // Фаза 1.2: если денежное действие ждёт подтверждения —
        // приложение показывает кнопки «Подтвердить / Отмена».
        pendingAction: res.pendingAction ?? null,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки чата' });
    }
  });

  // --- Подтверждение/отмена денежного действия (Фаза 1.2) ---
  // Приложение шлёт сюда по нажатию кнопки. Pending хранится на сервере
  // (in-memory, TTL 5 мин) — клиенту не нужно гонять туда-сюда payload.
  const confirmSchema = z.object({ confirm: z.boolean() });
  app.post('/voice/confirm-action', {
    preHandler: [chatRateLimit, validate(confirmSchema)],
  }, async (request, reply) => {
    const { confirm } = request.body as z.infer<typeof confirmSchema>;
    if (!confirm) {
      await takePendingAction(request.userId);
      return reply.send({ message: 'Окей, отменил — ничего не записал.', done: true });
    }
    const p = await takePendingAction(request.userId);
    if (!p) {
      return reply.status(409).send({
        message: 'Нечего подтверждать — предложение устарело. Повтори запрос.',
        done: false,
      });
    }
    const msg = await runConfirmedAction(request.userId, p.action, p.input);
    return reply.send({ message: msg, intent: p.action, done: true });
  });

  // --- Есть ли ожидающее подтверждения действие (для восстановления UI) ---
  app.get('/voice/pending-action', async (request, reply) => {
    const p = await peekPendingAction(request.userId);
    return reply.send(
      p
        ? { pending: { action: p.action, input: p.input }, confirmationText: p.confirmationText }
        : { pending: null },
    );
  });


  // --- Chat History ---

  app.get('/chat/history', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const result = historyQuerySchema.safeParse(query);

    if (!result.success) {
      return reply.status(400).send({
        message: 'Ошибка валидации',
        errors: result.error.flatten().fieldErrors,
      });
    }

    const { limit, offset } = result.data;

    const messages = await prisma.chatMessage.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return reply.send(messages);
  });

  // --- Clear Chat History ---

  app.delete('/chat/history', async (request, reply) => {
    await prisma.chatMessage.deleteMany({
      where: { userId: request.userId },
    });

    return reply.send({ success: true, message: 'История чата очищена' });
  });

  // --- User Interests ---

  app.get('/user/interests', async (request, reply) => {
    const interests = await prisma.userInterest.findMany({
      where: { userId: request.userId },
      orderBy: { score: 'desc' },
    });

    return reply.send(interests);
  });
}
