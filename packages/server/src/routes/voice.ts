import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'node:crypto';
import Groq from 'groq-sdk';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { processVoiceCommand } from '../ai/voice-pipeline.js';
import { prisma } from '../lib/prisma.js';
import {
  calculateStreak,
  calculateWeekProgress,
} from '../services/streak-service.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
// Phase 1.1 (дозакрытие): /voice/assistant раньше был ВТОРЫМ мозгом —
// свой контекст, свой промпт (assistant-personality), прямой Claude
// БЕЗ памяти-дедупа/web_search/инструментов/подтверждений/логов.
// Теперь ответ идёт через единый оркестратор. Контракт ответа
// ({response, reply, context}) сохранён — старое приложение не ломается.
import { handleMessage } from '../services/jarvis-orchestrator.js';

// Voice assistant/transcribe are expensive (Groq Whisper + Claude API) — cap per IP
const assistantRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'voice-assistant' });
const transcribeRateLimit = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'voice-transcribe' });
const processRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'voice-process' });

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
});

const voiceSchema = z.object({
  // Cap protects Claude billing: 2000 chars ≈ 500 tokens — больше для голосовой
  // команды бессмысленно, но без потолка баг-цикл клиента может слать 1MB.
  text: z.string().min(1, 'Текст обязателен').max(2000, 'Текст слишком длинный'),
});

interface AssistantResponseContext {
  tasksToday: number;
  tasksCompleted: number;
  habitsTotal: number;
  habitsCompleted: number;
  spentThisMonth: number;
  budgetLimit: number;
  currentStreak: number;
  weekProgress: number;
  assistantGender: string;
  wakeUpTime: string;
}

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post('/voice/process', {
    preHandler: [processRateLimit, aiDailyLimiter, validate(voiceSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;

    try {
      const result = await processVoiceCommand(text);
      return reply.send(result);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки голосовой команды',
      });
    }
  });

  app.post('/voice/assistant', {
    preHandler: [assistantRateLimit, aiDailyLimiter, validate(voiceSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;
    const userId = request.userId;

    try {
      // 1. Get user from DB
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          assistantStyle: true,
          assistantGender: true,
          wakeUpTime: true,
          currency: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // 2. Get today's tasks
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayTasks = await prisma.task.findMany({
        where: {
          userId,
          date: today,
        },
        select: {
          title: true,
          completed: true,
        },
      });

      // 3. Get today's habit logs + total active habits
      const activeHabits = await prisma.habit.findMany({
        where: { userId, active: true },
        select: { id: true },
      });

      const todayHabitLogs = await prisma.habitLog.findMany({
        where: {
          userId,
          date: today,
          completed: true,
        },
        select: { id: true },
      });

      const habitsProgress = {
        total: activeHabits.length,
        completed: todayHabitLogs.length,
      };

      // Get this month's expense total + budget limits sum (для context,
      // который мобилка показывает на экране ассистента)
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const expenseAgg = await prisma.expense.aggregate({
        where: {
          userId,
          date: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
        _sum: { amount: true },
      });

      const budgetAgg = await prisma.budgetLimit.aggregate({
        where: {
          userId,
          month: today.getMonth() + 1,
          year: today.getFullYear(),
        },
        _sum: { monthlyLimit: true },
      });

      const spentThisMonth = expenseAgg._sum.amount ?? 0;
      const budgetLimit = budgetAgg._sum.monthlyLimit ?? 0;

      // Streak / week progress — для context (экран ассистента)
      const currentStreak = await calculateStreak(userId);
      const weekProgress = await calculateWeekProgress(userId, today);

      // ЕДИНЫЙ МОЗГ: ответ генерит оркестратор (память+дедуп+семантика,
      // web_search, агентные инструменты, gate подтверждений, decision
      // logs, стиль ассистента, утро/вечер/ночь — всё там). Раньше тут
      // был параллельный второй мозг с собственным промптом и прямым
      // Claude — это и была headline-проблема плана (Столп 1).
      const jarvis = await handleMessage(userId, text);
      let responseText = jarvis.reply;
      // Денежное/исходящее действие ждёт подтверждения — мобилка этого
      // экрана не знает про pendingAction, поэтому добавляем понятную
      // приписку (подтвердить можно ответив «да» следующим сообщением —
      // оркестратор это поймает по pending-store).
      if (jarvis.pendingAction && jarvis.confirmationText) {
        responseText = jarvis.confirmationText;
      }

      // Return response with context
      const responseContext: AssistantResponseContext = {
        tasksToday: todayTasks.length,
        tasksCompleted: todayTasks.filter((t) => t.completed).length,
        habitsTotal: habitsProgress.total,
        habitsCompleted: habitsProgress.completed,
        spentThisMonth,
        budgetLimit,
        currentStreak,
        weekProgress,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      };

      return reply.send({
        response: responseText,
        reply: responseText, // alias — mobile clients read `.reply`
        context: responseContext,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки запроса ассистента',
      });
    }
  });

  // --- Voice Transcription (Speech-to-Text via Groq Whisper) ---

  const transcribeSchema = z.object({
    // Base64 аудио до ~7MB (10MB после base64 + header). bodyLimit уже стоит,
    // но дублируем здесь как defense-in-depth.
    audio: z.string().min(1, 'Audio data обязателен').max(10_000_000, 'Аудио слишком большое'),
    format: z.string().default('m4a'),
  });

  app.post('/voice/transcribe', {
    bodyLimit: 10 * 1024 * 1024, // 10 MB для голосовых записей в base64
    preHandler: [transcribeRateLimit, aiDailyLimiter, validate(transcribeSchema)],
  }, async (request, reply) => {
    const { audio, format } = request.body as z.infer<typeof transcribeSchema>;

    try {
      // 1. Decode base64 audio to temp file
      const buffer = Buffer.from(audio, 'base64');

      if (buffer.length < 100) {
        return reply.send({ text: '', message: 'Аудио слишком короткое' });
      }

      // Раньше writeFileSync/readFileSync — блокируют event loop на десятки мс
      // для m4a/wav. Несколько параллельных голосовых запросов морозили весь
      // сервер. fs/promises использует libuv thread pool, event loop свободен.
      // crypto.randomUUID() чтобы параллельные запросы не коллидили Date.now().
      const tempPath = join(tmpdir(), `lifeos-voice-${crypto.randomUUID()}.${format}`);
      await writeFile(tempPath, buffer);

      let text = '';
      let lastError = '';

      app.log.info(`Voice transcribe: received ${buffer.length} bytes, format=${format}`);

      // Try Groq Whisper first
      if (process.env.GROQ_API_KEY) {
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

          text = typeof transcription === 'string'
            ? transcription.trim()
            : String(transcription).trim();

          app.log.info(`Groq Whisper transcribed: ${text.length} chars`);
        } catch (groqErr: any) {
          lastError = groqErr?.message || String(groqErr);
          app.log.error(`Groq Whisper failed: ${lastError}`);
        }
      } else {
        lastError = 'GROQ_API_KEY not set';
        app.log.error(lastError);
      }

      // Clean up temp file
      try { await unlink(tempPath); } catch {}

      if (!text) {
        // БЕЗОПАСНОСТЬ: lastError может содержать сырые сообщения от Groq API
        // (включая фрагменты ключей или внутренние пути). Логируем детально, шлём generic.
        if (lastError) {
          app.log.error({ lastError }, 'Voice transcription failed');
        }
        return reply.send({
          text: '',
          message: 'Не удалось распознать речь. Говорите громче и ближе к микрофону.',
        });
      }

      return reply.send({ text });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка транскрипции аудио',
      });
    }
  });
}

// calculateStreak + calculateWeekProgress moved to ../services/streak-service
