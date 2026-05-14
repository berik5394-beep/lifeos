import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { AiModelError } from '../lib/errors.js';

// Диктофон — самая дорогая фича: Whisper STT + Claude extraction. Жёсткий cap.
const dictationRateLimit = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'dictation' });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

// Аудио до ~7MB raw (10MB base64). Поверх есть bodyLimit на роуте.
const processSchema = z.object({
  audio: z.string().min(1, 'Audio data обязателен').max(15_000_000),
  format: z.string().max(8).default('m4a'),
  durationSeconds: z.number().int().nonnegative().optional(),
});

const memoryListSchema = z.object({
  type: z.string().max(32).optional(),
  tag: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const memoryCreateSchema = z.object({
  type: z.enum(['fact', 'decision', 'event', 'person', 'place', 'preference', 'emotion']),
  content: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
  tags: z.array(z.string().max(32)).max(10).default([]),
  importance: z.number().int().min(1).max(10).default(5),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

interface ExtractedTask {
  title: string;
  date?: string;
  time?: string;
  category?: string;
  priority?: string;
  notes?: string;
}

interface ExtractedMemory {
  type: 'fact' | 'decision' | 'event' | 'person' | 'place' | 'preference' | 'emotion';
  content: string;
  details?: string;
  tags?: string[];
  importance?: number;
}

interface DictationExtraction {
  summary: string;
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  spokenResponse: string;
}

/**
 * Полный пайплайн: base64 audio → Whisper (Groq) → Claude extraction.
 * Возвращает структурированные задачи + воспоминания + что сказать вслух.
 */
async function transcribeAudio(audioB64: string, format: string): Promise<string> {
  // Сохраняем во временный файл — Groq SDK требует File-like object.
  const tmp = join(tmpdir(), `dictation-${crypto.randomUUID()}.${format}`);
  await writeFile(tmp, Buffer.from(audioB64, 'base64'));
  try {
    const { createReadStream } = await import('fs');
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmp) as unknown as File,
      model: 'whisper-large-v3',
      language: 'ru',
      response_format: 'text',
    });
    // Groq возвращает либо string, либо { text }.
    return typeof transcription === 'string'
      ? transcription
      : (transcription as { text?: string }).text || '';
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

async function extractFromTranscript(
  transcript: string,
  userName: string,
): Promise<DictationExtraction> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const systemPrompt = `Ты — JARVIS-помощник пользователя ${userName}. Юзер только что наговорил тебе свободную речь через диктофон. Твоя задача — извлечь оттуда самое важное и вернуть структурированный JSON.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

Верни ТОЛЬКО валидный JSON без markdown, такого формата:
{
  "summary": "1-3 предложения краткой сводки что было сказано",
  "tasks": [
    { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM или null", "category": "work|personal|health|finance|education|home", "priority": "low|medium|high|critical", "notes": "опц." }
  ],
  "memories": [
    { "type": "fact|decision|event|person|place|preference|emotion", "content": "короткая суть", "details": "опц.", "tags": ["..."], "importance": 1-10 }
  ],
  "spokenResponse": "Что ассистент скажет юзеру вслух — короткое подтверждение, 1-2 предложения, тёплый дружеский тон"
}

Правила извлечения:
1. **tasks** — только явные действия ("надо позвонить маме", "купить продукты"). Не выдумывай. Дата — если не указана, ставь сегодня. Категория — выбери логичную, по умолчанию "personal".
2. **memories** — извлекай разные типы:
   - **fact** — факт о ком-то/чём-то ("Серик переехал в Астану", "У мамы день рождения 15 марта")
   - **decision** — принятое решение ("Решили встретиться в субботу")
   - **event** — событие в прошлом ("Был на встрече с инвестором")
   - **person** — упоминание человека впервые ("Познакомился с Айгерим")
   - **place** — место ("Хорошее кафе на Розыбакиева")
   - **preference** — предпочтение юзера ("Не люблю острое")
   - **emotion** — эмоциональное состояние ("Чувствую тревогу из-за работы")
3. **importance** — 1-3 мелочь, 4-6 средне, 7-10 важно (семья, здоровье, большие решения).
4. **summary** — 1-3 предложения. Без воды.
5. **spokenResponse** — что ассистент скажет в ответ. ТЁПЛО, кратко, по-человечески. Например: "Записал. Создал 2 задачи, запомнил про Серика. Что-то ещё?". НЕ цитируй юзера, не повторяй детально.
6. Если транскрипт пустой/мусор/неразборчивый — возвращай пустые arrays и summary="Не разобрал, попробуй ещё раз", spokenResponse="Не разобрал, давай ещё раз?".`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: transcript }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }

  // Strip потенциальный markdown wrapper
  let text = content.text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  try {
    return JSON.parse(text) as DictationExtraction;
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function dictationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /dictation/process — главная фича: диктофон → задачи + память.
  // Принимает base64 аудио, возвращает извлечённое + сохраняет в БД.
  app.post(
    '/dictation/process',
    {
      bodyLimit: 20 * 1024 * 1024, // 20MB — base64 аудио до ~14MB raw
      preHandler: [dictationRateLimit, aiDailyLimiter, validate(processSchema)],
    },
    async (request, reply) => {
      const { audio, format, durationSeconds } = request.body as z.infer<typeof processSchema>;
      const userId = request.userId;

      // 1. Транскрипция через Whisper
      const transcript = await transcribeAudio(audio, format);
      if (!transcript || transcript.trim().length < 3) {
        const session = await prisma.dictationSession.create({
          data: {
            userId,
            transcript: transcript || '',
            summary: 'Пустая запись',
            spokenResponse: 'Я ничего не услышал. Попробуй ещё раз?',
            tasksCreated: 0,
            memoriesCreated: 0,
            durationSeconds: durationSeconds ?? null,
          },
        });
        return reply.send({
          sessionId: session.id,
          transcript: '',
          summary: 'Пустая запись',
          spokenResponse: 'Я ничего не услышал. Попробуй ещё раз?',
          tasksCreated: [],
          memoriesCreated: [],
        });
      }

      // 2. Имя юзера для персонализации промпта
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      // 3. Claude extraction
      const extracted = await extractFromTranscript(transcript, user?.name || 'друг');

      // 4. Атомарная запись: сессия + задачи + memories
      const result = await prisma.$transaction(async (tx) => {
        const session = await tx.dictationSession.create({
          data: {
            userId,
            transcript,
            summary: extracted.summary,
            spokenResponse: extracted.spokenResponse,
            tasksCreated: extracted.tasks.length,
            memoriesCreated: extracted.memories.length,
            durationSeconds: durationSeconds ?? null,
          },
        });

        const createdTasks = await Promise.all(
          extracted.tasks.map((t) =>
            tx.task.create({
              data: {
                userId,
                title: t.title.slice(0, 500),
                category: (t.category || 'personal').slice(0, 32),
                priority: (t.priority || 'medium').slice(0, 32),
                date: new Date((t.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
                time: t.time?.slice(0, 8) ?? null,
                notes: t.notes?.slice(0, 2000) ?? null,
              },
            }),
          ),
        );

        const createdMemories = await Promise.all(
          extracted.memories.map((m) =>
            tx.memory.create({
              data: {
                userId,
                type: m.type,
                content: m.content.slice(0, 500),
                details: m.details?.slice(0, 2000) ?? null,
                source: 'dictation',
                sourceId: session.id,
                tags: (m.tags || []).slice(0, 10).map((t) => t.slice(0, 32)),
                importance: m.importance ?? 5,
              },
            }),
          ),
        );

        return { session, createdTasks, createdMemories };
      });

      return reply.send({
        sessionId: result.session.id,
        transcript,
        summary: extracted.summary,
        spokenResponse: extracted.spokenResponse,
        tasksCreated: result.createdTasks,
        memoriesCreated: result.createdMemories,
      });
    },
  );

  // GET /dictation/history — последние сессии
  app.get('/dictation/history', async (request) => {
    const sessions = await prisma.dictationSession.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return sessions;
  });

  // GET /memory — список воспоминаний с фильтрами
  app.get('/memory', { preHandler: validate(memoryListSchema, 'query') }, async (request) => {
    const { type, tag, limit } = request.query as z.infer<typeof memoryListSchema>;
    const now = new Date();
    const memories = await prisma.memory.findMany({
      where: {
        userId: request.userId,
        ...(type ? { type } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return memories;
  });

  // POST /memory — добавить вручную (например из чата или кнопки)
  app.post('/memory', { preHandler: validate(memoryCreateSchema) }, async (request, reply) => {
    const data = request.body as z.infer<typeof memoryCreateSchema>;
    const memory = await prisma.memory.create({
      data: {
        userId: request.userId,
        type: data.type,
        content: data.content,
        details: data.details ?? null,
        source: 'manual',
        tags: data.tags,
        importance: data.importance,
        expiresAt: data.expiresAt ? new Date(data.expiresAt + 'T00:00:00Z') : null,
      },
    });
    return reply.status(201).send(memory);
  });

  // DELETE /memory/:id
  app.delete('/memory/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await prisma.memory.deleteMany({
      where: { id, userId: request.userId },
    });
    if (deleted.count === 0) {
      return reply.status(404).send({ message: 'Воспоминание не найдено' });
    }
    return reply.send({ ok: true });
  });

  // POST /memory/search — текстовый поиск (Фаза 2 заменит на vector search).
  // Сейчас — простой case-insensitive LIKE по content+details+tags.
  app.post(
    '/memory/search',
    { preHandler: [aiDailyLimiter, validate(searchSchema)] },
    async (request) => {
      const { query, limit } = request.body as z.infer<typeof searchSchema>;
      const now = new Date();
      const memories = await prisma.memory.findMany({
        where: {
          userId: request.userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [
            {
              OR: [
                { content: { contains: query, mode: 'insensitive' } },
                { details: { contains: query, mode: 'insensitive' } },
                { tags: { has: query.toLowerCase() } },
              ],
            },
          ],
        },
        orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
      return memories;
    },
  );
}
