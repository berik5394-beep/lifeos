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
// SSOT 9B.3: conversation-engine.ts удалён целиком (мёртвый
// processConversationMessage + дублирующий контекст/приветствие).
// Диалог идёт через единый оркестратор (тот же мозг, что чат/
// Telegram/voice): единый промт, агентные инструменты, travel-
// концьерж, подтверждения, память. /start-приветствие —
// детерминированное, на едином AssistantContext
// (gatherAssistantContext + buildStartGreeting). Контракт ответа
// {response, actions, suggestions} / {sessionId, greeting, ...}
// сохранён байт-в-байт.
import { handleMessage } from '../services/jarvis-orchestrator.js';
import { gatherAssistantContext } from '../services/assistant-service.js';
import { buildStartGreeting } from '../services/conversation-greeting.js';

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
      // Единый контекст (тот же, что весь мозг). Пустой text —
      // /start ничего не «спрашивает», только собирает контекст.
      const gathered = await gatherAssistantContext(userId, '');
      if (!gathered) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // Первая ли это сессия за сегодня — гейт приветствия (1:1 с
      // прежним generateGreeting: не первая → greeting = null).
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const existingSession = await prisma.conversationSession.findFirst({
        where: { userId, createdAt: { gte: today, lt: tomorrow } },
        select: { id: true },
      });

      const greeting = buildStartGreeting(gathered, !existingSession);

      const session = await prisma.conversationSession.create({
        data: {
          userId,
          // contextSnapshot нигде не читается — храним лёгкий
          // снимок counts (аудит/дебаг), не тяжёлый UserContext.
          contextSnapshot: JSON.parse(JSON.stringify(gathered.counts)),
          status: 'active',
        },
      });

      return reply.send({
        sessionId: session.id,
        greeting: greeting?.text || null,
        suggestions: greeting?.suggestions || [],
        context: gathered.counts,
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
      // ISSUE-4: это голосовой роут (аудио→Whisper) → channel:'voice'
      // (краткий TTS-режим). Текстовый роут ниже — без флага.
      const jarvis = await handleMessage(userId, text, 'voice');
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
