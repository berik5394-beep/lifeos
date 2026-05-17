import Fastify from 'fastify';
import { prisma } from './lib/prisma.js';
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
import { auditRoutes } from './routes/audit.js';
import { integrationRoutes, googleCalendarCallbackRoutes } from './routes/integrations.js';
import { exportRoutes } from './routes/export.js';
import { petRoutes } from './routes/pet.js';
import { achievementRoutes } from './routes/achievements.js';
import { arenaRoutes } from './routes/arena.js';
import { challengeRoutes } from './routes/challenge.js';
import { visionRoutes } from './routes/vision.js';
import { conversationRoutes } from './routes/conversation.js';
import { contactRoutes } from './routes/contacts.js';
import { calendarSyncRoutes } from './routes/calendar-sync.js';
import { travelRoutes } from './routes/travel.js';
import { documentRoutes } from './routes/documents.js';
import { tagRoutes } from './routes/tags.js';
import { dependencyRoutes } from './routes/dependencies.js';
import { sharedSpaceRoutes } from './routes/shared-spaces.js';
import { quickAddRoutes } from './routes/quick-add.js';
import { prioritizationRoutes } from './routes/prioritization.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { briefingRoutes } from './routes/briefing.js';
import { notificationRoutes } from './routes/notifications.js';
import { appInfoRoutes } from './routes/app-info.js';
import { lifeAnalysisRoutes } from './routes/life-analysis.js';
import { dictationRoutes } from './routes/dictation.js';
import { insightsRoutes } from './routes/insights.js';
import { startBot, stopBot } from './services/telegram-bot.js';
import { startRefreshTokenCleanup } from './services/token-cleanup.js';
import { startProactiveScheduler, stopProactiveScheduler } from './services/proactive-scheduler.js';
import { registerSecurityHeaders, rateLimiter } from './middleware/security.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { attachLogger } from './lib/logger.js';
import { checkRequiredEnv } from './lib/env-check.js';
import type { Telegraf } from 'telegraf';

// ============================================================================
// БЕЗОПАСНОСТЬ: проверка ВСЕХ обязательных env vars до старта сервера.
// Без этого Anthropic SDK инициализируется с пустой строкой и падает на
// первом запросе через минуту после запуска. checkRequiredEnv() падает с
// полным списком отсутствующих переменных сразу.
// ============================================================================
checkRequiredEnv();

// ============================================================================
// БЕЗОПАСНОСТЬ: JWT_SECRET обязателен. Без него — крах на старте.
// Это защита от случайного запуска прода со слабым/дефолтным секретом.
// ============================================================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    '\n❌ FATAL: JWT_SECRET не задан или слишком короткий (нужно ≥32 символа).\n' +
      '   Сгенерируй: openssl rand -base64 48\n' +
      '   Затем добавь в .env (локально) или в Railway → Variables (прод).\n',
  );
  process.exit(1);
}

// ============================================================================
// БЕЗОПАСНОСТЬ: bodyLimit по умолчанию 256 KB.
// Эндпоинты, которым нужно больше (vision, import) — переопределяют per-route.
// Это закрывает DoS-вектор, когда атакующий шлёт мегабайтные JSON в /auth/login.
// ============================================================================
const DEFAULT_BODY_LIMIT = 256 * 1024; // 256 KB
const app = Fastify({
  logger: true,
  bodyLimit: DEFAULT_BODY_LIMIT,
  // Доверяем X-Forwarded-For от прокси (Railway, Cloudflare и т.д.)
  // чтобы rate-limiter работал по реальному IP клиента, а не по IP прокси.
  trustProxy: true,
});

// ============================================================================
// БЕЗОПАСНОСТЬ: CORS — whitelist, а не "origin: true" (любой источник)
// ============================================================================
const CORS_ORIGINS_ENV = process.env.CORS_ORIGINS || '';
const allowedOrigins = CORS_ORIGINS_ENV
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

// В разработке разрешаем localhost и Expo Go (если CORS_ORIGINS не задан)
const isProduction = process.env.NODE_ENV === 'production';

await app.register(cors, {
  origin: (origin, cb) => {
    // Мобильные приложения и серверные клиенты не шлют Origin — это нормально
    if (!origin) return cb(null, true);

    if (allowedOrigins.length > 0) {
      // Явный whitelist из переменной окружения
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // БЕЗОПАСНОСТЬ: cb(null, false) — браузер блокирует ответ через CORS,
      // сервер не кидает 500 (раньше cb(new Error(...)) давал stack trace в логи).
      app.log.warn({ origin }, 'CORS: origin не в whitelist, отклонено');
      return cb(null, false);
    }

    if (!isProduction) {
      // В dev-режиме разрешаем локальные запросы
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('192.168.') ||
        origin.includes('exp://') ||
        origin.includes('.expo.dev')
      ) {
        return cb(null, true);
      }
    }

    app.log.warn({ origin }, 'CORS: origin отклонён');
    cb(null, false);
  },
  credentials: true,
});

await app.register(jwt, {
  secret: JWT_SECRET,
});

// Security headers (X-Frame-Options, HSTS, CSP, etc.)
registerSecurityHeaders(app);

// ============================================================================
// Глобальный обработчик ошибок.
// Ловит всё, что летит из роутов (Prisma throws, Zod validation, Fastify
// schema validation, прочие Error). Возвращает структурированный JSON и
// пишет полный контекст в лог. В проде не протекает stack trace наружу.
// ============================================================================
// NEW: centralized error handler using /lib/errors.ts + /middleware/error-handler.ts
// Behaviour preserved from the legacy inline handler:
//   - Zod / Fastify validation → 400 with field info
//   - Prisma P2002 → 409 "Запись с такими данными уже существует"
//   - Prisma P2025 → 404 "Запись не найдена"
//   - Prisma P10xx → 500 database error
//   - Fallback → 500 internal error (stack hidden in production)
// Plus NEW capabilities:
//   - Sensitive-field sanitization (passwords, tokens, JWTs redacted from logs)
//   - Stable `code` field for client-side error taxonomy
//   - Typed AppError classes routes can throw directly
//   - requestId echoed back for support debugging
registerErrorHandler(app);
attachLogger(app.log as unknown as Parameters<typeof attachLogger>[0]);

app.get('/health', async () => {
  return { status: 'ok' };
});

// ============================================================================
// БЕЗОПАСНОСТЬ: Глобальный rate limiter для всех API-маршрутов.
// 120 запросов в минуту на IP — защита от перебора и DoS.
// Auth-эндпоинты имеют собственные, более строгие лимиты (3-30 req/min).
// ============================================================================
const globalApiLimiter = rateLimiter({ max: 120, windowMs: 60_000, keyPrefix: 'global' });
app.addHook('onRequest', globalApiLimiter);

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
await app.register(auditRoutes);
await app.register(integrationRoutes);
// Google OAuth callback — без authMiddleware (Google редиректит браузер
// юзера без нашего JWT; защищён одноразовым state). Регистрируется
// отдельным плагином, чтобы не попасть под auth-hook integrationRoutes.
await app.register(googleCalendarCallbackRoutes);
await app.register(exportRoutes);
await app.register(petRoutes);
await app.register(achievementRoutes);
await app.register(arenaRoutes);
await app.register(challengeRoutes);
await app.register(visionRoutes);
await app.register(conversationRoutes);
await app.register(contactRoutes);
await app.register(calendarSyncRoutes);
await app.register(travelRoutes);
await app.register(documentRoutes);
await app.register(tagRoutes);
await app.register(dependencyRoutes);
await app.register(sharedSpaceRoutes);
await app.register(quickAddRoutes);
await app.register(prioritizationRoutes);
await app.register(subscriptionRoutes);
await app.register(briefingRoutes);
await app.register(notificationRoutes);
await app.register(appInfoRoutes);
await app.register(lifeAnalysisRoutes);
await app.register(dictationRoutes);
await app.register(insightsRoutes);

let telegramBot: Telegraf | null = null;
let tokenCleanupTimer: NodeJS.Timeout | null = null;

const start = async (): Promise<void> => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });

    // Background cleanup: stale revoked/expired refresh tokens.
    // Keeps the refreshToken table bounded so auth/refresh stays fast.
    tokenCleanupTimer = startRefreshTokenCleanup(app);

    // Start Telegram bot if token is configured. startBot() сам проверяет
    // наличие токена и запускает polling в фоне (launch() не await'ится).
    try {
      telegramBot = await startBot();
    } catch (err) {
      app.log.error(err, 'Не удалось запустить Telegram бота');
    }

    // Фаза 4.1: планировщик проактивности. Тикает каждые 10 мин, шлёт
    // напоминания в приложение (Expo Push) + зеркало в Telegram.
    startProactiveScheduler();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
//
// Railway шлёт SIGTERM при каждом деплое с ~10-секундным grace-period. До
// этого мы закрывали только Fastify — Prisma pool висел, in-flight
// транзакции обрезались посередине. Теперь:
//   1. Перестаём принимать новые запросы + дожидаемся in-flight (app.close)
//   2. Останавливаем Telegram polling (чтобы бот не ловил апдейты в вакуум)
//   3. Явно закрываем Prisma pool ($disconnect) — это flushит транзакции
//   4. exit(0)
//
// Флаг isShuttingDown защищает от повторных SIGTERM/SIGINT — если юзер жмёт
// Ctrl+C дважды, не запускаем вторую shutdown параллельно.
let isShuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, 'graceful shutdown start');
  try {
    if (tokenCleanupTimer) {
      clearInterval(tokenCleanupTimer);
      tokenCleanupTimer = null;
    }
    if (telegramBot) {
      stopBot();
    }
    stopProactiveScheduler();
    await app.close();
    await prisma.$disconnect();
    app.log.info('graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'graceful shutdown failed');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start();
