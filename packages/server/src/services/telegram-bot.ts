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

async function getBriefing(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [tasks, habits, habitLogs, expenses, budgetLimits, pet] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: today }, select: { title: true, completed: true } }),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    prisma.habitLog.findMany({ where: { userId, date: today, completed: true }, select: { habitId: true } }),
    prisma.expense.findMany({ where: { userId, date: { gte: monthStart, lte: monthEnd } }, select: { amount: true } }),
    prisma.budgetLimit.findMany({ where: { userId, month: today.getMonth() + 1, year: today.getFullYear() }, select: { monthlyLimit: true } }),
    prisma.pet.findFirst({ where: { userId }, select: { health: true, level: true, streak: true, isAlive: true } }),
  ]);

  const completedTaskCount = tasks.filter((t) => t.completed).length;
  const completedHabitIds = new Set(habitLogs.map((l) => l.habitId));
  const completedHabitCount = habits.filter((h) => completedHabitIds.has(h.id)).length;
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const totalLimit = budgetLimits.reduce((s, b) => s + b.monthlyLimit, 0);

  const lines = [
    `📅 Брифинг на ${today.toLocaleDateString('ru-RU')}`,
    '',
    `📋 Задачи: ${completedTaskCount}/${tasks.length}`,
    `🔄 Привычки: ${completedHabitCount}/${habits.length}`,
    `💰 Бюджет: ${Math.round(totalSpent)}₸ из ${Math.round(totalLimit)}₸`,
  ];

  if (pet) {
    lines.push(`🐾 Питомец: ❤️${Math.round(pet.health)}% · Ур.${pet.level} · Стрик ${pet.streak}д`);
    if (!pet.isAlive) lines.push('⚠️ Питомец мёртв! Зайди в приложение!');
  }

  const incomplete = tasks.filter((t) => !t.completed).map((t) => `  ⬜ ${t.title}`);
  if (incomplete.length > 0) {
    lines.push('', '📝 Осталось сделать:');
    lines.push(...incomplete.slice(0, 5));
    if (incomplete.length > 5) lines.push(`  ... и ещё ${incomplete.length - 5}`);
  }

  return lines.join('\n');
}

async function completeTaskByText(userId: string, text: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const task = await prisma.task.findFirst({
    where: {
      userId,
      date: today,
      completed: false,
      title: { contains: text, mode: 'insensitive' },
    },
  });

  if (!task) return `Задача "${text}" не найдена среди сегодняшних.`;

  await prisma.task.update({
    where: { id: task.id },
    data: { completed: true },
  });

  return `Задача "${task.title}" отмечена как выполненная ✅`;
}

async function completeHabitByText(userId: string, text: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const habit = await prisma.habit.findFirst({
    where: {
      userId,
      active: true,
      name: { contains: text, mode: 'insensitive' },
    },
  });

  if (!habit) return `Привычка "${text}" не найдена.`;

  await prisma.habitLog.upsert({
    where: { habitId_date: { habitId: habit.id, date: today } },
    create: { habitId: habit.id, userId, date: today, completed: true },
    update: { completed: true },
  });

  return `Привычка "${habit.name}" отмечена ✅`;
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
      'Привет! Я бот LifeOS 🚀\n\n' +
      'Привяжите аккаунт через настройки интеграций в приложении.\n\n' +
      '📋 Команды:\n' +
      '• "задачи" — задачи на сегодня\n' +
      '• "привычки" — статус привычек\n' +
      '• "брифинг" — полный обзор дня\n' +
      '• "✅ название" — закрыть задачу\n' +
      '• "✔ название" — отметить привычку\n' +
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

      if (text === 'брифинг' || text === 'briefing' || text === 'обзор') {
        const response = await getBriefing(userId);
        await ctx.reply(response);
        return;
      }

      // Complete task: "✅ название задачи"
      if (text.startsWith('✅') || text.startsWith('✔️') || text.startsWith('закрыть ') || text.startsWith('done ')) {
        const taskName = ctx.message.text.trim().replace(/^(✅|✔️|закрыть|done)\s*/i, '');
        if (taskName) {
          const response = await completeTaskByText(userId, taskName);
          await ctx.reply(response);
          return;
        }
      }

      // Complete habit: "✔ название привычки" or "привычка тренировка"
      if (text.startsWith('✔') || text.startsWith('привычка ') || text.startsWith('отметить ')) {
        const habitName = ctx.message.text.trim().replace(/^(✔|привычка|отметить)\s*/i, '');
        if (habitName) {
          const response = await completeHabitByText(userId, habitName);
          await ctx.reply(response);
          return;
        }
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
        '• "брифинг" — полный обзор дня\n' +
        '• "✅ название" — закрыть задачу\n' +
        '• "✔ название" — отметить привычку\n' +
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
