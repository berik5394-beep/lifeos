/**
 * Детерминированный confirm-текст для confirm-tool (НЕ слова модели —
 * чтобы бот не врал «Записал!» до факта). Спец-кейсы + generic fallback.
 * Чистая, не падает. Money-safety: текст лишь предлагает, запись на «да».
 */
export function buildConfirmPrompt(
  tool: string,
  args: Record<string, unknown>,
): string {
  const s = (v: unknown): string => (v == null ? '' : String(v));
  switch (tool) {
    case 'set_balance':
      return `Записать текущий баланс ${s(args.balance)} ₸? Напиши «да» — сохраню.`;
    case 'clear_overdue':
      return 'Убрать ВСЕ просроченные задачи разом? Напиши «да» — уберу (обратимо).';
    case 'defer_overdue':
      return 'Перенести ВСЕ просроченные задачи на сегодня? Напиши «да».';
    case 'log_decision':
      return `Записать решение «${s(args.title)}»? Напиши «да».`;
    case 'review_decision':
      return `Зафиксировать исход «${s(args.title)}» (${s(args.verdict)})? Напиши «да».`;
    case 'send_email': {
      // Черновик целиком: человек видит, ЧТО уйдёт от его имени.
      const body = s(args.body).trim();
      const shown = body.length > 600 ? `${body.slice(0, 599)}…` : body;
      return `Отправить письмо ${s(args.to)}?\nТема: «${s(args.subject)}»\n\n${shown}\n\nНапиши «да» — отправлю.`;
    }
    default:
      return `Выполнить действие ${tool}? Напиши «да» — сделаю.`;
  }
}
