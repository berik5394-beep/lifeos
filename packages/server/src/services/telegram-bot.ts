import { Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import { prisma } from '../lib/prisma.js';

interface IntegrationSettings {
  chatId: string;
  username?: string;
}

async function findUserByChatId(chatId: string): Promise<string | null> {
  const integrations = await prisma.integration.findMany({
    where: {
      provider: 'telegram',
      active: true,
    },
    select: {
      userId: true,
      settings: true,
    },
  });

  for (const integration of integrations) {
    const settings = integration.settings as unknown as IntegrationSettings;
    if (settings.chatId === chatId) {
      return integration.userId;
    }
  }

  return null;
}

async function getTodayTasks(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tasks = await prisma.task.findMany({
    where: { userId, date: today },
    orderBy: { completed: 'asc' },
    select: { title: true, completed: true, priority: true },
  });

  if (tasks.length === 0) {
    return 'На сегодня задач нет.';
  }

  const lines = tasks.map((t) => {
    const status = t.completed ? '✅' : '⬜';
    return `${status} ${t.title}`;
  });

  const completed = tasks.filter((t) => t.completed).length;
  lines.push(`\nВыполнено: ${completed} из ${tasks.length}`);

  return lines.join('\n');
}

async function getHabitsStatus(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    select: { id: true, name: true },
  });

  if (habits.length === 0) {
    return 'Активных привычек нет.';
  }

  const todayLogs = await prisma.habitLog.findMany({
    where: {
      userId,
      date: today,
      completed: true,
    },
    select: { habitId: true },
  });

  const completedIds = new Set(todayLogs.map((l) => l.habitId));

  const lines = habits.map((h) => {
    const status = completedIds.has(h.id) ? '✅' : '⬜';
    return `${status} ${h.name}`;
  });

  const completed = todayLogs.length;
  lines.push(`\nВыполнено: ${completed} из ${habits.length}`);

  return lines.join('\n');
}

async function addExpenseFromText(userId: string, text: string): Promise<string> {
  // Parse: "5000 еда" or "5000 еда обед в кафе"
  const match = text.match(/^(\d+(?:\.\d+)?)\s+(\S+)(?:\s+(.+))?$/);
  if (!match) {
    return 'Не удалось распознать расход. Формат: "5000 еда описание"';
  }

  const amount = parseFloat(match[1]);
  const category = match[2];
  const description = match[3] ?? category;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.expense.create({
    data: {
      userId,
      date: today,
      category,
      description,
      amount,
    },
  });

  return `Расход добавлен: ${amount}₸ — ${category} (${description})`;
}

export function createTelegramBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан');
  }

  const bot = new Telegraf(token);

  bot.start(async (ctx: Context) => {
    await ctx.reply(
      'Привет! Я бот LifeOS.\n\n' +
      'Чтобы привязать аккаунт, используйте настройки интеграций в приложении LifeOS.\n\n' +
      'Доступные команды:\n' +
      '• "задачи" — список задач на сегодня\n' +
      '• "привычки" — статус привычек\n' +
      '• "5000 еда обед" — добавить расход\n\n' +
      `Ваш Chat ID: ${ctx.chat?.id}`,
    );
  });

  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = await findUserByChatId(chatId);

    if (!userId) {
      await ctx.reply(
        'Аккаунт не привязан. Привяжите Telegram в настройках LifeOS.\n' +
        `Ваш Chat ID: ${chatId}`,
      );
      return;
    }

    const text = ctx.message.text.toLowerCase().trim();

    try {
      if (text === 'задачи' || text === 'tasks') {
        const response = await getTodayTasks(userId);
        await ctx.reply(`📋 Задачи на сегодня:\n\n${response}`);
        return;
      }

      if (text === 'привычки' || text === 'habits') {
        const response = await getHabitsStatus(userId);
        await ctx.reply(`🔄 Привычки:\n\n${response}`);
        return;
      }

      // Check if message starts with a number (expense)
      if (/^\d/.test(text)) {
        const response = await addExpenseFromText(userId, ctx.message.text.trim());
        await ctx.reply(`💰 ${response}`);
        return;
      }

      await ctx.reply(
        'Не понял команду. Доступные:\n' +
        '• "задачи" — задачи на сегодня\n' +
        '• "привычки" — статус привычек\n' +
        '• "5000 еда обед" — добавить расход',
      );
    } catch (err) {
      console.error('Telegram bot error:', err);
      await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
  });

  return bot;
}

export async function startBot(bot: Telegraf): Promise<void> {
  await bot.launch();
  console.log('Telegram бот запущен');
}

export function stopBot(bot: Telegraf): void {
  bot.stop('SIGTERM');
  console.log('Telegram бот остановлен');
}
