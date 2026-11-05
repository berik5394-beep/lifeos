import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Привязка Telegram-чата к аккаунту приложения по ОДНОРАЗОВОМУ КОДУ.
 *
 * Дыра, которую закрываем: /integrations/telegram/connect принимал любой
 * chatId без доказательства владения. Привязал чужой chatId → бот, ища
 * хозяина по chatId, отправлял жертву в ЧУЖОЙ аккаунт (её расходы/память
 * уходили злоумышленнику, ей показывались его данные).
 *
 * Модель угроз и защита:
 *  - чат доказывает владение сам: chatId берётся из апдейта Telegram, код
 *    приходит боту ИЗ этого чата; код выдаётся только по JWT;
 *  - фишинг («перейди по ссылке» с кодом злоумышленника): привязка ВСЕГДА
 *    через подтверждение, где названо, к ЧЬЕМУ аккаунту (имя + маска email);
 *  - подделанный callback «да» с угаданным кодом: «да» принимается только из
 *    чата, где код проверили (confirmChatId), и считается в анти-перебор;
 *  - группы: только личный чат (иначе все участники попали бы в аккаунт).
 *
 * Бот-аккаунт с историей (решение Berik 2026-11-05): не сливаем и не
 * удаляем — предупреждаем; после «да» чат переезжает, история остаётся
 * в старом аккаунте (его привязка деактивируется, не удаляется).
 */

export const LINK_CODE_TTL_MS = 10 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O/1/I
const CODE_LEN = 8;
export const LINK_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

// Имя бота для deep-link. Настоящее берём у запущенного бота (getMe) — ссылка
// на чужого бота отдала бы коды его владельцу. Дефолт = наш прод-бот.
let runtimeBotUsername: string | null = null;
export function setTelegramBotUsername(name: string | null): void {
  runtimeBotUsername = name;
}
export function telegramBotUsername(): string {
  return runtimeBotUsername || process.env.TELEGRAM_BOT_USERNAME || 'LifeOS_jarvis_bot';
}

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** «b***@gmail.com»; синтетический tg-email и мусор → null (не показываем). */
export function maskEmail(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 1) return null;
  const domain = email.slice(at + 1);
  if (!domain || domain === 'telegram.lifeos') return null;
  return `${email[0]}***@${domain}`;
}

/** Новый код для юзера; прежние коды этого юзера гасятся. */
export async function createLinkCode(
  userId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  const code = generateCode();
  await prisma.$transaction([
    prisma.telegramLinkCode.deleteMany({ where: { userId } }),
    prisma.telegramLinkCode.create({ data: { code, userId, expiresAt } }),
  ]);
  return { code, expiresAt };
}

/** Кто сейчас активный хозяин чата (или null). */
async function activeChatOwner(chatId: string): Promise<string | null> {
  const integ = await prisma.integration.findFirst({
    where: { provider: 'telegram', active: true, settings: { path: ['chatId'], equals: chatId } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  });
  return integ?.userId ?? null;
}

/** Есть ли у аккаунта история, которую юзер перестанет видеть из бота. */
async function hasHistory(userId: string): Promise<boolean> {
  const where = { userId };
  const sel = { select: { id: true } } as const;
  const hits = await Promise.all([
    prisma.chatMessage.findFirst({ where, ...sel }),
    prisma.task.findFirst({ where, ...sel }),
    prisma.memory.findFirst({ where, ...sel }),
    prisma.expense.findFirst({ where, ...sel }),
    prisma.income.findFirst({ where, ...sel }),
    prisma.habit.findFirst({ where, ...sel }),
    prisma.yearlyGoal.findFirst({ where, ...sel }),
    prisma.calendarEvent.findFirst({ where, ...sel }),
    prisma.journalEntry.findFirst({ where, ...sel }),
    prisma.obligation.findFirst({ where, ...sel }),
  ]);
  return hits.some((h) => h !== null);
}

async function accountLabel(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const masked = u ? maskEmail(u.email) : null;
  return `«${u?.name || 'без имени'}»${masked ? ` (${masked})` : ''}`;
}

export type LinkPreview =
  | { status: 'invalid' }
  | { status: 'already'; userId: string }
  | { status: 'confirm'; userId: string; accountLabel: string; previousHasHistory: boolean };

/**
 * Проверка кода БЕЗ погашения. Для привязки помечает код чатом, в котором
 * его проверили (confirmChatId) — только оттуда потом примется «да».
 */
export async function previewLink(code: string, chatId: string): Promise<LinkPreview> {
  if (!LINK_CODE_RE.test(code)) return { status: 'invalid' };
  const row = await prisma.telegramLinkCode.findFirst({
    where: { code, expiresAt: { gt: new Date() } },
    select: { userId: true },
  });
  if (!row) return { status: 'invalid' };
  const owner = await activeChatOwner(chatId);
  if (owner === row.userId) return { status: 'already', userId: row.userId };
  await prisma.telegramLinkCode.update({ where: { code }, data: { confirmChatId: chatId } });
  return {
    status: 'confirm',
    userId: row.userId,
    accountLabel: await accountLabel(row.userId),
    previousHasHistory: owner !== null && (await hasHistory(owner)),
  };
}

/**
 * Атомарно гасит код и привязывает чат. Только если код проверен ИМЕННО в
 * этом чате (confirmChatId). Погашение — DELETE … RETURNING (двойное «да» не
 * привяжет дважды). Advisory-lock по chatId сериализует с findOrCreateUser —
 * не будет двух активных привязок одного чата. Прежние активные привязки
 * чата деактивируются (не удаляются — данные не трогаем).
 */
export async function consumeLink(
  code: string,
  chatId: string,
  telegramId: number,
  username?: string,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  if (!LINK_CODE_RE.test(code)) return { ok: false };
  return prisma.$transaction(async (tx) => {
    await lockTelegramChat(tx, chatId);
    const rows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      DELETE FROM "TelegramLinkCode"
      WHERE "code" = ${code} AND "confirmChatId" = ${chatId} AND "expiresAt" > ${new Date()}
      RETURNING "userId"`);
    const userId = rows[0]?.userId;
    if (!userId) return { ok: false as const };

    await tx.integration.updateMany({
      where: {
        provider: 'telegram',
        active: true,
        userId: { not: userId },
        settings: { path: ['chatId'], equals: chatId },
      },
      data: { active: false },
    });
    // @@unique([userId, provider]): если юзер раньше привязал ДРУГОЙ чат —
    // строка переезжает на этот; прежний чат при следующем сообщении уйдёт
    // в свой собственный бот-аккаунт (findOrCreateUser).
    const settings = { chatId, telegramId, username: username ?? null };
    await tx.integration.upsert({
      where: { userId_provider: { userId, provider: 'telegram' } },
      create: { userId, provider: 'telegram', active: true, settings },
      update: { active: true, settings },
    });
    return { ok: true as const, userId };
  });
}

/** Транзакционный advisory-lock на chatId (общий для привязки и findOrCreateUser). */
export async function lockTelegramChat(tx: Prisma.TransactionClient, chatId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'tg:' + chatId}))`);
}

// ---- Анти-перебор: 5 промахов из чата за 15 мин → блок. In-memory: polling
// у Telegram единственный (один процесс) → фактически глобально; сброс на деплое.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;
const failures = new Map<string, { count: number; resetAt: number }>();

export function noteLinkFailure(chatId: string): void {
  const now = Date.now();
  if (failures.size >= MAX_TRACKED) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  }
  const f = failures.get(chatId);
  if (!f || f.resetAt <= now) failures.set(chatId, { count: 1, resetAt: now + WINDOW_MS });
  else f.count++;
}

export function isLinkLocked(chatId: string): boolean {
  const f = failures.get(chatId);
  if (!f) return false;
  if (f.resetAt <= Date.now()) {
    failures.delete(chatId);
    return false;
  }
  return f.count >= MAX_FAILS;
}

const LOCKED_TEXT = 'Слишком много неверных кодов. Подожди 15 минут и попробуй снова.';
const PRIVATE_ONLY_TEXT =
  'Привязка — только в личном чате с ботом. Открой бота в личке и пришли код там.';
const STALE_TEXT =
  'Код не подошёл: он неверный или устарел (живёт 10 минут). ' +
  'Возьми новый в приложении: Настройки → Интеграции → Telegram.';

/**
 * Что бот отвечает на код из чата (логика без Telegraf — тестируется на БД).
 * confirmCode задан → бот показывает кнопки «Да, привязать» / «Отмена».
 */
export async function handleLinkRequest(
  code: string,
  chatId: string,
  telegramId: number,
  chatType: string,
): Promise<{ text: string; confirmCode?: string }> {
  if (chatType !== 'private') return { text: PRIVATE_ONLY_TEXT };
  if (isLinkLocked(chatId)) return { text: LOCKED_TEXT };
  const normalized = code.trim().toUpperCase();
  const preview = await previewLink(normalized, chatId);
  if (preview.status === 'invalid') {
    noteLinkFailure(chatId);
    return { text: STALE_TEXT };
  }
  if (preview.status === 'already') {
    return { text: 'Этот чат уже привязан к твоему аккаунту LifeOS 👍' };
  }
  const history = preview.previousHasHistory
    ? '\n\nВ этом чате уже есть история с LifeOS (задачи, память, расходы). После ' +
      'привязки бот начнёт работать с аккаунтом выше, а прежняя история останется в ' +
      'старом аккаунте — я её не удаляю, но здесь она будет не видна.'
    : '';
  return {
    confirmCode: normalized,
    text:
      `Привязать этот чат к аккаунту LifeOS ${preview.accountLabel}?` +
      history +
      '\n\nЕсли это не твой аккаунт или ты не нажимал «Подключить» в приложении — жми «Отмена».',
  };
}

/** «Да, привязать» на кнопке подтверждения. */
export async function confirmLinkRequest(
  code: string,
  chatId: string,
  telegramId: number,
  chatType: string,
  username?: string,
): Promise<string> {
  if (chatType !== 'private') return PRIVATE_ONLY_TEXT;
  if (isLinkLocked(chatId)) return LOCKED_TEXT;
  const r = await consumeLink(code, chatId, telegramId, username);
  if (!r.ok) {
    noteLinkFailure(chatId);
    return 'Не получилось: код уже использован или устарел. Если чат ещё не привязан — возьми новый код в приложении.';
  }
  return `Готово ✅ Чат привязан к аккаунту LifeOS ${await accountLabel(r.userId)}.`;
}
