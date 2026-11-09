import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { handleMessage, runConfirmedAction, dealChoiceHint } from '../services/jarvis-orchestrator.js';
import { takePendingAction, peekPendingAction, pendingStagedSince, clientPendingInput } from '../services/pending-actions.js';
import { DEAL_INCOME_CHOICE } from '../services/deals/service.js';

// AI chat is expensive (Claude API + web search) — limit per minute and per hour
const chatRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'ai-chat' });

const chatSchema = z.object({
  // Cap protects Claude billing: 4000 chars ≈ 1000 tokens на запрос юзера —
  // больше не имеет смысла для диалога (модель усечёт контекст).
  text: z.string().min(1, 'Текст обязателен').max(4000, 'Сообщение слишком длинное'),
  // Сказано голосом (микрофон) — ответ будет озвучен: короткий режим для голоса.
  voice: z.boolean().optional(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // «Ещё» по курсору: сообщения старше этого момента (аудит 2026-11-09: смещение
  // считалось по экрану вместе с локальными облачками — сообщения пропускались).
  before: z.string().datetime({ offset: true }).optional(),
});

type JarvisResult = Awaited<ReturnType<typeof handleMessage>>;

/** Ответ чата для приложения (общий для /voice/chat и потока). */
function chatReplyBody(res: JarvisResult) {
  let message = res.reply;
  if (res.bookingUrl) message += `\n\n\u{1F517} ${res.bookingUrl}`;
  // SSOT Step 7: бейдж — ТОЛЬКО реальные исполненные инструменты
  // из аудита ToolCall. Никакого NLP-«+N в задачи» из воздуха.
  // Friend-UX: бейдж выглядит как SQL-trace для юзера → скрыт по
  // умолчанию. Включить для debug: DEBUG_AUDIT_FOOTER=true в env.
  if (process.env.DEBUG_AUDIT_FOOTER === 'true' && res.auditedActions && res.auditedActions > 0) {
    message += `\n\n— \u{2705} выполнено действий: ${res.auditedActions}`;
  }
  return {
    message,
    intent: res.intent,
    // Фаза 1.2: если денежное действие ждёт подтверждения —
    // приложение показывает кнопки «Подтвердить / Отмена».
    pendingAction: res.pendingAction ?? null,
    emotion: res.emotion ?? 'neutral',
    openPanel: res.openPanel ?? null,
  };
}

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
    const { text, voice } = request.body as z.infer<typeof chatSchema>;
    try {
      const res = await handleMessage(request.userId, text, voice ? 'voice' : undefined);
      return reply.send(chatReplyBody(res));
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки чата' });
    }
  });

  // --- Потоковый ответ (jarvis-roadmap №5) ---
  // Голос начинает говорить с первой фразы, не дожидаясь всего ответа.
  // NDJSON: {"t":"d","x":кусок}… затем {"t":"done",…как /voice/chat, streamed}
  // (streamed — весь отданный кусками текст: приложение сверяет с итогом и
  // переозвучивает, если итог другой — подтверждение денег, запасной путь).
  // Ошибка — {"t":"error",message}. Быстрые команды (задача, трата) кусков не
  // дают — сразу done.
  app.post('/voice/chat/stream', {
    preHandler: [chatRateLimit, aiDailyLimiter, validate(chatSchema)],
  }, async (request, reply) => {
    const { text, voice } = request.body as z.infer<typeof chatSchema>;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    const send = (obj: unknown) => {
      if (!raw.destroyed && !raw.writableEnded) raw.write(`${JSON.stringify(obj)}\n`);
    };
    let streamed = '';
    try {
      const res = await handleMessage(request.userId, text, voice ? 'voice' : undefined, {
        onText: (x) => {
          streamed += x;
          send({ t: 'd', x });
        },
      });
      send({ t: 'done', ...chatReplyBody(res), streamed });
    } catch (err) {
      app.log.error(err);
      send({ t: 'error', message: 'Ошибка обработки чата' });
    } finally {
      if (!raw.writableEnded) raw.end();
    }
  });

  // --- Подтверждение/отмена денежного действия (Фаза 1.2) ---
  // Приложение шлёт сюда по нажатию кнопки. Pending хранится на сервере
  // (in-memory, TTL 5 мин) — клиенту не нужно гонять туда-сюда payload.
  // action (опц.) — что именно подтверждает кнопка. Не совпало с ожидающим
  // (его успели заменить, напр. карточка «Задачи» предложила перенос) → 409,
  // ничего не исполняем и не съедаем. Без action — как раньше.
  const confirmSchema = z.object({ confirm: z.boolean(), action: z.string().max(60).optional() });
  app.post('/voice/confirm-action', {
    preHandler: [chatRateLimit, validate(confirmSchema)],
  }, async (request, reply) => {
    const { confirm, action } = request.body as z.infer<typeof confirmSchema>;
    if (action) {
      const cur = await peekPendingAction(request.userId);
      if (cur && cur.action !== action) {
        return reply.status(409).send({
          message: 'Это предложение уже заменено новым — посмотри последнее сообщение.',
          done: false,
          emotion: 'worried',
        });
      }
    }
    if (confirm) {
      // Ревью-3 N12: устаревшая кнопка «Подтвердить» попала на переспрос «какая сделка
      // оплачена?» — это выбор словами; подсказываем и НЕ съедаем вопрос.
      const cur = await peekPendingAction(request.userId);
      if (cur?.action === DEAL_INCOME_CHOICE) {
        return reply.send({ message: dealChoiceHint(cur.input), done: false, emotion: 'neutral' });
      }
    }
    if (!confirm) {
      await takePendingAction(request.userId);
      return reply.send({ message: 'Окей, отменил — ничего не записал.', done: true, emotion: 'neutral' });
    }
    const p = await takePendingAction(request.userId);
    if (!p) {
      return reply.status(409).send({
        message: 'Нечего подтверждать — предложение устарело. Повтори запрос.',
        done: false,
        emotion: 'worried',
      });
    }
    const confirmStart = new Date();
    const msg = await runConfirmedAction(request.userId, p.action, p.input);
    // Подтверждение поставило новый вопрос (напр. «доход уже записан — ещё раз?») →
    // отдаём его с кнопками, а не «готово».
    const restaged = await pendingStagedSince(request.userId, confirmStart);
    if (restaged && restaged.action !== DEAL_INCOME_CHOICE) {
      return reply.send({
        message: msg,
        intent: p.action,
        done: false,
        pendingAction: { action: restaged.action, input: clientPendingInput(restaged.input) },
        confirmationText: restaged.confirmationText,
        emotion: 'neutral',
      });
    }
    return reply.send({ message: msg, intent: p.action, done: true, emotion: 'happy' });
  });

  // --- Есть ли ожидающее подтверждения действие (для восстановления UI) ---
  app.get('/voice/pending-action', async (request, reply) => {
    const p = await peekPendingAction(request.userId);
    // Переспрос «какая сделка оплачена?» — выбор словами, не кнопки.
    return reply.send(
      p && p.action !== DEAL_INCOME_CHOICE
        ? { pending: { action: p.action, input: clientPendingInput(p.input) }, confirmationText: p.confirmationText }
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

    const { limit, offset, before } = result.data;

    const messages = await prisma.chatMessage.findMany({
      where: { userId: request.userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: before ? 0 : offset,
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
