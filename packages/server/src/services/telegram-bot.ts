import { Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { processDictation } from './dictation-service.js';
import { getAssistantReply } from './assistant-service.js';
import {
  parseBookingIntent,
  buildBookingUrl,
  narrateBooking,
  type BookingContext,
} from './smart-booking.js';

/**
 * LifeOS Telegram Bot — полноценный JARVIS в Telegram.
 *
 * Архитектура: бот — это просто ещё один интерфейс к тому же backend.
 * Тот же Claude, та же память, та же БД что у мобилки. Юзер пишущий боту
 * и юзер в приложении — это разные интерфейсы, но если их аккаунты связаны,
 * данные общие.
 *
 * Авторизация: при /start автоматически создаём LifeOS-аккаунт привязанный
 * к Telegram ID (синтетический email tg{id}@telegram.lifeos). Юзеру не надо
 * регистрироваться — 0 friction, главное преимущество TG-канала.
 *
 * Что умеет:
 *  - Голосовое сообщение → диктофон (задачи + память + ответ)
 *  - Текст → JARVIS-чат с памятью
 *  - "Забронируй рейс/такси/отель" → smart booking URL + озвучка
 *  - Быстрые команды: задачи / привычки / брифинг
 */

interface TelegramSettings {
  chatId: string;
  telegramId: number;
  username?: string;
}

/**
 * Находит или создаёт LifeOS-юзера для Telegram chatId.
 * Идемпотентно: повторный /start того же юзера вернёт существующий аккаунт.
 */
async function findOrCreateUser(
  chatId: string,
  telegramId: number,
  firstName: string,
  username?: string,
): Promise<string> {
  // Ищем существующую привязку
  const integrations = await prisma.integration.findMany({
    where: { provider: 'telegram', active: true },
    select: { userId: true, settings: true },
  });
  for (const integ of integrations) {
    const s = integ.settings as unknown as TelegramSettings;
    if (s.chatId === chatId) return integ.userId;
  }

  // Создаём нового юзера + привязку атомарно
  const syntheticEmail = `tg${telegramId}@telegram.lifeos`;
  const randomPassword = crypto.randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  const user = await prisma.$transaction(async (tx) => {
    // Защита от гонки: вдруг параллельный /start уже создал юзера
    const existing = await tx.user.findUnique({
      where: { email: syntheticEmail },
      select: { id: true },
    });
    const u =
      existing ??
      (await tx.user.create({
        data: {
          email: syntheticEmail,
          name: (firstName || username || 'Друг').slice(0, 64),
          passwordHash,
        },
        select: { id: true },
      }));

    await tx.integration.upsert({
      where: { userId_provider: { userId: u.id, provider: 'telegram' } },
      create: {
        userId: u.id,
        provider: 'telegram',
        active: true,
        settings: { chatId, telegramId, username: username ?? null },
      },
      update: {
        active: true,
        settings: { chatId, telegramId, username: username ?? null },
      },
    });
    return u;
  });

  return user.id;
}

/** Скачивает файл из Telegram и возвращает base64. */
async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string,
): Promise<string> {
  const link = await bot.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// ---- Быстрые команды (не AI, дёшево) -------------------------------------

async function quickTasks(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasks = await prisma.task.findMany({
    where: { userId, date: today },
    orderBy: { completed: 'asc' },
    select: { title: true, completed: true },
  });
  if (tasks.length === 0) return '📋 На сегодня задач нет.';
  const lines = tasks.map((t) => `${t.completed ? '✅' : '⬜'} ${t.title}`);
  const done = tasks.filter((t) => t.completed).length;
  return `📋 Задачи (${done}/${tasks.length}):\n\n${lines.join('\n')}`;
}

async function quickHabits(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [habits, logs] = await Promise.all([
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
  ]);
  if (habits.length === 0) return '🔄 Активных привычек нет.';
  const doneIds = new Set(logs.map((l) => l.habitId));
  const lines = habits.map((h) => `${doneIds.has(h.id) ? '✅' : '⬜'} ${h.name}`);
  return `🔄 Привычки (${doneIds.size}/${habits.length}):\n\n${lines.join('\n')}`;
}

const QUICK_TASKS = /^(задачи|tasks|что по задачам|план на день)$/i;
const QUICK_HABITS = /^(привычки|habits|что по привычкам)$/i;

// ---- Bot --------------------------------------------------------------------

export function createTelegramBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан');
  }

  const bot = new Telegraf(token);

  bot.start(async (ctx: Context) => {
    const chatId = String(ctx.chat?.id);
    const from = ctx.from;
    if (!chatId || !from) return;
    try {
      await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await ctx.reply(
        `Привет, ${from.first_name || 'друг'}! Я твой JARVIS 🤖\n\n` +
          'Я не просто бот с командами — я думаю, помню и помогаю.\n\n' +
          '🎙️ *Запиши голосовое* — я выделю задачи и запомню важное\n' +
          '💬 *Напиши что угодно* — отвечу, помогу, посоветую\n' +
          '✈️ *"Забронируй рейс в Астану"* — дам ссылку и подскажу по времени\n' +
          '📋 *"задачи"* / *"привычки"* — быстрый статус\n\n' +
          'Расскажи о себе пару фраз голосом — я начну тебя узнавать.',
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('TG /start error:', err);
      await ctx.reply('Ошибка инициализации. Попробуй /start ещё раз.');
    }
  });

  // Голосовые сообщения → диктофон
  bot.on('voice', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const from = ctx.from;
    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await ctx.sendChatAction('typing');
      const fileId = ctx.message.voice.file_id;
      const audioB64 = await downloadTelegramFile(bot, fileId);
      const duration = ctx.message.voice.duration;
      // Telegram voice = OGG Opus (.oga). Groq Whisper это принимает.
      const result = await processDictation(userId, audioB64, 'oga', duration);

      const parts: string[] = [result.spokenResponse];
      if (result.tasksCreated.length > 0) {
        parts.push(
          '\n📝 Задачи:\n' +
            result.tasksCreated.map((t) => `• ${t.title}`).join('\n'),
        );
      }
      if (result.memoriesCreated.length > 0) {
        parts.push(
          '\n🧠 Запомнил:\n' +
            result.memoriesCreated.map((m) => `• ${m.content}`).join('\n'),
        );
      }
      await ctx.reply(parts.join('\n'));
    } catch (err) {
      console.error('TG voice error:', err);
      await ctx.reply('Не смог обработать запись. Попробуй ещё раз?');
    }
  });

  // Текст → JARVIS chat (+ booking если intent)
  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const from = ctx.from;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // команды обрабатываются отдельно

    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );

      // Быстрые команды без AI
      if (QUICK_TASKS.test(text)) {
        await ctx.reply(await quickTasks(userId));
        return;
      }
      if (QUICK_HABITS.test(text)) {
        await ctx.reply(await quickHabits(userId));
        return;
      }

      await ctx.sendChatAction('typing');
      const reply = await getAssistantReply(userId, text);

      // Если это booking-намерение — добавим ссылку + контекстную озвучку
      if (reply.intent.action === 'plan_travel') {
        const todayIso = new Date().toISOString().slice(0, 10);
        const bIntent = await parseBookingIntent(text, todayIso);
        const url = buildBookingUrl(bIntent);
        const targetDate = bIntent.departDate || bIntent.checkIn || todayIso;
        const [user, events] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
          prisma.calendarEvent.findMany({
            where: { userId, date: new Date(targetDate + 'T00:00:00Z') },
            select: { title: true, date: true, startTime: true },
            take: 10,
          }),
        ]);
        const bCtx: BookingContext = {
          userName: user?.name || 'друг',
          eventsOnDate: events.map((e) => ({
            title: e.title,
            date: e.date.toISOString().slice(0, 10),
            startTime: e.startTime,
          })),
          destinationKnown: false,
        };
        const narration = await narrateBooking(bIntent, bCtx);
        await ctx.reply(
          `${narration}${url ? `\n\n🔗 ${url}` : ''}`,
        );
        return;
      }

      await ctx.reply(reply.text);
    } catch (err) {
      console.error('TG text error:', err);
      await ctx.reply('Что-то пошло не так. Попробуй ещё раз через секунду.');
    }
  });

  return bot;
}

let activeBot: Telegraf | null = null;

export async function startBot(): Promise<Telegraf | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN не задан — бот не запускается');
    return null;
  }
  const bot = createTelegramBot();
  activeBot = bot;
  // launch() резолвится только при остановке — НЕ await'им, иначе сервер
  // зависнет на старте. Запускаем в фоне, ошибки логируем.
  bot.launch().catch((err) => {
    console.error('Telegram бот упал:', err);
  });
  console.log('Telegram бот запущен (@LifeOS_jarvis_bot)');
  return bot;
}

export function stopBot(): void {
  if (activeBot) {
    activeBot.stop('SIGTERM');
    activeBot = null;
    console.log('Telegram бот остановлен');
  }
}
