/**
 * Бот — только канал уведомлений (Berik 2026-11-09, чистка №5: «Telegram-бот
 * был тестом», один мозг — в приложении). TELEGRAM_BOT_MODE=full возвращает
 * прежнего бота-собеседника (код не удалён); по умолчанию — notify:
 *  - привязка аккаунта из приложения (deep-link /start link_…, /link, кнопки
 *    «Да, привязать»/«Отмена») работает как раньше — это канал уведомлений;
 *  - /start без кода — объяснение, где включить уведомления (бот-аккаунт НЕ создаём);
 *  - всё остальное (текст, голос, фото, команды) — «пиши в приложении», без модели.
 */

export type NotifyOnlyRoute = 'pass' | 'welcome' | 'redirect' | 'ignore';

export function telegramBotMode(env: NodeJS.ProcessEnv = process.env): 'full' | 'notify' {
  return (env.TELEGRAM_BOT_MODE ?? '').trim().toLowerCase() === 'full' ? 'full' : 'notify';
}

/** Куда направить апдейт в режиме «только уведомления». */
export function notifyOnlyRoute(u: { text?: string; callbackData?: string; hasMessage: boolean }): NotifyOnlyRoute {
  if (u.callbackData !== undefined) return u.callbackData.startsWith('tglink:') ? 'pass' : 'ignore';
  const text = (u.text ?? '').trim();
  if (/^\/link(@\w+)?(\s|$)/.test(text)) return 'pass';
  const start = text.match(/^\/start(@\w+)?(?:\s+(\S+))?/);
  if (start) return start[2]?.startsWith('link_') ? 'pass' : 'welcome';
  return u.hasMessage ? 'redirect' : 'ignore';
}

export const NOTIFY_WELCOME =
  'Привет! Здесь я присылаю уведомления LifeOS — напоминания, утренний бриф, итоги дня.\n\n' +
  'Чтобы получать их сюда, открой приложение LifeOS → Настройки → Интеграции → Telegram и нажми «Подключить».';

export const NOTIFY_REDIRECT =
  'Я теперь живу в приложении LifeOS — там помню всё о тебе и делаю дела. ' +
  'Напиши или скажи мне там. А сюда буду присылать уведомления.';
