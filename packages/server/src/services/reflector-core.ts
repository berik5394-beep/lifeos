import type { InsightCandidate } from './insight-core.js';
import type { GoalVerdict } from './plan-vs-fact.js';
import { computeGoalPace, describeGoalPace } from './goal-pace.js';
import {
  computePortfolioPace,
  describePortfolioPace,
  type PortfolioStatus,
} from './savings-pace.js';

/**
 * Phase 5 P3.b — ДЕТЕРМИНИСТСКОЕ ядро рефлектора (чистое, без БД/AI).
 *
 * Решение Берика: детерминизм РЕШАЕТ какие инсайты и их severity;
 * Claude (в glue, Sonnet 1×/день) ТОЛЬКО перефразирует message в
 * тёплый текст. Честность by construction: факты из БД-цифр, не из
 * LLM (bug #1 невозможен — LLM не выдумывает числа). Если Claude
 * недоступен — message здесь УЖЕ честный фактический fallback.
 *
 * Не дублирует плоские правила (proactive-insights уже эмитит
 * goal_behind/budget_over). Рефлектор — про ГЛУБОКИЕ кросс-модульные
 * истины, которых нет в плоских правилах: горизонт фин-цели при
 * текущем темпе сбережений, отрицательный денежный поток, «цель
 * отстаёт И план под неё устарел». source='reflector' (провенанс R5).
 */

export interface ReflectorFacts {
  /** ₸/мес доход (усреднён по окну). */
  monthlyIncome: number;
  /** ₸/мес расход (усреднён). */
  monthlyBurn: number;
  /** target финансовой YearlyGoal юзера (де-хардкод 35M → реальная
   *  цель). null = у юзера нет фин-цели с target → НЕ выдумываем
   *  горизонт (честно опускаем этот инсайт). */
  financeGoalTarget: number | null;
  /** Текст фин-цели — для человеческого message. */
  financeGoalText: string | null;
  /** ВСЕ незакрытые фин-цели с числовым target — для portfolio-коуча
   *  (on-path). Одиночные financeGoal* поля сохранены для off-пути. */
  financeGoals: {
    text: string;
    target: number;
    targetDate: Date;
    saved: number;
  }[];
  /** Вердикты план↔факт (R4 planVsFact). Рефлектор смотрит на
   *  пересечение «отстаёт» + «план устарел» — это глубже плоского. */
  goalVerdicts: GoalVerdict[];
  /** Σ(Income) − Σ(Expense) с начала года — фактически «накоплено». */
  savedSoFar: number;
  /** Срок фин-цели (адаптер: targetDate или 31 дек). */
  targetDate: Date;
  /** Флаг коуча: true → новый pacing-блок; false → старый «30 лет». */
  pacingEnabled: boolean;
  /** Текущее время (для расчёта monthsLeft в чистом ядре). */
  now: Date;
  /** ГОД-пейсинг: измеримые НЕ-денежные цели для goal-pace ветки.
   *  Опционально (старые фикстуры/off-путь) — gather всегда заполняет. */
  measurableGoals?: {
    id: string;
    goalText: string;
    target: number;
    targetDate: Date | null;
    progress: number;
    createdAt: Date;
  }[];
  /** Флаг ГОД-пейсинга (isV2YearLoadEnabled). */
  yearPacingEnabled?: boolean;
}

const YEAR_MONTHS = 12;
/** Горизонт, дальше которого «цель практически недостижима». */
const UNREACHABLE_YEARS = 30;

/** Статус портфеля → метаданные инсайта. none/on_track_all отсутствуют
 *  → молчим (describePortfolioPace тоже вернёт null). */
const PORTFOLIO_INSIGHT: Partial<
  Record<PortfolioStatus, { kind: string; severity: number; dismissKey: string }>
> = {
  stalled: {
    kind: 'goal_pace_stalled',
    severity: 7,
    dismissKey: 'reflector_goal_pace_stalled',
  },
  anchor_at_risk: {
    kind: 'goal_pace_behind',
    severity: 6,
    dismissKey: 'reflector_goal_pace_behind',
  },
  collision: {
    kind: 'goal_pace_collision',
    severity: 6,
    dismissKey: 'reflector_goal_pace_collision',
  },
};

/**
 * Чистое решение рефлектора. Возвращает кандидатов для ЕДИНОГО
 * стора (R5). severity 1..10 детерминирована по величине проблемы.
 */
export function reflect(f: ReflectorFacts): InsightCandidate[] {
  const out: InsightCandidate[] = [];
  const monthlySavings = f.monthlyIncome - f.monthlyBurn;

  // 1. Отрицательный денежный поток — тратишь больше чем зарабатываешь.
  //    Глубже плоского budget_over (тот про лимит категории, этот про
  //    весь баланс жизни). daysUntilBroke — честная проекция.
  if (f.monthlyIncome > 0 && monthlySavings < 0) {
    const daysUntilBroke = Math.round(
      Math.abs((30 * f.monthlyIncome) / f.monthlyBurn),
    );
    out.push({
      kind: 'cashflow_negative',
      scope: 'finance:cashflow',
      severity: 9,
      message:
        `Расходы выше доходов: −${Math.abs(
          Math.round(monthlySavings),
        )}₸/мес. При таком темпе денег хватит примерно на ${daysUntilBroke} дн. ` +
        `Это не про лимит одной категории — это весь баланс. Нужен план сокращения.`,
      rationale: `monthlyIncome=${Math.round(
        f.monthlyIncome,
      )} monthlyBurn=${Math.round(f.monthlyBurn)}`,
      source: 'reflector',
      dismissKey: 'reflector_cashflow_negative',
    });
  }

  // 2. Pacing фин-цели. ON (флаг коуча) → portfolio по ВСЕМ целям
  //    (computePortfolioPace, якорь = самая денежная); OFF → старый
  //    одно-целевой horizon-блок «≥30 лет» (байт-в-байт, rollback-safety).
  if (f.pacingEnabled) {
    if (f.monthlyIncome > 0 && f.financeGoals.length > 0) {
      const pf = computePortfolioPace({
        goals: f.financeGoals,
        capacity: monthlySavings,
        now: f.now,
      });
      const line = describePortfolioPace(pf);
      const meta = PORTFOLIO_INSIGHT[pf.status];
      if (line && meta) {
        out.push({
          kind: meta.kind,
          scope: 'finance:goal_pace',
          severity: meta.severity,
          message: line,
          rationale: `portfolio ${pf.status} anchorDelta=${Math.round(
            pf.anchorDelta,
          )} collisionDelta=${Math.round(pf.collisionDelta)}`,
          source: 'reflector',
          dismissKey: meta.dismissKey,
        });
      }
    }
  } else if (
    f.financeGoalTarget !== null &&
    f.financeGoalTarget > 0 &&
    f.monthlyIncome > 0
  ) {
    if (monthlySavings <= 0) {
      out.push({
        kind: 'goal_horizon_stalled',
        scope: 'finance:goal_horizon',
        severity: 7,
        message:
          `Цель «${f.financeGoalText ?? 'финансовая'}» (${Math.round(
            f.financeGoalTarget,
          )}₸): при нулевых/отрицательных сбережениях она НЕ приближается. ` +
          `Сначала вывести денежный поток в плюс.`,
        rationale: `target=${f.financeGoalTarget} savings<=0`,
        source: 'reflector',
        dismissKey: 'reflector_goal_horizon_stalled',
      });
    } else {
      const years =
        Math.round(
          (f.financeGoalTarget / (monthlySavings * YEAR_MONTHS)) * 10,
        ) / 10;
      if (years >= UNREACHABLE_YEARS) {
        out.push({
          kind: 'goal_horizon_far',
          scope: 'finance:goal_horizon',
          severity: 6,
          message:
            `Цель «${f.financeGoalText ?? 'финансовая'}» (${Math.round(
              f.financeGoalTarget,
            )}₸) при текущем темпе сбережений (~${Math.round(
              monthlySavings,
            )}₸/мес) — это ~${years} лет. Чтобы реально достичь — нужен ` +
            `либо рост дохода, либо сокращение расходов.`,
          rationale: `years=${years} savings=${Math.round(monthlySavings)}`,
          source: 'reflector',
          dismissKey: 'reflector_goal_horizon_far',
        });
      }
    }
  }

  // 3. Кросс-модуль: цель ОТСТАЁТ И план под неё УСТАРЕЛ. Плоское
  //    правило знает только «отстаёт»; рефлектор связывает с тем,
  //    что план не пересобран — конкретное действие, не нытьё.
  for (const v of f.goalVerdicts) {
    if (v.tooEarly) continue;
    if (v.status === 'отстаёт' && v.planStale) {
      out.push({
        kind: 'goal_behind_plan_stale',
        scope: `goal:${v.area}`,
        severity: 7,
        message:
          `Цель «${v.goalText}» (${v.area}) отстаёт: ~${v.progressPct}% ` +
          `при темпе года ${v.expectedPct}%. И план под неё устарел ` +
          `(цель менялась позже). Скажи «перестрой план» — догоним осознанно.`,
        rationale: `gap=${v.gap} planStale`,
        source: 'reflector',
        dismissKey: `reflector_goal_behind_plan_stale_${v.area}`,
      });
    }
  }

  // 4. ГОД-пейсинг измеримых не-денежных целей (additive, под флагом).
  //    Деньги уже покрыты блоком выше; здесь — книги/вес/навыки.
  if (f.yearPacingEnabled) {
    for (const g of f.measurableGoals ?? []) {
      const pace = computeGoalPace(
        { target: g.target, targetDate: g.targetDate, progress: g.progress, createdAt: g.createdAt },
        f.now,
      );
      if (pace.monthsElapsed < 0.5) continue; // не нудим про свежие цели
      const line = describeGoalPace(g.goalText, pace, g.target);
      if (!line) continue;
      out.push({
        kind: 'goal_pace_behind',
        scope: 'goal:pace:' + g.id,
        severity: 4,
        message: line,
        rationale: `goal pace ${pace.status} done=${Math.round(pace.done)}/${g.target}`,
        source: 'goal_pace',
        dismissKey: 'reflector_goal_pace_' + g.id,
      });
    }
  }

  return out;
}
