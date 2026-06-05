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
    default:
      return `Выполнить действие ${tool}? Напиши «да» — сделаю.`;
  }
}
