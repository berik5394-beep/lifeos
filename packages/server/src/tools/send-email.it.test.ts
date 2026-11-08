import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { sendEmailTool } from './send-email.js';
import { agentToolNamesForUser, confirmToolNamesForUser } from './index.js';
import { encrypt } from '../lib/crypto.js';
import { GMAIL_SEND_SCOPE } from '../services/google-calendar.js';

/** Руки во внешнем мире №4: письмо через Gmail — только после «да», честно про права. */
const prisma = new PrismaClient();
// Тест-окружение несёт короткий ключ; шифрованию токенов Google нужен 64-hex.
const savedKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
afterAll(async () => {
  process.env.ENCRYPTION_KEY = savedKey;
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());
const ctx = (userId: string) => ({ userId }) as never;
const user = async () =>
  (await prisma.user.create({ data: { email: `se-${Date.now()}-${Math.random()}@a.test`, name: 'Б', passwordHash: 'x' } })).id;
const connectGoogle = (userId: string, scopes: string[]) =>
  prisma.integration.create({
    data: {
      userId,
      provider: 'google_calendar',
      accessToken: encrypt('access-token'),
      refreshToken: encrypt('refresh-token'),
      settings: { expiresAt: Date.now() + 3_600_000, scopes },
      active: true,
    },
  });

describe('send_email', () => {
  it('только с подтверждением: агенту — как предложение, не как действие', async () => {
    const u = await user();
    await connectGoogle(u, [GMAIL_SEND_SCOPE]);
    expect((await confirmToolNamesForUser(u)).has('send_email')).toBe(true);
    expect((await agentToolNamesForUser(u)).has('send_email')).toBe(false);
  });

  it('по имени: адрес из памяти → Gmail получает письмо', async () => {
    const u = await user();
    await connectGoogle(u, ['https://www.googleapis.com/auth/calendar', GMAIL_SEND_SCOPE]);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', attributes: { email: 'serik@mail.kz' } } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendEmailTool.handler({ to: 'Серик', subject: 'Прайс', body: 'Пришлю завтра.' }, ctx(u));
    expect(r).toMatchObject({ sent: true, message: 'Отправил письмо Серик (serik@mail.kz): «Прайс».' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('адреса нет — честно просит, ничего не отправляет', async () => {
    const u = await user();
    await connectGoogle(u, [GMAIL_SEND_SCOPE]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendEmailTool.handler({ to: 'Ерлан', subject: 'x', body: 'y' }, ctx(u));
    expect(r).toMatchObject({ sent: false, message: 'Не знаю почту Ерлан. Скажи адрес — запомню и отправлю.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Google подключён раньше, без права на отправку — «переподключи»', async () => {
    const u = await user();
    await connectGoogle(u, ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.readonly']);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendEmailTool.handler({ to: 'a@b.kz', subject: 'x', body: 'y' }, ctx(u));
    expect(r).toMatchObject({ sent: false, error: 'need_reconnect' });
    expect(String((r as { message: string }).message)).toMatch(/переподключи Google/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
