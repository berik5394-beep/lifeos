import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createLinkCode,
  previewLink,
  consumeLink,
  LINK_CODE_TTL_MS,
  noteLinkFailure,
  isLinkLocked,
  handleLinkRequest,
  confirmLinkRequest,
  maskEmail,
  telegramBotUsername,
  setTelegramBotUsername,
} from './telegram-link.js';
import { findOrCreateUser } from './telegram-bot.js';

/**
 * Привязка Telegram по одноразовому коду (фикс дыры: /telegram/connect
 * принимал ЛЮБОЙ chatId без доказательства владения → можно было увести
 * чужой бот-чат в свой аккаунт). Теперь чат доказывает сам Telegram (код
 * приходит ИЗ этого чата), код выдаётся только авторизованному юзеру,
 * привязка ВСЕГДА через подтверждение с именем аккаунта (анти-фишинг),
 * «да» принимается только из чата, где код проверили, и только в личке.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

let seq = 0;
async function user(label: string, email?: string): Promise<string> {
  seq++;
  const u = await prisma.user.create({
    data: {
      email: email ?? `tgl-${label}-${seq}-${Date.now()}@a.test`,
      name: label,
      passwordHash: 'x',
    },
  });
  return u.id;
}
async function bindChat(userId: string, chatId: string): Promise<void> {
  await prisma.integration.create({
    data: { userId, provider: 'telegram', active: true, settings: { chatId, telegramId: Number(chatId) } },
  });
}
const activeOwnerOf = async (chatId: string) =>
  (await prisma.integration.findMany({
    where: { provider: 'telegram', active: true, settings: { path: ['chatId'], equals: chatId } },
    select: { userId: true },
  })).map((i) => i.userId);

describe('telegram-link: одноразовый код', () => {
  it('код = 8 символов без путаемых (0/O/1/I), живёт 10 минут', async () => {
    const uid = await user('app');
    const before = Date.now();
    const { code, expiresAt } = await createLinkCode(uid);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + LINK_CODE_TTL_MS - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + LINK_CODE_TTL_MS);
  });

  it('новый код гасит прежний код того же юзера', async () => {
    const uid = await user('app');
    const first = await createLinkCode(uid);
    await createLinkCode(uid);
    expect((await previewLink(first.code, '111')).status).toBe('invalid');
  });

  it('свободный чат: preview → confirm (имя аккаунта); consume привязывает ЭТОТ чат; код одноразовый', async () => {
    const uid = await user('Берик', `berik-${Date.now()}@gmail.com`);
    const { code } = await createLinkCode(uid);
    const p = await previewLink(code, '5001');
    expect(p).toMatchObject({ status: 'confirm', userId: uid, previousHasHistory: false });
    if (p.status === 'confirm') expect(p.accountLabel).toMatch(/^«Берик» \(b\*\*\*@gmail\.com\)$/);
    expect(await activeOwnerOf('5001')).toEqual([]); // preview НЕ привязывает
    const r = await consumeLink(code, '5001', 5001, 'berik');
    expect(r).toEqual({ ok: true, userId: uid });
    expect(await activeOwnerOf('5001')).toEqual([uid]);
    expect((await consumeLink(code, '5001', 5001)).ok).toBe(false);
  });

  it('«да» принимается ТОЛЬКО из чата, где код проверили (подделанный callback из другого чата не проходит)', async () => {
    const uid = await user('app');
    const { code } = await createLinkCode(uid);
    // без preview вообще — consume не проходит
    expect((await consumeLink(code, '5100', 5100)).ok).toBe(false);
    await previewLink(code, '5101');
    expect((await consumeLink(code, '5102', 5102)).ok).toBe(false);
    expect(await activeOwnerOf('5102')).toEqual([]);
    // а из правильного чата — проходит (код не сгорел на чужой попытке)
    expect((await consumeLink(code, '5101', 5101)).ok).toBe(true);
  });

  it('просроченный код недействителен', async () => {
    const uid = await user('app');
    const { code } = await createLinkCode(uid);
    await previewLink(code, '5003');
    await prisma.telegramLinkCode.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await previewLink(code, '5003')).status).toBe('invalid');
    expect((await consumeLink(code, '5003', 5003)).ok).toBe(false);
  });

  it('чат уже у этого же юзера → already', async () => {
    const uid = await user('app');
    await bindChat(uid, '5004');
    const { code } = await createLinkCode(uid);
    expect((await previewLink(code, '5004')).status).toBe('already');
  });

  it('чат у бот-аккаунта С ИСТОРИЕЙ → confirm c previousHasHistory; после «да» переносится, история цела', async () => {
    const appUid = await user('app');
    const botUid = await user('bot');
    await bindChat(botUid, '5005');
    await prisma.task.create({
      data: { userId: botUid, title: 'старая задача', category: 'personal', priority: 'medium', date: new Date('2026-11-01') },
    });
    const { code } = await createLinkCode(appUid);
    expect(await previewLink(code, '5005')).toMatchObject({ status: 'confirm', userId: appUid, previousHasHistory: true });

    const r = await consumeLink(code, '5005', 5005);
    expect(r).toEqual({ ok: true, userId: appUid });
    expect(await activeOwnerOf('5005')).toEqual([appUid]);
    // Данные не удаляются и не сливаются (решение Berik 2026-11-05).
    expect(await prisma.task.count({ where: { userId: botUid } })).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: botUid } })).not.toBeNull();
  });

  it('история = в т.ч. цели/события/дневник (не только задачи/чат)', async () => {
    const appUid = await user('app');
    const botUid = await user('bot');
    await bindChat(botUid, '5008');
    await prisma.yearlyGoal.create({ data: { userId: botUid, year: 2026, area: 'finance', goalText: 'миллион' } });
    const { code } = await createLinkCode(appUid);
    expect(await previewLink(code, '5008')).toMatchObject({ previousHasHistory: true });
  });

  it('после привязки бот на сообщения из чата резолвит ЮЗЕРА ПРИЛОЖЕНИЯ, нового аккаунта не создаёт', async () => {
    const appUid = await user('app');
    const botUid = await user('bot');
    await bindChat(botUid, '5007');
    const { code } = await createLinkCode(appUid);
    await previewLink(code, '5007');
    await consumeLink(code, '5007', 5007);
    const usersBefore = await prisma.user.count();
    expect(await findOrCreateUser('5007', 5007, 'Берик')).toBe(appUid);
    expect(await prisma.user.count()).toBe(usersBefore);
  });

  it('перебор кодов: 5 промахов из чата → блок; другой чат не затронут', () => {
    for (let i = 0; i < 5; i++) noteLinkFailure('6001');
    expect(isLinkLocked('6001')).toBe(true);
    expect(isLinkLocked('6002')).toBe(false);
  });

  it('удаление юзера стирает его коды (каскад)', async () => {
    const uid = await user('app');
    await createLinkCode(uid);
    await prisma.user.delete({ where: { id: uid } });
    expect(await prisma.telegramLinkCode.count({ where: { userId: uid } })).toBe(0);
  });

  describe('handleLinkRequest / confirmLinkRequest — что отвечает бот', () => {
    it('ВСЕГДА спрашивает подтверждение и называет аккаунт (анти-фишинг), ничего не привязывая', async () => {
      const uid = await user('Айгуль', `aigul-${Date.now()}@mail.kz`);
      const { code } = await createLinkCode(uid);
      const r = await handleLinkRequest(code, '7001', 7001, 'private');
      expect(r.confirmCode).toBe(code);
      expect(r.text).toContain('«Айгуль»');
      expect(r.text).toContain('a***@mail.kz');
      expect(await activeOwnerOf('7001')).toEqual([]);
      const done = await confirmLinkRequest(code, '7001', 7001, 'private');
      expect(done).toContain('«Айгуль»');
      expect(await activeOwnerOf('7001')).toEqual([uid]);
    });

    it('чат с историей → в тексте предупреждение про историю', async () => {
      const appUid = await user('app');
      const botUid = await user('bot');
      await bindChat(botUid, '7002');
      await prisma.memory.create({ data: { userId: botUid, content: 'люблю кофе', type: 'fact', source: 'chat', tags: [] } });
      const { code } = await createLinkCode(appUid);
      const r = await handleLinkRequest(code, '7002', 7002, 'private');
      expect(r.confirmCode).toBe(code);
      expect(r.text).toMatch(/истори/i);
      expect(await activeOwnerOf('7002')).toEqual([botUid]);
    });

    it('группа/канал → отказ, код не тронут, ничего не привязано', async () => {
      const uid = await user('app');
      const { code } = await createLinkCode(uid);
      const r = await handleLinkRequest(code, '-100500', 7004, 'group');
      expect(r.confirmCode).toBeUndefined();
      expect(r.text).toMatch(/личн/i);
      expect(await confirmLinkRequest(code, '-100500', 7004, 'supergroup')).toMatch(/личн/i);
      expect(await activeOwnerOf('-100500')).toEqual([]);
      expect(await prisma.telegramLinkCode.count({ where: { code } })).toBe(1);
    });

    it('неверный код → честный отказ + промах; после 5 → блок', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await handleLinkRequest('ZZZZZZZZ', '7003', 7003, 'private');
        expect(r.text).toMatch(/не подош[её]л/i);
      }
      const locked = await handleLinkRequest('ZZZZZZZZ', '7003', 7003, 'private');
      expect(locked.text).toMatch(/слишком много/i);
    });

    it('подделанные «да» тоже считаются промахами и упираются в блок', async () => {
      for (let i = 0; i < 5; i++) await confirmLinkRequest('YYYYYYYY', '7005', 7005, 'private');
      expect(isLinkLocked('7005')).toBe(true);
      const uid = await user('app');
      const { code } = await createLinkCode(uid);
      expect(await confirmLinkRequest(code, '7005', 7005, 'private')).toMatch(/слишком много/i);
      expect(await activeOwnerOf('7005')).toEqual([]);
    });
  });
});

describe('telegram-link: имя бота и маска email', () => {
  it('дефолт = настоящий бот @LifeOS_jarvis_bot; рантайм-имя из getMe перекрывает', () => {
    const prev = process.env.TELEGRAM_BOT_USERNAME;
    delete process.env.TELEGRAM_BOT_USERNAME;
    try {
      expect(telegramBotUsername()).toBe('LifeOS_jarvis_bot');
      setTelegramBotUsername('Real_bot');
      expect(telegramBotUsername()).toBe('Real_bot');
    } finally {
      setTelegramBotUsername(null);
      if (prev !== undefined) process.env.TELEGRAM_BOT_USERNAME = prev;
    }
  });
  it('maskEmail: первая буква + *** + домен; синтетический tg-email не показываем', () => {
    expect(maskEmail('berik5394@gmail.com')).toBe('b***@gmail.com');
    expect(maskEmail('tg7008865459@telegram.lifeos')).toBeNull();
    expect(maskEmail('bad')).toBeNull();
  });
});
