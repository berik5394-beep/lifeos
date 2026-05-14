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

  app.post('/voice/chat', {
    preHandler: [chatRateLimit, aiDailyLimiter, validate(chatSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof chatSchema>;
    const userId = request.userId;

    try {
      // 1. Get user
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          assistantStyle: true,
          assistantGender: true,
          currency: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // 2. Track user interests from message
      const detectedTopics = detectTopics(text);
      if (detectedTopics.length > 0) {
        await trackInterests(userId, detectedTopics);
      }

      // 3. Get user's top interests
      const topInterests = await prisma.userInterest.findMany({
        where: { userId },
        orderBy: { score: 'desc' },
        take: 5,
      });

      // 4. Get last 2 messages ONLY (1 user + 1 assistant) to avoid topic mixing
      const recentMessages = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: {
          role: true,
          content: true,
        },
      });

      // Only include history if the last exchange is clearly related to current question
      // For now, keep minimal context
      const conversationHistory = recentMessages.reverse();

      // 5. Build full user context
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const [
        todayTasks,
        activeHabits,
        todayHabitLogs,
        upcomingEvents,
        expenseAgg,
        budgetAgg,
        yearlyGoals,
      ] = await Promise.all([
        prisma.task.findMany({
          where: { userId, date: today },
          select: { title: true, completed: true },
        }),
        prisma.habit.findMany({
          where: { userId, active: true },
          select: { id: true },
        }),
        prisma.habitLog.findMany({
          where: { userId, date: today, completed: true },
          select: { id: true },
        }),
        prisma.calendarEvent.findMany({
          where: {
            userId,
            date: { gte: today, lt: tomorrow },
          },
          select: { title: true, startTime: true, date: true },
          orderBy: { startTime: 'asc' },
        }),
        prisma.expense.aggregate({
          where: { userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
        prisma.budgetLimit.aggregate({
          where: {
            userId,
            month: today.getMonth() + 1,
            year: today.getFullYear(),
          },
          _sum: { monthlyLimit: true },
        }),
        prisma.yearlyGoal.findMany({
          where: { userId, year: today.getFullYear() },
          select: { area: true, goalText: true, progress: true },
        }),
      ]);

      const spentThisMonth = expenseAgg._sum.amount ?? 0;
      const budgetLimit = budgetAgg._sum.monthlyLimit ?? 0;

      const currentStreak = await calculateStreak(userId);
      const weekProgress = await calculateWeekProgress(userId, today);

      const yearlyGoalsSummary = yearlyGoals.length > 0
        ? yearlyGoals.map((g) => `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`).join('; ')
        : 'Не заданы';

      // JARVIS long-term memory: query-aware retrieval (Фаза 2a).
      // Текст пользователя передаём как query → Postgres FTS вытащит
      // релевантные памяти (про Серика, маму, спорт и т.д.) с приоритетом
      // совпадений, fallback на importance.
      const memories = await getRelevantMemories(userId, text, 20);

      const context: AssistantContext = {
        userName: user.name,
        assistantStyle: user.assistantStyle as 'friendly' | 'strict' | 'calm' | 'toxic',
        assistantGender: user.assistantGender,
        todayTasks: todayTasks.map((t) => ({ title: t.title, completed: t.completed })),
        habitsProgress: {
          total: activeHabits.length,
          completed: todayHabitLogs.length,
        },
        upcomingEvents: upcomingEvents.map((e) => ({
          title: e.title,
          startTime: e.startTime,
          date: e.date.toISOString().split('T')[0],
        })),
        spentThisMonth,
        budgetLimit,
        currentStreak,
        weekProgress,
        yearlyGoalsSummary,
        memories,
      };

      // 6. Build system prompt with interests + chat rules
      const basePrompt = buildAssistantPrompt(context);

      const interestsBlock = topInterests.length > 0
        ? `\nИНТЕРЕСЫ ПОЛЬЗОВАТЕЛЯ (по частоте обращений): ${topInterests.map(i => `${i.topic} (${Math.round(i.score)} раз)`).join(', ')}. Учитывай эти интересы, когда они релевантны.`
        : '';

      const chatPrompt = `${basePrompt}${interestsBlock}

ПРАВИЛА ДЕЙСТВИЙ В ЧАТЕ:
Если пользователь ЯВНО просит создать задачу, записать расход, создать событие и т.д. — добавь в конец ответа ACTION-тег.
Формат: [ACTION:тип:{"ключ":"значение"}]
Возможные типы: create_task, complete_task, complete_habit, add_expense, add_income, create_event
Примеры:
[ACTION:create_task:{"title":"Купить продукты","date":"2026-04-08","category":"shopping","priority":"medium"}]
[ACTION:add_expense:{"amount":5000,"category":"food","description":"Обед в кафе"}]
[ACTION:create_event:{"title":"Встреча с Асланом","date":"2026-04-08","time":"15:00"}]
[ACTION:complete_habit:{"name":"Зарядка"}]
Добавляй ACTION ТОЛЬКО при явной просьбе. Никогда не предлагай создать задачу, если не просили.

КОНТЕКСТ ДИАЛОГА: отвечай СТРОГО на последнее сообщение. Каждый вопрос — независимый.

ФОРМАТ: это мобильный чат. Пиши plain text без markdown. Без ** * ## нумерации списков. Максимум 5 предложений.`;

      // 7. Send to Claude API with web_search tool
      // IMPORTANT: Send ONLY the current message to avoid topic mixing
      // Previous context is in system prompt via user data
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: text },
      ];

      const tools: Anthropic.Tool[] = [
        {
          name: 'web_search',
          description:
            'Поиск актуальной информации в интернете. ИСПОЛЬЗУЙ АКТИВНО когда: ' +
            '(1) пользователь задаёт вопрос о фактах, которых ты не знаешь точно; ' +
            '(2) нужны текущие данные — цены, курсы, новости, события; ' +
            '(3) вопрос о рецептах, калорийности, составе продуктов; ' +
            '(4) советы по спорту, тренировкам, технике упражнений; ' +
            '(5) советы по финансам, инвестициям, экономии; ' +
            '(6) мотивация, цитаты, научные исследования; ' +
            '(7) организация времени, продуктивность, методики; ' +
            '(8) пользователь явно просит "найди", "поищи", "узнай". ' +
            'Предпочитай искать, а не гадать.',
          input_schema: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string',
                description: 'Поисковый запрос. Формулируй на том языке, на котором скорее найдётся ответ.',
              },
            },
            required: ['query'],
          },
        },
      ];

      // Multi-turn tool-use loop: Claude can call web_search up to N times
      // before producing the final answer. Prevents one-shot limitation
      // where a follow-up search would help.
      const MAX_TOOL_TURNS = 3;
      const conversation: Anthropic.MessageParam[] = [...messages];
      let rawResponseText = '';
      let turns = 0;

      while (turns < MAX_TOOL_TURNS) {
        const aiResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: chatPrompt,
          messages: conversation,
          tools,
        });

        if (aiResponse.stop_reason !== 'tool_use') {
          const textBlock = aiResponse.content.find(
            (b): b is Anthropic.TextBlock => b.type === 'text'
          );
          rawResponseText = textBlock?.text || 'Не удалось сформировать ответ.';
          break;
        }

        // Collect ALL tool_use blocks in this turn and run them
        const toolUseBlocks = aiResponse.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );
        if (toolUseBlocks.length === 0) {
          // stop_reason was tool_use but no blocks — bail with best-effort text
          const textBlock = aiResponse.content.find(
            (b): b is Anthropic.TextBlock => b.type === 'text'
          );
          rawResponseText = textBlock?.text || 'Не удалось сформировать ответ.';
          break;
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          if (toolBlock.name === 'web_search') {
            const searchQuery = (toolBlock.input as { query: string }).query;
            app.log.info(`AI web search: "${searchQuery}"`);
            const searchResults = await webSearch(searchQuery);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: searchResults,
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: 'Инструмент недоступен.',
              is_error: true,
            });
          }
        }

        conversation.push({ role: 'assistant', content: aiResponse.content });
        conversation.push({ role: 'user', content: toolResults });
        turns += 1;
      }

      if (!rawResponseText) {
        rawResponseText = 'Не удалось получить ответ после нескольких поисков. Попробуй переформулировать.';
      }

      // 8. Parse and execute actions
      const { cleanText, actions } = parseActions(rawResponseText);
      const finalText = stripMarkdown(cleanText);

      let actionResults: string[] = [];
      if (actions.length > 0) {
        actionResults = await executeActions(userId, actions);
      }

      // 9. Save messages to DB
      await prisma.chatMessage.createMany({
        data: [
          {
            userId,
            role: 'user',
            content: text,
          },
          {
            userId,
            role: 'assistant',
            content: finalText,
            actions: actions.length > 0 ? JSON.parse(JSON.stringify(actions)) : undefined,
          },
        ],
      });

      // 10. Return response
      return reply.send({
        message: finalText,
        ...(actions.length > 0 ? { actions } : {}),
        ...(actionResults.length > 0 ? { actionResults } : {}),
        context: {
          tasksToday: todayTasks.length,
          tasksCompleted: todayTasks.filter((t) => t.completed).length,
          habitsTotal: activeHabits.length,
          habitsCompleted: todayHabitLogs.length,
          spentThisMonth,
          budgetLimit,
          currentStreak,
          weekProgress,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки чата',
      });
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
