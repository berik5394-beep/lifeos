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
  GoogleCalendarError,
} from '../services/google-calendar.js';

// Phase 3.1: мобилка делает OAuth (PKCE) и присылает auth code —
// client_secret остаётся на сервере (secure pattern), сюда не приходит.
const googleCalendarSchema = z.object({
  code: z.string().min(1, 'OAuth code обязателен'),
  redirectUri: z.string().url('redirectUri должен быть URL'),
  codeVerifier: z.string().min(20, 'codeVerifier обязателен (PKCE)'),
});

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

  // --- Google Calendar: Connect ---

  app.post('/integrations/google-calendar/connect', {
    preHandler: validate(googleCalendarSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof googleCalendarSchema>;

    let tokens;
    try {
      tokens = await exchangeCode({
        code: data.code,
        redirectUri: data.redirectUri,
        codeVerifier: data.codeVerifier,
      });
    } catch (err) {
      return googleErrorReply(reply, err);
    }

    // Google отдаёт refresh_token только при первом согласии (или с
    // prompt=consent). При переподключении его может не быть — тогда
    // сохраняем уже имеющийся, не затираем null'ом.
    const existing = await prisma.integration.findUnique({
      where: { userId_provider: { userId: request.userId, provider: 'google_calendar' } },
      select: { refreshToken: true },
    });
    const refreshEnc = tokens.refreshToken
      ? encrypt(tokens.refreshToken)
      : existing?.refreshToken ?? null;

    if (!refreshEnc) {
      return reply.status(400).send({
        message:
          'Google не вернул refresh_token. Переподключись с запросом offline-доступа (prompt=consent).',
      });
    }

    // БЕЗОПАСНОСТЬ: токены шифруются (AES-256-GCM). settings хранит
    // expiresAt — чтобы знать когда рефрешить, не дёргая Google зря.
    const settings = { expiresAt: tokens.expiresAt };
    const integration = await prisma.integration.upsert({
      where: {
        userId_provider: { userId: request.userId, provider: 'google_calendar' },
      },
      update: {
        accessToken: encrypt(tokens.accessToken),
        refreshToken: refreshEnc,
        settings,
        active: true,
      },
      create: {
        userId: request.userId,
        provider: 'google_calendar',
        accessToken: encrypt(tokens.accessToken),
        refreshToken: refreshEnc,
        settings,
        active: true,
      },
    });

    return reply.status(201).send({
      id: integration.id,
      provider: integration.provider,
      active: integration.active,
      settings: integration.settings,
      createdAt: integration.createdAt,
      message: 'Google Calendar подключён',
    });
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

    const integration = await prisma.integration.findUnique({
      where: {
        userId_provider: {
          userId: request.userId,
          provider,
        },
      },
    });

    if (!integration) {
      return reply.status(404).send({
        message: 'Интеграция не найдена',
      });
    }

    await prisma.integration.delete({
      where: {
        userId_provider: {
          userId: request.userId,
          provider,
        },
      },
    });

    return reply.send({ success: true, message: 'Интеграция отключена' });
  });
}
