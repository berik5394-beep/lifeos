import {
  STAGE_LABEL,
  civilOf,
  fmtMoney,
  fmtMoneyExact,
  isOpenStage,
  type Deal,
  type DealEvent,
  type OpenStage,
  type PlanStatus,
  type StageGroup,
} from '@/services/deals';

/** Панель «Сделки»: тексты и решения экрана (чистое, jest). */

/** Потолок суммы = сервер (MAX_MONEY_AMOUNT). */
export const MAX_MONEY = 1_000_000_000;

export const LOST_REASONS = ['дорого', 'выбрал другого', 'не актуально'] as const;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function planLine(p: PlanStatus): string {
  return `План месяца: ${fmtMoney(p.won)} из ${fmtMoney(p.plan)}`;
}

export function planProgress(p: PlanStatus): number {
  if (p.plan <= 0) return 0;
  return Math.max(0, Math.min(1, p.won / p.plan));
}

/** Вторая строка под полоской: отставание (кто закроет разрыв) и сделки без суммы. Нечего сказать — null. */
export function planHint(p: PlanStatus): string | null {
  const parts: string[] = [];
  if (p.pace.behind && p.pace.gap > 0) {
    parts.push(
      p.covering.length > 0
        ? `Отстаёшь: до плана ${fmtMoney(p.pace.gap)} — закроют ${p.covering.join(', ')}`
        : `Отстаёшь: до плана ${fmtMoney(p.pace.gap)}, открытых сделок не хватает`,
    );
  }
  if (p.noAmount > 0) parts.push(`${p.noAmount} ${plural(p.noAmount, 'сделка', 'сделки', 'сделок')} без суммы`);
  return parts.length ? parts.join('. ') : null;
}

export function groupTitle(g: StageGroup): string {
  return `${STAGE_LABEL[g.stage]}${g.sum > 0 ? ` · ${fmtMoney(g.sum)}` : ''}`;
}

export function dealHead(d: Pick<Deal, 'personName' | 'title'>): string {
  return `${d.personName} — ${d.title}`;
}

const ddmm = (civil: string): string => `${civil.slice(8, 10)}.${civil.slice(5, 7)}`;

export function stepLine(d: Deal): string | null {
  if (!d.nextStepText) return null;
  const date = civilOf(d.nextStepAt);
  return `${d.nextStepText}${date ? ` · ${ddmm(date)}` : ''}`;
}

/** Подпись закрытой сделки в списке «Закрытые». */
export function closedLine(d: Deal): string {
  if (d.stage === 'lost') return d.lostReason ? `Проиграна: ${d.lostReason}` : 'Проиграна';
  const parts = [STAGE_LABEL[d.stage]];
  if (d.amount != null) parts.push(fmtMoney(d.amount));
  if (d.wonIncomeId) parts.push('доход записан');
  return parts.join(' · ');
}

export type StepTone ='overdue' | 'today' | 'later';

export function stepTone(d: Deal, today: string): StepTone {
  const date = civilOf(d.nextStepAt);
  if (!date) return 'later';
  if (date < today) return 'overdue';
  return date === today ? 'today' : 'later';
}

export function eventText(e: DealEvent): string {
  switch (e.kind) {
    case 'created':
      return e.text ? `сделка заведена: ${e.text}` : 'сделка заведена';
    case 'stage':
      return `стадия: ${e.to && e.to in STAGE_LABEL ? STAGE_LABEL[e.to as keyof typeof STAGE_LABEL] : (e.to ?? '—')}`;
    case 'amount':
      return `сумма: ${e.to != null && Number.isFinite(Number(e.to)) ? fmtMoney(Number(e.to)) : '—'}`;
    case 'next_step':
      return `шаг: ${e.text ?? ''}${e.to ? ` · ${ddmm(e.to)}` : ''}`;
    default:
      return e.text ?? '';
  }
}

/** Строка истории: «05.11 · стадия: Переговоры» (at — момент UTC → локальный день). */
export function eventLine(e: DealEvent): string {
  return `${ddmm(civilToday(new Date(e.at)))} · ${eventText(e)}`;
}

export function incomeOfferText(d: Pick<Deal, 'amount' | 'incomeDue'>): string {
  const due = d.incomeDue ?? d.amount ?? 0;
  // Авансы уже записаны — предлагаем только остаток.
  return d.incomeDue != null && d.amount != null && d.incomeDue < d.amount
    ? `Авансы уже записаны — записать остаток ${fmtMoneyExact(due)}?`
    : `Записать доход ${fmtMoneyExact(due)}?`;
}

export function canRecordIncome(d: Deal): boolean {
  return d.stage === 'won' && d.amount != null && !d.wonIncomeId;
}

/**
 * «Вернуть в работу»: стадия, из которой сделку закрыли (история — свежие сверху).
 * Не знаем — null: карточка спросит стадию, а не вернёт молча в «Переговоры».
 */
export function reopenStage(d: Deal, events: readonly DealEvent[]): OpenStage | null {
  const closing = events.find((e) => e.kind === 'stage' && e.to === d.stage);
  return closing?.from && isOpenStage(closing.from) ? closing.from : null;
}

/** Целое без суффикса; «,»/«.» + ровно 3 цифры — разделитель тысяч («350,000», «2.000.000»). */
const MONEY_PLAIN = /^\d+(?:([.,])\d{3}(?:\1\d{3})*)?$/;
/** С суффиксом дробь можно: «1,5к», «2,5 млн». */
const MONEY_SUFFIXED = /^(\d+(?:[.,]\d+)?)(млн|м|к|тыс)$/;
const MONEY_FRACTION = /^\d+[.,]\d+$/;

export type MoneyParse = { ok: true; value: number | null } | { ok: false; error: string };

export const MONEY_ERROR = {
  format: 'Сумма — число, например 2 000 000',
  fraction: 'Сумма — целое число',
  zero: 'Сумма должна быть больше нуля',
  tooBig: 'Слишком большая сумма — максимум 1 млрд ₸',
} as const;

/**
 * Сумма из поля ввода: «2 000 000», «350,000», «2,5 млн», «500к». Пусто — null (сумма не названа).
 * Без суффикса «,»/«.» перед 3 цифрами — тысячи (так пишут суммы), прочая дробь — ошибка.
 */
export function parseMoneyInput(raw: string): MoneyParse {
  const s = raw.toLowerCase().replace(/[\s ₸]/g, '').replace(/(тг|тенге)$/, '');
  if (!s) return { ok: true, value: null };
  let value: number;
  const plain = s.match(MONEY_PLAIN);
  if (plain) {
    value = Number(s.replace(/[.,]/g, ''));
  } else {
    const m = s.match(MONEY_SUFFIXED);
    if (!m) return { ok: false, error: MONEY_FRACTION.test(s) ? MONEY_ERROR.fraction : MONEY_ERROR.format };
    const mult = m[2] === 'млн' || m[2] === 'м' ? 1_000_000 : 1_000;
    value = Math.round(Number(m[1].replace(',', '.')) * mult);
  }
  if (!Number.isFinite(value)) return { ok: false, error: MONEY_ERROR.format };
  if (value <= 0) return { ok: false, error: MONEY_ERROR.zero };
  if (value > MAX_MONEY) return { ok: false, error: MONEY_ERROR.tooBig };
  return { ok: true, value };
}

/** Сегодня по часам устройства (YYYY-MM-DD). */
export function civilToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Быстрые даты шага (без нативного календаря): civil-даты по часам устройства. */
export function stepDateChoices(now: Date = new Date()): { label: string; date: string }[] {
  const day = (n: number) => civilToday(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  return [
    { label: 'Сегодня', date: day(0) },
    { label: 'Завтра', date: day(1) },
    { label: 'Через 3 дня', date: day(3) },
    { label: 'Через неделю', date: day(7) },
  ];
}

/** Сумма для поля ввода: «10 000 000» (parseMoneyInput читает обратно); нет суммы — пусто. */
export function fmtAmountInput(n: number | null): string {
  return n == null ? '' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
