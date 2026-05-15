import { prisma } from '../lib/prisma.js';
import { sendTelegramTo } from './telegram-bot.js';

/**
 * Доставка проактивных уведомлений.
 *
 * App-first (правило проекта): ОСНОВНОЙ канал — Expo Push в мобильное
 * приложение. Telegram-бот — ВТОРИЧНОЕ зеркало для тех, у кого привязан
 * бот (его всё равно увидят даже при закрытом приложении).
 *
 * Expo Push HTTP API: https://exp.host/--/api/v2/push/send — без SDK,
 * без APNs/FCM-ключей (Expo сам проксирует в Apple/Google).
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  data?: Record<string, unknown>;
}

/** Валидный Expo push token: ExponentPushToken[...] или ExpoPushToken[...] */
function isExpoToken(t: string | null | undefined): t is string {
  return !!t && /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<boolean> {
  const msg: ExpoPushMessage = {
    to: token,
    title,
    body,
    sound: 'default',
    priority: 'high',
    ...(data ? { data } : {}),
  };
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      console.warn(`[push] expo push HTTP ${res.status}`);
      return false;
    }
    const json = (await res.json()) as {
      data?: { status?: string; message?: string };
    };
    if (json.data?.status === 'error') {
      console.warn(`[push] expo push error: ${json.data.message}`);
      // DeviceNotRegistered → токен мёртв, чистим чтобы не долбить
      if (json.data.message?.includes('DeviceNotRegistered')) {
        await prisma.user
          .updateMany({ where: { expoPushToken: token }, data: { expoPushToken: null } })
          .catch(() => {});
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[push] expo push exception:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Найти telegram chatId юзера (для зеркала). */
async function getTelegramChatId(userId: string): Promise<string | null> {
  const integ = await prisma.integration.findFirst({
    where: { userId, provider: 'telegram', active: true },
    select: { settings: true },
  });
  if (!integ) return null;
  const s = integ.settings as unknown as { chatId?: string };
  return s?.chatId ?? null;
}

export interface DeliveryResult {
  push: boolean;
  telegram: boolean;
}

/**
 * Доставить одно уведомление пользователю по всем доступным каналам.
 * Primary — Expo Push (если есть токен). Mirror — Telegram (если привязан).
 */
export async function deliverNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<DeliveryResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true },
  });

  let push = false;
  if (isExpoToken(user?.expoPushToken)) {
    push = await sendExpoPush(user!.expoPushToken!, title, body, data);
  }

  let telegram = false;
  const chatId = await getTelegramChatId(userId);
  if (chatId) {
    // В Telegram заголовок + тело одним сообщением (у бота нет «title»).
    telegram = await sendTelegramTo(chatId, `${title}\n\n${body}`);
  }

  return { push, telegram };
}
