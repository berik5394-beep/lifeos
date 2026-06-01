/**
 * 2.4 (AUDIT-2026-06): лёгкий алертинг прод-ошибок в Telegram.
 *
 * Раньше падения тонули в console/Railway-логах — никого не пейджило, и
 * проблему замечали только когда жаловался юзер. Это «лёгкий» путь (без
 * внешнего APM/Sentry): критичная ошибка → сообщение в Telegram-чат админа.
 *
 * Намеренно НЕЗАВИСИМ от telegraf-бота (sendTelegramTo завязан на activeBot,
 * который может быть null именно когда нужен алерт — краш на старте/шатдауне).
 * Поэтому прямой вызов Bot API через fetch. Best-effort: никогда не бросает,
 * всегда дублирует в console.error.
 *
 * Конфиг (ENV, опционально — без них алерт = только лог):
 *   TELEGRAM_BOT_TOKEN        — токен бота (уже есть)
 *   ALERT_TELEGRAM_CHAT_ID    — chatId админа, куда слать алерты
 *
 * Sentry-аккаунт у Berik есть — полноценный APM подключим позже (Phase 2.4+).
 */

const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const lastSent = new Map<string, number>();

export async function alertError(context: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && err.stack
      ? err.stack.split('\n').slice(0, 4).join('\n')
      : '';

  // Всегда в логи — независимо от того, настроен ли Telegram-алерт.
  console.error(`[alert:${context}]`, msg);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // алерты в TG не настроены — выходим

  // Троттлинг одинаковых ошибок, чтобы не залить чат при шторме.
  const key = `${context}:${msg}`.slice(0, 200);
  const now = Date.now();
  const prev = lastSent.get(key);
  if (prev && now - prev < ALERT_THROTTLE_MS) return;
  lastSent.set(key, now);

  const text = `🚨 LifeOS prod\nКонтекст: ${context}\n${msg}${
    stack ? '\n\n' + stack : ''
  }`.slice(0, 3500);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  } catch (e) {
    console.warn(
      '[alert] telegram send failed:',
      e instanceof Error ? e.message : e,
    );
  }
}

/** Для тестов — сброс троттлинга между кейсами. */
export function _resetAlertThrottle(): void {
  lastSent.clear();
}
