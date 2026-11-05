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

export function incomeOfferText(d: Pick<Deal, 'amount'>): string {
  return `Записать доход ${fmtMoneyExact(d.amount ?? 0)}?`;
}

export function canRecordIncome(d: Deal): boolean {
  return d.stage === 'won' && d.amount != null && !d.wonIncomeId;
}

/** «Вернуть в работу»: стадия, из которой сделку закрыли (история — свежие сверху); не знаем — «Переговоры». */
export function reopenStage(d: Deal, events: readonly DealEvent[]): OpenStage {
  const closing = events.find((e) => e.kind === 'stage' && e.to === d.stage);
  return closing?.from && isOpenStage(closing.from) ? closing.from : 'talks';
}

const MONEY_INPUT = /^(\d+(?:[.,]\d+)?)(млн|м|к|тыс)?$/;

/** Сумма из поля ввода: «2 000 000», «2,5 млн», «500к». Пусто — null (сумма не названа). */
export function parseMoneyInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const s = raw.toLowerCase().replace(/[\s ₸]/g, '').replace(/(тг|тенге)$/, '');
  if (!s) return { ok: true, value: null };
  const m = s.match(MONEY_INPUT);
  if (!m) return { ok: false };
  const base = Number(m[1].replace(',', '.'));
  const mult = m[2] === 'млн' || m[2] === 'м' ? 1_000_000 : m[2] === 'к' || m[2] === 'тыс' ? 1_000 : 1;
  const value = Math.round(base * mult);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_MONEY) return { ok: false };
  return { ok: true, value };
}

/** Сегодня по часам устройства (YYYY-MM-DD). */
export function civilToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
