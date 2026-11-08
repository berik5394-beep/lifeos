import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';
import { isEmail, MailSendError, sendGmail } from '../services/gmail-send.js';

/**
 * Руки во внешнем мире (jarvis-roadmap №4): письмо от имени пользователя через
 * его Gmail. needsConfirm:true + sideEffects:'external' → агент только
 * ПРЕДЛАГАЕТ (черновик: кому, тема, текст), отправка — после «да». Тот же
 * инвариант, что у денег и send_telegram. Не снимать confirm.
 *
 * Кому: адрес или имя человека из памяти (attributes.email). Адреса нет —
 * честно просим его, а не выдумываем.
 */
export const sendEmailTool = defineTool({
  name: 'send_email',
  description:
    'Отправить письмо от имени пользователя через его Gmail: «напиши Серику, что прайс пришлю завтра», ' +
    '«отправь Айгуль на почту поручение сверить акты». Ты составляешь тему и короткий вежливый текст ' +
    'от лица пользователя (по-русски, без markdown). Получатель — адрес или имя человека, чью почту помнишь. ' +
    'Отправка — только после явного «да» пользователя. Сообщение себе в Telegram — это send_telegram, не я.',
  category: 'system',
  aliases: { recipient: 'to', email: 'to', address: 'to', person: 'to', title: 'subject', text: 'body', message: 'body', content: 'body' },
  schema: z.object({
    to: z.string().min(1).max(200).describe('Адрес почты или имя человека («Серик»)'),
    subject: z.string().min(1).max(200).describe('Тема письма'),
    body: z.string().min(1).max(5000).describe('Текст письма от лица пользователя'),
  }),
  needsConfirm: true,
  sideEffects: 'external',
  requires: { kind: 'google_oauth' },
  examples: ['напиши Серику на почту, что прайс пришлю завтра', 'отправь письмо ahmet@mail.kz про встречу'],
  handler: async (input, ctx) => {
    let address = input.to.trim();
    let who = address;
    if (!isEmail(address)) {
      const person = await getEntityGraph().resolveEntity(ctx.userId, address, 'person').catch(() => null);
      const attrs = (person?.attributes ?? {}) as Record<string, unknown>;
      const found = [attrs.email, attrs['почта'], attrs['e-mail']].find((v): v is string => typeof v === 'string' && isEmail(v));
      if (!found) {
        return {
          sent: false,
          message: `Не знаю почту ${person?.name ?? address}. Скажи адрес — запомню и отправлю.`,
        };
      }
      address = found;
      who = `${person?.name ?? input.to} (${found})`;
    }
    try {
      await sendGmail(ctx.userId, { to: address, subject: input.subject, body: input.body });
      return { sent: true, message: `Отправил письмо ${who}: «${input.subject}».` };
    } catch (err) {
      if (err instanceof MailSendError) return { sent: false, error: err.code, message: err.message };
      throw err;
    }
  },
});
