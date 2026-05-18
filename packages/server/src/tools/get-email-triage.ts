import { z } from 'zod';
import { triageInbox } from '../services/gmail.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.3 — миграция agent-only read-tool get_email_triage в
 * реестр. Логика 1:1 с прежним runLocalTool('get_email_triage').
 * claude-agent свич — 9A.8. Тонкая обёртка над gmail.triageInbox
 * (legacy switch не задействован).
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
  examples: ['разбери почту', 'что в почте', 'есть важные письма'],
  handler: async (_input, ctx) => {
    const t = await triageInbox(ctx.userId);
    return {
      summary: t.summary,
      important: t.important.map((m) => ({
        from: m.from,
        subject: m.subject,
      })),
    };
  },
});
