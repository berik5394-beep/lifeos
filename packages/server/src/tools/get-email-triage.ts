import { z } from 'zod';
import { triageInbox } from '../services/gmail.js';
import { GoogleCalendarError } from '../services/google-calendar.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.3 — миграция agent-only read-tool get_email_triage в
 * реестр. Тонкая обёртка над gmail.triageInbox + GRACEFUL FALLBACK
 * (friend-UX 2026-05-26): если Gmail/Google не подключён или временно
 * ругается — НЕ кидаем исключение в orchestrator (юзер увидел бы
 * generic error), а возвращаем структурированный «not_connected»
 * ответ с подсказкой подключения. Bot объясняет честно вместо silent
 * сбоя.
 *
 * Долгосрочный fix класса hollow-tools (когда integration не подключена
 * — tool НЕ показывается агенту вообще) — отдельная задача
 * tool-filter by integration availability (Relayna pattern).
 */
export const getEmailTriageTool = defineTool({
  name: 'get_email_triage',
  description:
    'Разобрать непрочитанные письма Gmail: что важное, что можно ' +
    'проигнорировать. Read-only. Вызывай на «разбери почту», ' +
    '«что в почте», «есть важные письма».',
  category: 'info',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'external',
  // Phase 7 tool-filter: без активного google_calendar integration
  // tool скрыт от агента (agentToolSchemasForUser). Старый graceful
  // try/catch в handler остаётся как defense-in-depth: если фильтр
  // когда-то промахнётся / race с deactivation → не упадём.
  requires: { kind: 'google_oauth' },
  examples: ['разбери почту', 'что в почте', 'есть важные письма'],
  handler: async (_input, ctx) => {
    try {
      const t = await triageInbox(ctx.userId);
      return {
        connected: true,
        summary: t.summary,
        important: t.important.map((m) => ({
          from: m.from,
          subject: m.subject,
        })),
      };
    } catch (err) {
      // Friend-UX: НЕ throw — agent увидит structured «not connected»
      // и объяснит юзеру по-человечески, не как technical ошибка.
      if (err instanceof GoogleCalendarError) {
        if (err.code === 'auth_failed') {
          return {
            connected: false,
            reason: 'not_connected',
            message:
              'Gmail не подключён. Если хочешь, чтобы я разбирал ' +
              'почту — подключи Google в настройках интеграций.',
          };
        }
        if (err.code === 'token_refresh_failed') {
          return {
            connected: false,
            reason: 'token_expired',
            message:
              'Google-токен истёк и не обновился. Переподключи ' +
              'Google в настройках, чтобы я снова мог читать почту.',
          };
        }
        // api_error / not_configured / прочее: временный сбой Google
        return {
          connected: false,
          reason: 'api_error',
          message:
            'Gmail сейчас временно недоступен (Google API). Попробую ' +
            'позже — если сразу нужно, разбирай руками.',
        };
      }
      // Неизвестная ошибка — тоже graceful (не падаем в orchestrator).
      console.warn('[get_email_triage] unexpected:', err);
      return {
        connected: false,
        reason: 'unexpected_error',
        message: 'Не смог получить почту сейчас, попробую позже.',
      };
    }
  },
});
