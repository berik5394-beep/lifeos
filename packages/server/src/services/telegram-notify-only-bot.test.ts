import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Telegram } from 'telegraf';
import { NOTIFY_REDIRECT, NOTIFY_WELCOME } from './telegram-notify-only.js';

// Мозг и база не должны вызываться в режиме «только уведомления».
const handleMessage = vi.fn();
vi.mock('./jarvis-orchestrator.js', () => ({ handleMessage }));

describe('бот в режиме «только уведомления» — живой Telegraf с подменённым API', { timeout: 30_000 }, () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAEexampleExampleExampleExampleExampleEx';
    delete process.env.TELEGRAM_BOT_MODE;
  });

  // Telegraf создаёт свой Telegram на каждый апдейт — подменяем прототип.
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const spy = vi.spyOn(Telegram.prototype, 'callApi').mockImplementation((async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    return method === 'getMe' ? { id: 1, is_bot: true, username: 'LifeOS_jarvis_bot', first_name: 'L' } : true;
  }) as unknown as Telegram['callApi']);
  afterAll(() => spy.mockRestore());

  async function botWithFakeApi() {
    const { createTelegramBot } = await import('./telegram-bot.js');
    const bot = createTelegramBot();
    calls.length = 0;
    (bot as unknown as { botInfo: unknown }).botInfo = { id: 1, is_bot: true, username: 'LifeOS_jarvis_bot', first_name: 'L' };
    return { bot, calls };
  }
  const msg = (text: string) => ({
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: 77, type: 'private' as const, first_name: 'A' }, from: { id: 77, is_bot: false, first_name: 'A' }, text },
  });

  it('обычное сообщение → «пиши в приложении», мозг не зовём', async () => {
    const { bot, calls } = await botWithFakeApi();
    await bot.handleUpdate(msg('потратил 5000 на обед'));
    const sent = calls.filter((c) => c.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.text).toBe(NOTIFY_REDIRECT);
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('/start без кода → где включить уведомления', async () => {
    const { bot, calls } = await botWithFakeApi();
    await bot.handleUpdate(msg('/start'));
    expect(calls.find((c) => c.method === 'sendMessage')?.payload.text).toBe(NOTIFY_WELCOME);
  });
});
