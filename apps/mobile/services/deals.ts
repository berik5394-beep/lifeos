/**
 * Сделки (спека 2026-11-05-deals) — типы и чистая логика панели.
 * Стадии и подписи = сервер (packages/server/src/services/deals/stages.ts).
 */
export const OPEN_STAGES = ['new', 'talks', 'proposal', 'contract'] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];
export type DealStage = OpenStage | 'won' | 'lost';

export const STAGE_LABEL: Record<DealStage, string> = {
  new: 'Новая',
  talks: 'Переговоры',
  proposal: 'КП отправлено',
  contract: 'Договор/оплата',
  won: 'Выиграна',
  lost: 'Проиграна',
};

/** Сделка как её отдаёт сервер (Prisma Deal → JSON: даты — ISO-строки). */
export interface Deal {
  id: string;
  personEntityId: string | null;
  personName: string;
  title: string;
  amount: number | null;
  currency: string;
  stage: DealStage;
  stageChangedAt: string;
  /** DateTime @db.Date → «2026-11-08T00:00:00.000Z»; civil-дату даёт civilOf. */
  nextStepAt: string | null;
  nextStepText: string | null;
  lastActivityAt: string;
  closedAt: string | null;
  lostReason: string | null;
  wonIncomeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealEvent {
  id: string;
  dealId: string;
  kind: 'created' | 'stage' | 'amount' | 'next_step' | 'note';
  from: string | null;
  to: string | null;
  text: string | null;
  at: string;
}

export type DealWithEvents = Deal & { events: DealEvent[] };

/** Статус плана продаж месяца (сервер: salesPlanStatus). */
export interface PlanStatus {
  plan: number;
  won: number;
  open: number;
  /** Открытых сделок без суммы — в «open» не посчитаны. */
  noAmount: number;
  pace: { behind: boolean; expected: number; gap: number; coverable: boolean };
  /** Имена клиентов крупнейших открытых сделок, закрывающих разрыв. */
  covering: string[];
}

export interface StageGroup {
  stage: OpenStage;
  deals: Deal[];
  sum: number;
}

export function isOpenStage(s: string): s is OpenStage {
  return (OPEN_STAGES as readonly string[]).includes(s);
}

/** Открытые сделки по стадиям воронки (пустые стадии не показываем), сумма — без сделок без суммы. */
export function groupDeals(deals: readonly Deal[]): StageGroup[] {
  return OPEN_STAGES.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage);
    return { stage, deals: inStage, sum: inStage.reduce((s, d) => s + (d.amount ?? 0), 0) };
  }).filter((g) => g.deals.length > 0);
}

export function neighborStages(stage: OpenStage): { prev: OpenStage | null; next: OpenStage | null } {
  const i = OPEN_STAGES.indexOf(stage);
  return {
    prev: i > 0 ? OPEN_STAGES[i - 1] : null,
    next: i < OPEN_STAGES.length - 1 ? OPEN_STAGES[i + 1] : null,
  };
}

const groupThousands = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Коротко для списка: «2 млн ₸», «2,5 млн ₸», «350 000 ₸» (как сервер). */
export function fmtMoney(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace('.', ',')} млн ₸`;
  }
  return `${groupThousands(n)} ₸`;
}

/** Точно для денежных подтверждений: «2 345 678 ₸» (без округления до млн). */
export function fmtMoneyExact(n: number): string {
  return `${groupThousands(n)} ₸`;
}

/** ISO-дата сервера → civil «YYYY-MM-DD» (поле @db.Date — полночь UTC). */
export function civilOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}
