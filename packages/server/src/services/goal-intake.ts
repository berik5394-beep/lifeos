/**
 * Разбор цели при постановке — ЧИСТОЕ ядро (спека 2026-11-08-goal-intake-check).
 *
 * Раньше постановка годовой цели = запись «Цель записана… Буду вести»: мозг в
 * этот момент не смотрел ни на деньги, ни на время, ни на привычки. Здесь из
 * фактов (их собирает goal-intake-gather.ts) — максимум 3 строки + ОДНО
 * предложение «да». Без БД/ИИ. Честность by construction: каждая цифра — из
 * входа; нет записанных доходов → про деньги ни одной цифры.
 */
import { computeSavingsPace, type PortfolioGoal } from './savings-pace.js';
import { computeGoalPace, isMoneyGoal } from './goal-pace.js';
import type { FreeSlot } from '../tools/_slots.js';
import { ruDayName } from './goal-slot.js';

/** Окно усреднения доходов/трат — то же, что у коуча накоплений (reflector). */
export const MONEY_WINDOW_MONTHS = 3;
const WEEKS_PER_MONTH = 4.345;
/** Меньше ~2 недель до срока — помесячный темп бессмысленен (огромные числа). */
export const MIN_MONTHS_LEFT = 0.5;
const MS_PER_MONTH = 30.44 * 86_400_000;
const monthsLeft = (deadline: Date, now: Date) => (deadline.getTime() - now.getTime()) / MS_PER_MONTH;

export interface GoalIntakeFacts {
  /** year — год цели: срок по умолчанию 31.12 ЕЁ года (не текущего). */
  goal: { text: string; area: string; target: number | null; targetDate: Date | null; year: number };
  /** Только для денежной цели (сфера finance + сумма). */
  money: {
    monthlyIncome: number;
    monthlyBurn: number;
    /** Другие незакрытые денежные цели (делят те же свободные деньги). */
    otherGoals: PortfolioGoal[];
  } | null;
  /** Только для не-денежной: усилие цели и свободное время до конца недели (минуты). */
  time: { goalMinutesPerWeek: number; weekCapacity: number; weekDemand: number } | null;
  /** Ближайшее свободное окно (не-денежная цель) или null. */
  slot: FreeSlot | null;
  /** Подходящая непривязанная привычка той же сферы (имя) или null. */
  linkableHabit: string | null;
  /** Эмоциональный спад (mood-tone): без «не хватает», мягче. */
  moodDown: boolean;
  now: Date;
}

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

function dec31(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 0));
}

function fmtDeadline(d: Date, now: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return d.getUTCFullYear() === now.getUTCFullYear() ? `${dd}.${mm}` : `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** «~1,5» для малых, «~12» для больших. */
function approx(n: number): string {
  const v = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `~${v.toLocaleString('ru-RU')}`;
}

function hours(min: number): string {
  const h = min / 60;
  return h < 1 ? `${Math.round(min)} мин` : `${approx(h).slice(1)} ч`;
}

function moneyLine(f: GoalIntakeFacts, target: number): string {
  const m = f.money;
  if (!m || m.monthlyIncome <= 0) {
    return `Доходов за последние ${MONEY_WINDOW_MONTHS} месяца не записано — посчитать, хватит ли денег, пока не могу.`;
  }
  const deadline = f.goal.targetDate ?? dec31(f.goal.year);
  if (monthsLeft(deadline, f.now) < MIN_MONTHS_LEFT) return deadlineTooCloseLine(deadline, f.now, money(target));
  const pace = computeSavingsPace({ target, targetDate: deadline, savedSoFar: 0, monthlyPace: 0, now: f.now });
  const need = pace.requiredMonthly;
  const head = `Это ${money(need)} в месяц до ${fmtDeadline(deadline, f.now)}`;
  const capacity = m.monthlyIncome - m.monthlyBurn;
  if (f.moodDown) {
    return `${head}. Как дотянуть — спокойно посчитаем, когда будешь готов.`;
  }
  if (capacity <= 0) {
    return `${head}, а по записанному за ${MONEY_WINDOW_MONTHS} месяца траты не меньше доходов — откладывать пока не из чего.`;
  }
  // Другие цели со сроком ближе ~2 недель (или прошедшим) не считаем: их
  // «в месяц» = весь остаток и раздувает «уже нужны другим целям».
  const others = m.otherGoals
    .filter((g) => g.target > 0 && g.saved < g.target && monthsLeft(g.targetDate, f.now) >= MIN_MONTHS_LEFT)
    .reduce(
      (s, g) =>
        s +
        computeSavingsPace({ target: g.target, targetDate: g.targetDate, savedSoFar: g.saved, monthlyPace: 0, now: f.now })
          .requiredMonthly,
      0,
    );
  const free = capacity - others;
  const freeText = `свободно ${money(capacity)} (доходы минус траты, в среднем за ${MONEY_WINDOW_MONTHS} мес.)`;
  const othersText = others > 0 ? `, из них ${money(others)} уже нужны другим целям` : '';
  if (free >= need) {
    return `${head}; ${freeText}${othersText} — влезает.`;
  }
  return `${head}, а ${freeText}${othersText} — не хватает ${money(need - Math.max(0, free))} в месяц.`;
}

function deadlineTooCloseLine(deadline: Date, now: Date, whole: string): string {
  return deadline.getTime() <= now.getTime()
    ? `Срок (${fmtDeadline(deadline, now)}) уже прошёл — может, сдвинем его? Всего нужно ${whole}.`
    : `До срока (${fmtDeadline(deadline, now)}) меньше двух недель — всего нужно ${whole}; может, сдвинем срок?`;
}

function measurableLine(f: GoalIntakeFacts, target: number): string | null {
  const deadline = f.goal.targetDate ?? dec31(f.goal.year);
  if (monthsLeft(deadline, f.now) < MIN_MONTHS_LEFT) return deadlineTooCloseLine(deadline, f.now, `${target.toLocaleString('ru-RU')}`);
  const pace = computeGoalPace(
    { target, targetDate: deadline, progress: 0, createdAt: f.now },
    f.now,
  );
  if (!(pace.requiredMonthly > 0) || !(pace.monthsLeft > 0)) return null;
  const perWeek = pace.requiredMonthly / WEEKS_PER_MONTH;
  const week = perWeek >= 1 ? ` (${approx(perWeek)} в неделю)` : '';
  return `Это ${approx(pace.requiredMonthly)} в месяц${week} до ${fmtDeadline(deadline, f.now)}.`;
}

function timeLine(f: Pick<GoalIntakeFacts, 'time' | 'moodDown'>): string | null {
  const t = f.time;
  if (!t || !(t.goalMinutesPerWeek > 0)) return null;
  const freeMin = Math.max(0, t.weekCapacity - t.weekDemand);
  const head = `По времени это ${hours(t.goalMinutesPerWeek)} в неделю`;
  if (freeMin <= 0) {
    return f.moodDown
      ? `${head}; эта неделя уже плотная — начнём со следующей.`
      : `${head}; до конца этой недели свободного времени уже нет — начнём со следующей.`;
  }
  const verdict =
    freeMin >= t.goalMinutesPerWeek * 1.5 ? 'влезает' : freeMin >= t.goalMinutesPerWeek ? 'впритык' : 'на этой неделе не влезает целиком';
  return `${head}; до конца этой недели свободно ${hours(freeMin)} — ${verdict}.`;
}

function habitLine(linkableHabit: string | null): string {
  return linkableHabit
    // Факт, без «могу привязать»: инструмента привязки существующей привычки
    // к цели нет — обещать нельзя (ревью 2026-11-08).
    ? `Под неё подходит твоя привычка «${linkableHabit}».`
    : 'К цели пока не привязана ни одна привычка.';
}

function question(f: GoalIntakeFacts, isMoney: boolean): string {
  if (f.moodDown) return 'Захочешь — разобью на маленькие шаги. Скажи «да», когда будешь готов.';
  if (isMoney) return 'Разбить на шаги — сколько откладывать и что можно урезать? Скажи «да».';
  if (f.slot) {
    const d = f.slot.date;
    return `Разбить на шаги и поставить первое занятие на ${ruDayName(d)} (${d.slice(8, 10)}.${d.slice(5, 7)}) в ${f.slot.from}? Скажи «да».`;
  }
  return 'Разбить на шаги? Скажи «да».';
}

/**
 * Текст разбора (строки через \n) — дописывается к «Цель записана…».
 * Денежная: 1 строка про деньги. Не-денежная: темп (если есть число) + время +
 * привычка. Всегда заканчивается одним вопросом.
 */
export function buildGoalIntake(f: GoalIntakeFacts): string {
  const target = f.goal.target != null && f.goal.target > 0 ? f.goal.target : null;
  const isMoney = target != null && isMoneyGoal(f.goal.area, target);
  const lines: string[] = [];
  if (isMoney) {
    lines.push(moneyLine(f, target));
  } else {
    const ml = target != null ? measurableLine(f, target) : null;
    if (ml) lines.push(ml);
    const tl = timeLine(f);
    if (tl) lines.push(tl);
    lines.push(habitLine(f.linkableHabit));
  }
  return [...lines.slice(0, 3), question(f, isMoney)].join('\n');
}

/** Короткая цель (месяц/неделя): без денег и темпа — время, привычка, окно. */
export interface ShortGoalIntakeFacts {
  time: GoalIntakeFacts['time'];
  slot: FreeSlot | null;
  linkableHabit: string | null;
  moodDown: boolean;
}

/**
 * Разбор цели месяца/недели: строка времени (если есть оценка), привычка
 * (только если нашлась подходящая — у короткой цели «не привязана» шум) и
 * вопрос про первое занятие (если есть окно и нет спада). Нечего сказать → null.
 */
export function buildShortGoalIntake(f: ShortGoalIntakeFacts): string | null {
  const lines: string[] = [];
  const tl = timeLine(f);
  if (tl) lines.push(tl);
  if (f.linkableHabit) lines.push(habitLine(f.linkableHabit));
  if (f.slot && !f.moodDown) {
    const d = f.slot.date;
    lines.push(`Поставить первое занятие на ${ruDayName(d)} (${d.slice(8, 10)}.${d.slice(5, 7)}) в ${f.slot.from}? Скажи «да».`);
  }
  return lines.length ? lines.join('\n') : null;
}
