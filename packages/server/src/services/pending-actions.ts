/**
 * Фаза 1.2 — gate подтверждения необратимых/денежных действий.
 *
 * Джарвис действует, но под контролем: денежные команды (add_expense,
 * add_income) НЕ выполняются сразу — сначала спрашиваем «записать?».
 * Юзер подтверждает кнопкой (приложение → /voice/confirm-action) или
 * естественным «да/нет» (Telegram, голос — через оркестратор).
 *
 * Хранилище — in-memory с TTL. Это сознательно консистентно с уже
 * принятой в проекте архитектурой single-instance (in-memory rate-limiter
 * в middleware/security.ts, планировщик в proactive-scheduler.ts тоже
 * исходят из одного инстанса Railway). Если появится горизонтальное
 * масштабирование — заменить на Redis/таблицу, интерфейс не изменится.
 *
 * TTL 5 минут: подтверждение — это «прямо сейчас», не «через час».
 * Протухшее предложение не должно неожиданно сработать.
 */

export interface PendingAction {
  action: string;
  input: Record<string, unknown>;
  /** Человеческий текст что именно подтверждаем (для повторного показа). */
  confirmationText: string;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000;

const store = new Map<string, PendingAction>();

// Периодическая чистка протухших, чтобы Map не рос вечно (как в
// security.ts с rate-limit бакетами).
setInterval(() => {
  const now = Date.now();
  for (const [userId, p] of store.entries()) {
    if (now - p.createdAt > TTL_MS) store.delete(userId);
  }
}, 60_000).unref?.();

export function setPendingAction(
  userId: string,
  action: string,
  input: Record<string, unknown>,
  confirmationText: string,
): void {
  store.set(userId, { action, input, confirmationText, createdAt: Date.now() });
}

/** Возвращает свежий pending (или null если нет/протух). Не удаляет. */
export function peekPendingAction(userId: string): PendingAction | null {
  const p = store.get(userId);
  if (!p) return null;
  if (Date.now() - p.createdAt > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return p;
}

/** Забирает и удаляет pending (для подтверждения/отмены). */
export function takePendingAction(userId: string): PendingAction | null {
  const p = peekPendingAction(userId);
  if (p) store.delete(userId);
  return p;
}

export function clearPendingAction(userId: string): void {
  store.delete(userId);
}

// -----------------------------------------------------------------------------
// Распознавание «да/нет» в свободной речи (Telegram, голос).
// ВАЖНО: не используем \b — в JS \w = [A-Za-z0-9_], кириллическая граница
// слова не срабатывает (та же проблема что в intent-parser/booking).
// Триггерим ТОЛЬКО на короткое чистое подтверждение/отказ — чтобы
// «да я кстати ещё хотел...» не сработало как слепое подтверждение.
// -----------------------------------------------------------------------------

const AFFIRM =
  /^(да|ага|угу|давай(те)?|подтвержда[юй]|подтверди(ть)?|ок(ей)?|ok(ay)?|конечно|точно|верно|правильно|записывай|запиши|го|yes|yep|yeah|y)[\s!.,)]*$/i;

const NEGATE =
  /^(нет|неа|не надо|не нужно|не записывай|не записывать|отмена|отмен[аияй]+|отставить|cancel|no|nope|n)[\s!.,)]*$/i;

export type ConfirmSignal = 'confirm' | 'cancel' | null;

export function readConfirmSignal(text: string): ConfirmSignal {
  const t = text.trim();
  if (AFFIRM.test(t)) return 'confirm';
  if (NEGATE.test(t)) return 'cancel';
  return null;
}
