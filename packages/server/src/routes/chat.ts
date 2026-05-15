import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  buildAssistantPrompt,
  type AssistantContext,
} from '../ai/assistant-personality.js';
import {
  calculateStreak,
  calculateWeekProgress,
} from '../services/streak-service.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { getRelevantMemories } from '../services/memory-service.js';
import { handleMessage } from '../services/jarvis-orchestrator.js';

// AI chat is expensive (Claude API + web search) — limit per minute and per hour
const chatRateLimit = rateLimiter({ max: 20, windowMs: 60_000, keyPrefix: 'ai-chat' });

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

// --- Web Search via DuckDuckGo HTML (free, no API key) ---
async function webSearch(query: string, maxResults = 5): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LifeOS/1.0)',
      },
    });
    const html = await resp.text();
    const $ = cheerio.load(html);
    const results: string[] = [];

    $('.result').each((i, el) => {
      if (i >= maxResults) return false;
      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      if (title && snippet) {
        results.push(`${title}: ${snippet}`);
      }
    });

    if (results.length === 0) {
      return 'Поиск не дал результатов.';
    }

    return results.join('\n\n');
  } catch (err) {
    console.error('Web search error:', err);
    return 'Не удалось выполнить поиск.';
  }
}

const chatSchema = z.object({
  // Cap protects Claude billing: 4000 chars ≈ 1000 tokens на запрос юзера —
  // больше не имеет смысла для диалога (модель усечёт контекст).
  text: z.string().min(1, 'Текст обязателен').max(4000, 'Сообщение слишком длинное'),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ParsedAction {
  type: string;
  data: Record<string, unknown>;
}

// БЕЗОПАСНОСТЬ: лимит количества actions в одном ответе AI.
// Защита от prompt-injection, заставляющего AI спамить операциями.
const MAX_ACTIONS_PER_RESPONSE = 5;

// Zod-схемы для каждого типа action — валидируем ВСЕ поля перед выполнением.
// Это закрывает дыру: даже если LLM (или промпт-инъекция) сгенерирует мусор,
// в БД ничего вредного не попадёт.
const ACTION_SCHEMAS = {
  create_task: z.object({
    title: z.string().min(1).max(200),
    category: z.string().max(50).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }),
  add_expense: z.object({
    amount: z.number().positive().max(1_000_000_000),
    category: z.string().max(50).optional(),
    description: z.string().max(500).optional(),
  }),
  add_income: z.object({
    amount: z.number().positive().max(1_000_000_000),
    source: z.string().max(100).optional(),
  }),
  complete_task: z.object({
    title: z.string().min(1).max(200),
  }),
  complete_habit: z.object({
    name: z.string().min(1).max(100),
  }),
  create_event: z.object({
    title: z.string().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
} as const;

function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  // Безопасный non-greedy regex с ограничением длины JSON-блока (защита от ReDoS)
  const actionRegex = /\[ACTION:(\w{1,32}):(\{[^}]{0,2000}\})\]/g;
  const actions: ParsedAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(text)) !== null) {
    if (actions.length >= MAX_ACTIONS_PER_RESPONSE) break;
    try {
      const data = JSON.parse(match[2]) as Record<string, unknown>;
      const type = match[1];

      // Валидация через Zod — отбрасываем неизвестные/невалидные actions
      const schema = (ACTION_SCHEMAS as Record<string, z.ZodTypeAny>)[type];
      if (!schema) continue;

      const result = schema.safeParse(data);
      if (!result.success) continue;

      actions.push({ type, data: result.data });
    } catch {
      // Skip malformed actions
    }
  }

  const cleanText = text.replace(actionRegex, '').trim();

  return { cleanText, actions };
}

// Strip all markdown formatting from response text
function stripMarkdown(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/^\d+\.\s+/gm, '');
  result = result.replace(/```[\s\S]*?```/g, '');
  result = result.replace(/`(.+?)`/g, '$1');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// Detect topic from user message for interest tracking
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'спорт': ['тренировк', 'упражнени', 'фитнес', 'бицепс', 'трицепс', 'мышц', 'зал', 'бег', 'йога', 'спорт', 'пресс', 'жим', 'присед', 'кардио', 'растяжк'],
  'инвестиции': ['инвестиц', 'акци', 'крипто', 'биткоин', 'портфел', 'дивиденд', 'фондов', 'брокер', 'трейдинг', 'золото', 'облигац'],
  'кулинария': ['рецепт', 'приготов', 'блюд', 'кухн', 'еда', 'ужин', 'обед', 'завтрак', 'курица', 'мясо', 'суп', 'салат', 'выпечк', 'кушать', 'покушать'],
  'здоровье': ['здоров', 'витамин', 'сон', 'стресс', 'медитац', 'давлен', 'головн', 'болит', 'лекарств', 'диет', 'калори', 'вес'],
  'технологии': ['программ', 'код', 'разработ', 'приложени', 'сайт', 'javascript', 'python', 'react', 'api', 'баг', 'софт', 'гаджет'],
  'бизнес': ['бизнес', 'стартап', 'маркетинг', 'продаж', 'клиент', 'прибыл', 'доход', 'компани', 'предприниматель'],
  'путешествия': ['путешеств', 'поездк', 'виз', 'отпуск', 'перелёт', 'отель', 'страна', 'город', 'билет', 'туризм'],
  'образование': ['учёб', 'учеб', 'экзамен', 'язык', 'курс', 'книг', 'читать', 'наука', 'истори', 'философ', 'математик'],
  'развлечения': ['фильм', 'сериал', 'музык', 'игр', 'кино', 'netflix', 'youtube', 'подкаст', 'аниме'],
};

function detectTopics(message: string): string[] {
  const lower = message.toLowerCase();
  const detected: string[] = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      detected.push(topic);
    }
  }
  return detected;
}

// Track user interests in DB
async function trackInterests(userId: string, topics: string[]): Promise<void> {
  for (const topic of topics) {
    await prisma.userInterest.upsert({
      where: { userId_topic: { userId, topic } },
      update: {
        score: { increment: 1 },
        lastMentioned: new Date(),
      },
      create: {
        userId,
        topic,
        score: 1,
      },
    });
  }
}

// Execute parsed actions
async function executeActions(userId: string, actions: ParsedAction[]): Promise<string[]> {
  const results: string[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'create_task': {
          const title = String(action.data.title || '');
          const category = String(action.data.category || 'general');
          const dateStr = String(action.data.date || new Date().toISOString().split('T')[0]);
          const priority = String(action.data.priority || 'medium');

          if (title) {
            const task = await prisma.task.create({
              data: {
                userId,
                title,
                category,
                priority,
                date: new Date(dateStr),
              },
            });
            results.push(`Задача "${title}" создана на ${dateStr}`);
          }
          break;
        }

        case 'add_expense': {
          const amount = Number(action.data.amount || 0);
          const category = String(action.data.category || 'other');
          const description = String(action.data.description || '');

          if (amount > 0) {
            await prisma.expense.create({
              data: {
                userId,
                amount,
                category,
                description,
                date: new Date(),
              },
            });
            results.push(`Расход ${amount}₸ записан (${description})`);
          }
          break;
        }

        case 'add_income': {
          const amount = Number(action.data.amount || 0);
          const source = String(action.data.source || 'other');

          if (amount > 0) {
            await prisma.income.create({
              data: {
                userId,
                amount,
                source,
                date: new Date(),
              },
            });
            results.push(`Доход ${amount}₸ записан (${source})`);
          }
          break;
        }

        case 'complete_task': {
          const taskTitle = String(action.data.title || '');
          if (taskTitle) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const task = await prisma.task.findFirst({
              where: {
                userId,
                title: { contains: taskTitle, mode: 'insensitive' },
                date: today,
                completed: false,
              },
            });
            if (task) {
              await prisma.task.update({
                where: { id: task.id },
                data: { completed: true },
              });
              results.push(`Задача "${task.title}" выполнена`);
            }
          }
          break;
        }

        case 'complete_habit': {
          const habitName = String(action.data.name || '');
          if (habitName) {
            const habit = await prisma.habit.findFirst({
              where: {
                userId,
                name: { contains: habitName, mode: 'insensitive' },
                active: true,
              },
            });
            if (habit) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              await prisma.habitLog.upsert({
                where: { habitId_date: { habitId: habit.id, date: today } },
                update: { completed: true },
                create: {
                  habitId: habit.id,
                  userId,
                  date: today,
                  completed: true,
                },
              });
              results.push(`Привычка "${habit.name}" отмечена`);
            }
          }
          break;
        }

        case 'create_event': {
          const title = String(action.data.title || '');
          const dateStr = String(action.data.date || new Date().toISOString().split('T')[0]);
          const startTime = action.data.time ? String(action.data.time) : null;

          if (title) {
            await prisma.calendarEvent.create({
              data: {
                userId,
                title,
                date: new Date(dateStr),
                startTime,
              },
            });
            results.push(`Событие "${title}" создано на ${dateStr}${startTime ? ` в ${startTime}` : ''}`);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`Failed to execute action ${action.type}:`, err);
    }
  }

  return results;
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
    const { text } = request.body as z.infer<typeof chatSchema>;
    try {
      const res = await handleMessage(request.userId, text);
      let message = res.reply;
      if (res.bookingUrl) message += `\n\n\u{1F517} ${res.bookingUrl}`;
      const cap: string[] = [];
      if (res.capturedTasks) cap.push(`\u{1F4DD} +${res.capturedTasks} \u0432 \u0437\u0430\u0434\u0430\u0447\u0438`);
      if (res.capturedMemories) cap.push('\u{1F9E0} \u0437\u0430\u043f\u043e\u043c\u043d\u0438\u043b');
      if (cap.length > 0) message += `\n\n\u2014 ${cap.join(' \u00b7 ')}`;
      return reply.send({ message, intent: res.intent });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ message: 'Ошибка обработки чата' });
    }
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

// calculateStreak + calculateWeekProgress moved to ../services/streak-service
