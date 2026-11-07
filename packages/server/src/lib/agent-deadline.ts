/**
 * Предел ожидания на весь ход робота. Раньше у каждого вызова Claude был свой
 * таймаут (60 с) + 2 повтора, а за ход их бывает до 5 (инструменты, повтор
 * с инструментами, запасной путь) — ответ мог висеть минутами, телефон
 * сдавался через 60 с, а сервер всё думал. Теперь ход укладывается в
 * TURN_DEADLINE_MS и честно говорит, что не успел.
 *
 * Отдельный модуль (не claude-agent.ts): тесты мокают claude-agent целиком,
 * а класс ошибки нужен оркестратору для instanceof.
 */

/** Телефон ждёт мозг 60 с (BRAIN_TIMEOUT_MS); запас — на сеть и распознавание. */
export const TURN_DEADLINE_MS = 48_000;

/** Меньше — новый вызов Claude не начинаем: всё равно не успеет. */
export const MIN_CALL_MS = 3_000;

export class AgentDeadlineError extends Error {
  constructor() {
    super('agent turn deadline exceeded');
    this.name = 'AgentDeadlineError';
  }
}

/**
 * Опции запроса к Claude в пределах хода: таймаут = остаток времени, а signal
 * обрывает и встроенные повторы SDK (у каждого повтора свой таймаут).
 * Без deadlineAt — undefined (старое поведение для фоновых вызовов).
 */
export function callBudget(
  deadlineAt: number | undefined,
  now: number = Date.now(),
): { timeout: number; signal: AbortSignal } | undefined {
  if (deadlineAt === undefined) return undefined;
  const left = deadlineAt - now;
  if (left < MIN_CALL_MS) throw new AgentDeadlineError();
  return { timeout: left, signal: AbortSignal.timeout(left) };
}

/** Вызов упал, потому что кончилось время хода (а не из-за сбоя Claude). */
export function isPastDeadline(deadlineAt: number | undefined, now: number = Date.now()): boolean {
  return deadlineAt !== undefined && now >= deadlineAt - 1_000;
}

/**
 * Честный ответ, когда не успели. Если инструменты за ход уже сработали —
 * сказать, что часть сделана, и не просить повторить (повтор = дубль).
 */
export function deadlineReplyText(acted: boolean): string {
  return acted
    ? 'Долго думал и не успел договорить, но часть уже сделал — загляни в списки. Не повторяй сразу, чтобы не было дублей.'
    : 'Что-то я долго думаю — прервался, чтобы ты не ждал. Спроси ещё раз через минуту.';
}
