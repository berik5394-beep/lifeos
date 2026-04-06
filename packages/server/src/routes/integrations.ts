import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const googleCalendarSchema = z.object({
  accessToken: z.string().min(1, 'Access token обязателен'),
  refreshToken: z.string().min(1, 'Refresh token обязателен'),
});

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

    const integration = await prisma.integration.upsert({
      where: {
        userId_provider: {
          userId: request.userId,
          provider: 'google_calendar',
        },
      },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        active: true,
      },
      create: {
        userId: request.userId,
        provider: 'google_calendar',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        active: true,
      },
    });

    return reply.status(201).send({
      id: integration.id,
      provider: integration.provider,
      active: integration.active,
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

    // Placeholder: real Google Calendar API integration would go here
    return reply.send({
      synced: true,
      eventsImported: 0,
      message: 'Синхронизация завершена',
    });
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
