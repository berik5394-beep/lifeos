/**
 * Чистое ядро коуча по накоплениям. Без БД/AI — вся математика «темп vs
 * срок» здесь, тестируется раз, зовут три потребителя (рефлектор,
 * реактивный хук, опц. on-demand). Честность by construction: числа из
 * входа (адаптер берёт их из БД), статус детерминирован.
 */
export interface SavingsPaceFacts {
  target: number; // сумма цели (₸); <=0 → no_target
  targetDate: Date; // срок (адаптер подставляет 31 дек если не задан)
  savedSoFar: number; // Σ(Income) − Σ(Expense) с начала года (может быть < 0)
  monthlyPace: number; // текущий темп сбережений/мес (может быть <= 0)
  now: Date;
}

export type SavingsStatus =
  | 'no_target'
  | 'reached'
  | 'stalled'
  | 'behind'
  | 'on_track'
  | 'ahead';

export interface SavingsPace {
  monthsLeft: number;
  remaining: number;
  requiredMonthly: number;
  projected: number;
  paceGap: number;
  shortfall: number;
  progressPct: number;
  status: SavingsStatus;
}

const MS_PER_MONTH = 30.44 * 86_400_000;
const AHEAD_FACTOR = 1.1;

export function computeSavingsPace(f: SavingsPaceFacts): SavingsPace {
  const monthsLeft = Math.max(
    0,
    (f.targetDate.getTime() - f.now.getTime()) / MS_PER_MONTH,
  );
  const remaining = f.target - f.savedSoFar;
  const requiredMonthly =
    monthsLeft > 0 ? Math.max(0, remaining) / monthsLeft : Math.max(0, remaining);
  const projected = f.savedSoFar + f.monthlyPace * monthsLeft;
  const paceGap = requiredMonthly - f.monthlyPace;
  const shortfall = f.target - projected;
  const progressPct = f.target > 0 ? (f.savedSoFar / f.target) * 100 : 0;

  let status: SavingsStatus;
  if (f.target <= 0) status = 'no_target';
  else if (f.savedSoFar >= f.target) status = 'reached';
  else if (monthsLeft <= 0) status = 'behind'; // срок прошёл, не добрал
  else if (f.monthlyPace <= 0) status = 'stalled';
  else if (projected >= f.target * AHEAD_FACTOR) status = 'ahead';
  else if (projected >= f.target) status = 'on_track';
  else status = 'behind';

  return {
    monthsLeft,
    remaining,
    requiredMonthly,
    projected,
    paceGap,
    shortfall,
    progressPct,
    status,
  };
}

/**
 * Выбор фин-цели для коуча среди НЕСКОЛЬКИХ. Раньше брали первую попавшуюся
 * (goals.find) — с несколькими целями это могла быть уже достигнутая, и
 * коуч молчал на той, что отстаёт (живой баг 2026-06-02). Берём НЕ
 * достигнутую (saved < target) с ближайшим сроком (самая срочная незакрытая).
 * Все достигнуты / нет целей → null (коучить нечего). Чистая, тестируется.
 */
export function pickCoachableGoal<
  T extends { target: number; targetDate: Date; saved: number },
>(goals: T[]): T | null {
  const unmet = goals.filter((g) => g.saved < g.target);
  if (unmet.length === 0) return null;
  return unmet
    .slice()
    .sort((a, b) => a.targetDate.getTime() - b.targetDate.getTime())[0];
}

export interface PortfolioGoal {
  text: string;
  target: number;
  targetDate: Date;
  saved: number;
}

export interface PortfolioInput {
  goals: PortfolioGoal[];
  capacity: number; // monthlyIncome − monthlyBurn (текущий темп; может быть ≤0)
  now: Date;
}

export interface GoalLeg {
  goal: PortfolioGoal;
  required: number; // requiredMonthly на эту цель в одиночку
  monthsLeft: number;
  status: SavingsStatus;
}

export type PortfolioStatus =
  | 'none'
  | 'on_track_all'
  | 'stalled'
  | 'anchor_at_risk'
  | 'collision';

export interface PortfolioPace {
  status: PortfolioStatus;
  anchor: GoalLeg | null; // главная = max target
  competitors: GoalLeg[]; // остальные незакрытые, по убыванию required
  topCompetitor: GoalLeg | null;
  capacity: number;
  requiredAnchor: number;
  sumRequired: number;
  anchorDelta: number; // max(0, requiredAnchor − capacity)
  collisionDelta: number; // max(0, sumRequired − capacity)
}

/**
 * Портфельный расчёт: коуч смотрит на ВСЕ незакрытые фин-цели разом.
 * Якорь (главная) = самая денежная (max target). Berik: «чем больше
 * денег, тем главнее». Конкуренты — мелкие near-term цели, что давят на
 * темп. Статус показывает trade-off: главную одну не тянешь
 * (anchor_at_risk) / тянешь, но мелкие сверху нет (collision). Чистая.
 */
export function computePortfolioPace(input: PortfolioInput): PortfolioPace {
  const { goals, capacity, now } = input;
  const unmet = goals.filter((g) => g.target > 0 && g.saved < g.target);
  if (unmet.length === 0) {
    return {
      status: 'none',
      anchor: null,
      competitors: [],
      topCompetitor: null,
      capacity,
      requiredAnchor: 0,
      sumRequired: 0,
      anchorDelta: 0,
      collisionDelta: 0,
    };
  }

  const legs: GoalLeg[] = unmet.map((goal) => {
    const pace = computeSavingsPace({
      target: goal.target,
      targetDate: goal.targetDate,
      savedSoFar: goal.saved,
      monthlyPace: capacity,
      now,
    });
    return {
      goal,
      required: pace.requiredMonthly,
      monthsLeft: pace.monthsLeft,
      status: pace.status,
    };
  });

  // Якорь = max target (тай-брейк: дальше срок).
  const anchor = legs
    .slice()
    .sort(
      (a, b) =>
        b.goal.target - a.goal.target ||
        b.goal.targetDate.getTime() - a.goal.targetDate.getTime(),
    )[0];
  const competitors = legs
    .filter((l) => l !== anchor)
    .sort((a, b) => b.required - a.required);
  const topCompetitor = competitors[0] ?? null;

  const requiredAnchor = anchor.required;
  const sumRequired = legs.reduce((s, l) => s + l.required, 0);
  const anchorDelta = Math.max(0, requiredAnchor - capacity);
  const collisionDelta = Math.max(0, sumRequired - capacity);

  let status: PortfolioStatus;
  if (capacity <= 0) status = 'stalled';
  else if (capacity >= sumRequired) status = 'on_track_all';
  else if (capacity < requiredAnchor) status = 'anchor_at_risk';
  else status = 'collision';

  return {
    status,
    anchor,
    competitors,
    topCompetitor,
    capacity,
    requiredAnchor,
    sumRequired,
    anchorDelta,
    collisionDelta,
  };
}

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/**
 * Человеческая строка коуча из портфеля. null = молчим (none /
 * on_track_all / нет якоря). Числа из pf — честность by construction.
 * Шарится дневным рефлектором и реактивным хуком (DRY).
 */
export function describePortfolioPace(pf: PortfolioPace): string | null {
  const a = pf.anchor;
  if (!a) return null;
  const r = (n: number) => Math.round(n);
  if (pf.status === 'stalled') {
    return (
      `🏠 Главная «${a.goal.text}» (${r(a.goal.target)}₸): при нулевых/` +
      `отрицательных сбережениях она не приближается. Сначала вывести ` +
      `денежный поток в плюс.`
    );
  }
  if (pf.status === 'anchor_at_risk') {
    const comp = pf.topCompetitor
      ? ` А «${pf.topCompetitor.goal.text}» сверху только отодвигает её.`
      : '';
    return (
      `🏠 Главная — «${a.goal.text}» (${r(a.goal.target)}₸ к ` +
      `${fmtDate(a.goal.targetDate)}): надо ~${r(pf.requiredAnchor)}₸/мес, ` +
      `твой темп ~${r(pf.capacity)}₸ → не хватает ~${r(pf.anchorDelta)}₸/мес. ` +
      `Либо +${r(pf.anchorDelta)}₸/мес, либо к сроку опоздаешь.${comp}`
    );
  }
  if (pf.status === 'collision' && pf.topCompetitor) {
    const tc = pf.topCompetitor;
    return (
      `🏠 На «${a.goal.text}» (${r(a.goal.target)}₸) при темпе ` +
      `~${r(pf.capacity)}₸/мес выходишь. Но «${tc.goal.text}» ` +
      `(${r(tc.goal.target)}₸ к ${fmtDate(tc.goal.targetDate)}) требует ещё ` +
      `~${r(tc.required)}₸/мес — вместе не вытянуть. Чтобы успеть к обеим, ` +
      `+${r(pf.collisionDelta)}₸/мес; иначе двигаем «${tc.goal.text}».`
    );
  }
  return null; // none / on_track_all / collision без competitor (не бывает)
}
