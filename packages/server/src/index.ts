import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { habitRoutes } from './routes/habits.js';
import { goalRoutes } from './routes/goals.js';
import { financeRoutes } from './routes/finance.js';
import { stepRoutes } from './routes/steps.js';
import { voiceRoutes } from './routes/voice.js';
import { journalRoutes } from './routes/journal.js';
import { eventRoutes } from './routes/events.js';
import { importRoutes } from './routes/import.js';
import { chatRoutes } from './routes/chat.js';
import { integrationRoutes } from './routes/integrations.js';
import { exportRoutes } from './routes/export.js';
import { createTelegramBot, startBot, stopBot } from './services/telegram-bot.js';
import type { Telegraf } from 'telegraf';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
});

app.get('/health', async () => {
  return { status: 'ok' };
});

await app.register(authRoutes);
await app.register(taskRoutes);
await app.register(habitRoutes);
await app.register(goalRoutes);
await app.register(financeRoutes);
await app.register(stepRoutes);
await app.register(voiceRoutes);
await app.register(journalRoutes);
await app.register(eventRoutes);
await app.register(importRoutes);
await app.register(chatRoutes);
await app.register(integrationRoutes);
await app.register(exportRoutes);

let telegramBot: Telegraf | null = null;

const start = async (): Promise<void> => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });

    // Start Telegram bot if token is configured
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        telegramBot = createTelegramBot();
        await startBot(telegramBot);
        app.log.info('Telegram бот запущен');
      } catch (err) {
        app.log.error(err, 'Не удалось запустить Telegram бота');
      }
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  if (telegramBot) {
    stopBot(telegramBot);
  }
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
