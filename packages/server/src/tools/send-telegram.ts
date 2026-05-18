import { z } from 'zod';
import { defineTool } from './_types.js';
import { sendTelegramMessage } from '../services/external-apis.js';

/**
 * SSOT 9B.2 — последний legacy-кейс из action-executor переехал в
 * реестр. sideEffects:'external' + needsConfirm:true: исходящая
 * отправка себе в Telegram идёт ТОЛЬКО после явного «да» (confirm-FSM,
 * Step 4). Логика 1:1 с прежним legacy `send_telegram` case.
 *
 * SECURITY: needsConfirm:true → agentToolSchemas() АВТОМАТИЧЕСКИ
 * исключает этот tool из автономного агент-цикла (внешний side-effect
 * никогда не выполняется без участия пользователя — тот же инвариант,
 * что и для денег). Не снимать confirm с этого tool.
 */
export const sendTelegramTool = defineTool({
  name: 'send_telegram',
  description:
    'Отправить пользователю сообщение в его Telegram. Внешняя ' +
    'отправка — выполняется только после явного подтверждения ' +
    '(«да»). Не подтверждай сам.',
  category: 'system',
  schema: z.object({
    text: z.string().min(1).max(4000),
  }),
  needsConfirm: true,
  sideEffects: 'external',
  examples: ['отправь мне в телеграм список задач', 'скинь это в telegram'],
  handler: async (input, ctx) => {
    const text = input.text.trim();
    if (!text) return { message: 'Нечего отправлять — пустой текст.' };
    const res = await sendTelegramMessage(ctx.userId, text);
    return { message: res };
  },
});
