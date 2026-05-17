import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import {
  exchangeCode,
  refreshAccessToken,
  listEvents,
  insertEvent,
  createAuthUrl,
  consumeAuthState,
  callbackUrl,
  GoogleCalendarError,
  type GoogleTokens,
} from '../services/google-calendar.js';
import { triageInbox } from '../services/gmail.js';
import {
  getIntegration,
  listIntegrationStatus,
} from '../services/integration-registry.js';

/**
 * Сохраняет токены Google в Integration (шифрованно). refresh_token
 * Google отдаёт только при первом согласии/prompt=consent — если не
 * пришёл, не затираем уже сохранённый.
 */
async function storeGoogleTokens(
  userId: string,
  tokens: GoogleTokens,
): Promise<boolean> {
  const existing = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'google_calendar' } },
    select: { refreshToken: true },
  });
  const refreshEnc = tokens.refreshToken
    ? encrypt(tokens.refreshToken)
    : existing?.refreshToken ?? null;
  if (!refreshEnc) return false;

  const settings = { expiresAt: tokens.expiresAt };
  await prisma.integration.upsert({
    where: { userId_provider: { userId, provider: 'google_calendar' } },
    update: {
      accessToken: encrypt(tokens.accessToken),
      refreshToken: refreshEnc,
      settings,
      active: true,
    },
    create: {
      userId,
      provider: 'google_calendar',
      accessToken: encrypt(tokens.accessToken),
      refreshToken: refreshEnc,
      settings,
      active: true,
    },
  });
  return true;
}

function googleErrorReply(
  reply: import('fastify').FastifyReply,
  err: unknown,
): unknown {
  if (err instanceof GoogleCalendarError) {
    const status = err.code === 'not_configured' ? 503 : 502;
    return reply.status(status).send({ message: err.message, code: err.code });
  }
  throw err;
}

const telegramConnectSchema = z.object({
  chatId: z.string().min(1, 'Chat ID обязателен'),
  username: z.string().optional(),
});

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- List integrations ---

  app.get('/integrations', async (request) => {
    // Контракт не меняем (старое приложение ждёт массив Integration).
    return prisma.integration.findMany({
      where: { userId: request.userId },
      select: {
        id: true,
        provider: true,
        active: true,
        settings: true,
        createdAt: true,
      },
    });
  });

  // Phase 3.3: единый каталог интеграций со статусом и возможностями.
  // Аддитивно (новый эндпоинт) — ничего не ломает; единый источник
  // правды вместо строковых литералов провайдеров по коду.
  app.get('/integrations/catalog', async (request) => {
    return listIntegrationStatus(request.userId);
  });

  // --- Gmail: триаж непрочитанных (Phase 3.2, read-only) ---
  app.get('/integrations/gmail/triage', async (request, reply) => {
    try {
      const result = await triageInbox(request.userId);
      return reply.send(result);
    } catch (err) {
      return googleErrorReply(reply, err);
    }
  });

  // --- Google Calendar: старт OAuth ---
  // Web-клиент Google не принимает кастомную схему мобилки (lifeos://),
  // а Expo-прокси в SDK54 удалён → серверный redirect. Мобилка просит
  // URL здесь, открывает его в системном браузере; Google уводит юзера
  // и редиректит на /callback (см. ниже, без auth).
  app.get('/integrations/google-calendar/auth-url', async (request, reply) => {
    try {
      return reply.send({ url: createAuthUrl(request.userId) });
    } catch (err) {
      return googleErrorReply(reply, err);
    }
  });

  // --- Google Calendar: Sync ---

  app.post('/integrations/google-calendar/sync', async (request, reply) => {
    const integration = await prisma.integration.findUnique({
      where: {
        userId_provider: {
          userId: request.userId,
          provider: 'google_calendar',
        },
      },
    });

    if (!integration) {
      return reply.status(404).send({
        message: 'Google Calendar не подключён',
      });
    }

    if (!integration.active) {
      return reply.status(400).send({
        message: 'Интеграция с Google Calendar неактивна',
      });
    }
    if (!integration.refreshToken) {
      return reply.status(400).send({
        message: 'Нет refresh-токена. Переподключи Google Calendar.',
      });
    }

    try {
      // 1. Свежий access: рефрешим если протух (или нет expiresAt).
      const settings = (integration.settings as { expiresAt?: number }) || {};
      let accessToken: string;
      if (
        integration.accessToken &&
        settings.expiresAt &&
        settings.expiresAt > Date.now()
      ) {
        accessToken = decrypt(integration.accessToken);
      } else {
        const refreshed = await refreshAccessToken(decrypt(integration.refreshToken));
        accessToken = refreshed.accessToken;
        await prisma.integration.update({
          where: { userId_provider: { userId: request.userId, provider: 'google_calendar' } },
          data: {
            accessToken: encrypt(refreshed.accessToken),
            settings: { ...settings, expiresAt: refreshed.expiresAt },
          },
        });
      }

      const userId = request.userId;
      const now = new Date();
      const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // 2. PULL: Google → CalendarEvent (дедуп по externalId).
      const remote = await listEvents(
        accessToken,
        now.toISOString(),
        horizon.toISOString(),
      );
      let imported = 0;
      for (const ev of remote) {
        const existing = await prisma.calendarEvent.findFirst({
          where: { userId, externalId: ev.externalId },
          select: { id: true },
        });
        const evData = {
          title: ev.title.slice(0, 512),
          date: new Date(ev.date + 'T00:00:00Z'),
          startTime: ev.startTime,
          endTime: ev.endTime,
          location: ev.location?.slice(0, 512) ?? null,
          description: ev.description?.slice(0, 4096) ?? null,
          source: 'google',
        };
        if (existing) {
          await prisma.calendarEvent.update({ where: { id: existing.id }, data: evData });
        } else {
          await prisma.calendarEvent.create({
            data: { userId, externalId: ev.externalId, ...evData },
          });
          imported++;
        }
      }

      // 3. PUSH: локальные (manual/voice, ещё не в Google) → Google.
      const localUnsynced = await prisma.calendarEvent.findMany({
        where: {
          userId,
          externalId: null,
          source: { in: ['manual', 'voice'] },
          date: { gte: new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z') },
        },
        take: 100,
      });
      let exported = 0;
      for (const ev of localUnsynced) {
        const gid = await insertEvent(accessToken, {
          title: ev.title,
          date: ev.date.toISOString().slice(0, 10),
          startTime: ev.startTime,
          endTime: ev.endTime,
          location: ev.location,
          description: ev.description,
        });
        await prisma.calendarEvent.update({
          where: { id: ev.id },
          data: { externalId: gid },
        });
        exported++;
      }

      return reply.send({
        synced: true,
        eventsImported: imported,
        eventsExported: exported,
        message: `Синхронизация завершена: ${imported} из Google, ${exported} в Google`,
      });
    } catch (err) {
      return googleErrorReply(reply, err);
    }
  });

  // --- Telegram: Connect ---

  app.post('/integrations/telegram/connect', {
    preHandler: validate(telegramConnectSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof telegramConnectSchema>;

    // B.3 (IDOR): раньше можно было подсунуть ЧУЖОЙ chatId — и пуши
    // этого аккаунта уходили бы в чужой чат (или перехват привязки).
    // Полноценный flow с кодом от бота — отдельная задача (3.10);
    // здесь минимальная защита: один chatId не привязывается к
    // разным аккаунтам.
    const chatOwner = await prisma.integration.findFirst({
      where: {
        provider: 'telegram',
        settings: { path: ['chatId'], equals: data.chatId },
        userId: { not: request.userId },
      },
      select: { id: true },
    });
    if (chatOwner) {
      return reply.status(409).send({
        message: 'Этот Telegram уже привязан к другому аккаунту',
      });
    }

    const settings: Record<string, string> = {
      chatId: data.chatId,
    };
    if (data.username) {
      settings.username = data.username;
    }

    const integration = await prisma.integration.upsert({
      where: {
        userId_provider: {
          userId: request.userId,
          provider: 'telegram',
        },
      },
      update: {
        settings: JSON.parse(JSON.stringify(settings)),
        active: true,
      },
      create: {
        userId: request.userId,
        provider: 'telegram',
        settings: JSON.parse(JSON.stringify(settings)),
        active: true,
      },
    });

    return reply.status(201).send({
      id: integration.id,
      provider: integration.provider,
      active: integration.active,
      message: 'Telegram подключён',
    });
  });

  // --- Disconnect integration ---

  app.delete('/integrations/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };

    // Phase 3.3: валидируем провайдера по реестру (раньше принимали
    // любую строку) и отключаем через дескриптор (идемпотентно).
    const descriptor = getIntegration(provider);
    if (!descriptor) {
      return reply.status(404).send({ message: 'Интеграция не найдена' });
    }
    await descriptor.disconnect(request.userId);
    return reply.send({ success: true, message: 'Интеграция отключена' });
  });
}

/**
 * Google OAuth callback — отдельный плагин БЕЗ authMiddleware: сюда
 * редиректит Google (у браузера юзера нет нашего JWT). Безопасность
 * держится на одноразовом `state` (привязан к userId на сервере,
 * TTL 10 мин) — подделать нельзя. Регистрируется в index.ts отдельно.
 */
export async function googleCalendarCallbackRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/integrations/google-calendar/callback', async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };

    const html = (title: string, body: string) =>
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<title>${title}</title>` +
            `<meta http-equiv="refresh" content="2;url=lifeos://settings/integrations?google=${title === 'Готово' ? 'connected' : 'error'}">` +
            `</head><body style="font-family:-apple-system,system-ui,sans-serif;background:#0F172A;color:#F8FAFC;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">` +
            `<div><h2>${title}</h2><p style="color:#94A3B8">${body}</p>` +
            `<p><a style="color:#6366F1" href="lifeos://settings/integrations">Вернуться в LifeOS</a></p></div>` +
            `</body></html>`,
        );

    if (q.error) {
      return html('Не удалось', `Google вернул ошибку: ${q.error}`);
    }
    if (!q.code || !q.state) {
      return reply.status(400).header('Content-Type', 'text/html; charset=utf-8')
        .send('<h2>Некорректный запрос</h2>');
    }

    const pending = consumeAuthState(q.state);
    if (!pending) {
      return html('Не удалось', 'Сессия авторизации истекла. Попробуй ещё раз.');
    }

    try {
      const tokens = await exchangeCode({
        code: q.code,
        redirectUri: callbackUrl(),
        codeVerifier: pending.verifier,
      });
      const ok = await storeGoogleTokens(pending.userId, tokens);
      if (!ok) {
        return html(
          'Не удалось',
          'Google не вернул refresh-токен. Отзови доступ в аккаунте Google и попробуй снова.',
        );
      }
      return html('Готово', 'Google Calendar подключён. Можешь вернуться в приложение.');
    } catch (err) {
      const msg =
        err instanceof GoogleCalendarError ? err.message : 'Внутренняя ошибка';
      return html('Не удалось', msg);
    }
  });
}
