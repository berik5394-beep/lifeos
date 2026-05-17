/**
 * Conversation routes — JARVIS-style multi-turn voice/text conversation.
 *
 * Routes:
 *   POST /voice/conversation/start   — create session, build context, return greeting
 *   POST /voice/conversation/message — audio message (base64), transcribes via Groq Whisper
 *   POST /voice/conversation/text    — text message
 *   POST /voice/conversation/end     — end session
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'node:crypto';
import Groq from 'groq-sdk';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import {
  buildInitialContext,
  generateGreeting,
} from '../services/conversation-engine.js';
// Унификация «третьего мозга»: обработка сообщений диалога теперь
// идёт через единый оркестратор (тот же мозг, что чат/Telegram/
// /voice/assistant): единый промт (без markdown, KZ-валюта,
// решительность), агентные инструменты, travel-концьерж,
// подтверждения, память. conversation-engine.processConversationMessage
// был расходящимся промтом без этого — отсюда markdown-мусор и
// «советует вместо того, чтобы сделать» в проде. Контракт ответа
// {response, actions, suggestions} сохранён. generateGreeting/
// buildInitialContext оставлены только для /start (benign one-shot).
import { handleMessage } from '../services/jarvis-orchestrator.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
});

// Rate limits: conversation is expensive (Claude API + Groq Whisper)
const conversationRateLimit = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'conversation' });
const audioRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'conv-audio' });

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const startSchema = z.object({
  // Optional: client can send empty body to start
}).passthrough();

const textMessageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId обязателен').max(64),
  // Cap для Claude billing — длиннее не имеет смысла в живом диалоге.
  text: z.string().min(1, 'Текст обязателен').max(4000, 'Сообщение слишком длинное'),
});

const audioMessageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId обязателен').max(64),
  // Base64 аудио до ~7MB сырого = 10MB после base64. bodyLimit на маршруте уже стоит.
  audio: z.string().min(1, 'Audio data обязателен').max(10_000_000, 'Аудио слишком большое'),
  format: z.string().max(8).default('m4a'),
});

const endSchema = z.object({
  sessionId: z.string().min(1, 'sessionId обязателен'),
});

// ---------------------------------------------------------------------------
// Audio transcription via Groq Whisper
// ---------------------------------------------------------------------------

async function transcribeAudio(audioBase64: string, format: string): Promise<string> {
  const buffer = Buffer.from(audioBase64, 'base64');

  if (buffer.length < 100) {
    return '';
  }

  // Раньше было writeFileSync/readFileSync — эти синхронные вызовы блокируют
  // event loop на десятки мс для больших m4a файлов. При 10+ параллельных
  // голосовых запросах (офис-демо, пик утром) один запрос мог "замораживать"
  // всех остальных. Асинхронные аналоги используют thread pool libuv.
  //
  // Дополнительно: crypto.randomUUID() вместо Date.now() — при одновременных
  // запросах Date.now() мог совпасть и два tempPath оказывались идентичными.
  const tempPath = join(tmpdir(), `lifeos-conv-${crypto.randomUUID()}.${format}`);
  await writeFile(tempPath, buffer);

  try {
    const fileBuffer = await readFile(tempPath);
    const transcription: unknown = await groq.audio.transcriptions.create({
      file: new File([fileBuffer], `audio.${format}`, {
        type: format === 'm4a' ? 'audio/mp4' : `audio/${format}`,
      }),
      model: 'whisper-large-v3-turbo',
      language: 'ru',
      response_format: 'text',
    });

    return typeof transcription === 'string'
      ? transcription.trim()
      : String(transcription).trim();
  } finally {
    try { await unlink(tempPath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Start conversation session ---
  app.post('/voice/conversation/start', {
    preHandler: [conversationRateLimit, aiDailyLimiter],
  }, async (request, reply) => {
    const userId = request.userId;

    try {
      // Build full user context
      const context = await buildInitialContext(userId);
      if (!context) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // Generate greeting (null if not first session today)
      const greeting = await generateGreeting(userId, context);

      // Create conversation session
      const session = await prisma.conversationSession.create({
        data: {
          userId,
          contextSnapshot: JSON.parse(JSON.stringify(context)),
          status: 'active',
        },
      });

      return reply.send({
        sessionId: session.id,
        greeting: greeting?.text || null,
        suggestions: greeting?.suggestions || [],
        context: {
          tasksToday: context.todayTasks.length,
          tasksCompleted: context.todayTasks.filter((t) => t.completed).length,
          habitsTotal: context.activeHabits.length,
          habitsCompleted: context.completedHabitIds.length,
          spentThisMonth: context.spentThisMonth,
          budgetLimit: context.budgetLimit,
          currentStreak: context.currentStreak,
          weekProgress: context.weekProgress,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка создания сессии' });
    }
  });

  // --- Send audio message ---
  app.post('/voice/conversation/message', {
    bodyLimit: 10 * 1024 * 1024, // 10 MB for base64 audio
    preHandler: [audioRateLimit, aiDailyLimiter, validate(audioMessageSchema)],
  }, async (request, reply) => {
    const { sessionId, audio, format } = request.body as z.infer<typeof audioMessageSchema>;
    const userId = request.userId;

    try {
      // Verify session belongs to user and is active
      const session = await prisma.conversationSession.findFirst({
        where: { id: sessionId, userId, status: 'active' },
      });

      if (!session) {
        return reply.status(404).send({ message: 'Сессия не найдена или завершена' });
      }

      // Transcribe audio
      let text = '';
      try {
        text = await transcribeAudio(audio, format);
      } catch (err) {
        app.log.error(err, 'Audio transcription failed');
        return reply.send({
          text: '',
          message: 'Не удалось распознать речь. Говорите громче и ближе к микрофону.',
        });
      }

      if (!text) {
        return reply.send({
          text: '',
          message: 'Не удалось распознать речь. Говорите громче и ближе к микрофону.',
        });
      }

      // Единый мозг (web search + агентные инструменты + travel-
      // концьерж + память + подтверждения). pendingAction (деньги/
      // исходящее) отдаём текстом — юзер подтверждает «да»
      // следующим сообщением (pending-store оркестратора поймает).
      const jarvis = await handleMessage(userId, text);
      const response =
        jarvis.pendingAction && jarvis.confirmationText
          ? jarvis.confirmationText
          : jarvis.reply +
            (jarvis.bookingUrl ? `\n\n\u{1F517} ${jarvis.bookingUrl}` : '');

      return reply.send({
        transcription: text,
        response,
        // Контракт сохранён (массивы — массивы). Действия мозг уже
        // исполнил серверно (EXECUTABLE/подтверждение); клиенту
        // отдельные actions не нужны.
        actions: [],
        suggestions: [],
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки голосового сообщения' });
    }
  });

  // --- Send text message ---
  app.post('/voice/conversation/text', {
    preHandler: [conversationRateLimit, aiDailyLimiter, validate(textMessageSchema)],
  }, async (request, reply) => {
    const { sessionId, text } = request.body as z.infer<typeof textMessageSchema>;
    const userId = request.userId;

    try {
      // Verify session
      const session = await prisma.conversationSession.findFirst({
        where: { id: sessionId, userId, status: 'active' },
      });

      if (!session) {
        return reply.status(404).send({ message: 'Сессия не найдена или завершена' });
      }

      const jarvis = await handleMessage(userId, text);
      const response =
        jarvis.pendingAction && jarvis.confirmationText
          ? jarvis.confirmationText
          : jarvis.reply +
            (jarvis.bookingUrl ? `\n\n\u{1F517} ${jarvis.bookingUrl}` : '');

      return reply.send({
        response,
        actions: [],
        suggestions: [],
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки сообщения' });
    }
  });

  // --- End conversation session ---
  app.post('/voice/conversation/end', {
    preHandler: [validate(endSchema)],
  }, async (request, reply) => {
    const { sessionId } = request.body as z.infer<typeof endSchema>;
    const userId = request.userId;

    try {
      const session = await prisma.conversationSession.findFirst({
        where: { id: sessionId, userId, status: 'active' },
      });

      if (!session) {
        return reply.status(404).send({ message: 'Сессия не найдена или уже завершена' });
      }

      await prisma.conversationSession.update({
        where: { id: sessionId },
        data: { status: 'ended', endedAt: new Date() },
      });

      return reply.send({ success: true, message: 'Сессия завершена' });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка завершения сессии' });
    }
  });
}
