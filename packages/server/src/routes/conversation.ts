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
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Groq from 'groq-sdk';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import {
  buildInitialContext,
  processConversationMessage,
  generateGreeting,
} from '../services/conversation-engine.js';

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
  sessionId: z.string().min(1, 'sessionId обязателен'),
  text: z.string().min(1, 'Текст обязателен'),
});

const audioMessageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId обязателен'),
  audio: z.string().min(1, 'Audio data обязателен'),
  format: z.string().default('m4a'),
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

  const tempPath = join(tmpdir(), `lifeos-conv-${Date.now()}.${format}`);
  writeFileSync(tempPath, buffer);

  try {
    const transcription: unknown = await groq.audio.transcriptions.create({
      file: new File([readFileSync(tempPath)], `audio.${format}`, {
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
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Start conversation session ---
  app.post('/voice/conversation/start', {
    preHandler: [conversationRateLimit],
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
    preHandler: [audioRateLimit, validate(audioMessageSchema)],
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

      // Build fresh context (actions may have changed state)
      const context = await buildInitialContext(userId);
      if (!context) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // Process through conversation engine
      const result = await processConversationMessage(userId, sessionId, text, context);

      return reply.send({
        transcription: text,
        response: result.text,
        actions: result.actions,
        suggestions: result.suggestions,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки голосового сообщения' });
    }
  });

  // --- Send text message ---
  app.post('/voice/conversation/text', {
    preHandler: [conversationRateLimit, validate(textMessageSchema)],
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

      // Build fresh context
      const context = await buildInitialContext(userId);
      if (!context) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // Process
      const result = await processConversationMessage(userId, sessionId, text, context);

      return reply.send({
        response: result.text,
        actions: result.actions,
        suggestions: result.suggestions,
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
