# Portfolio Savings Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Коуч рассуждает над ВСЕМИ фин-целями сразу, якорится на самой денежной (главной) и выдаёт trade-off: «+Δ₸/мес на главную или опоздаешь; мелкая цель/трата её отодвигает».

**Architecture:** Одно новое чистое ядро `computePortfolioPace` + строковый форматтер `describePortfolioPace` в `services/savings-pace.ts` (поверх существующего `computeSavingsPace`). Два существующих потребителя — дневной `reflector-core.reflect()` и реактивный `savings-coach.maybeSavingsCoachLine` — переключаются на него. `ReflectorFacts` получает массив `financeGoals[]`; одиночные поля сохраняются для off-пути (флаг off = байт-в-байт). Без миграций.

**Tech Stack:** packages/server, TypeScript strict, ESM NodeNext (`.js` импорты), vitest (zero vi.mock), pure helpers для unit + structural (readFileSync+grep).

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit на каждый шаг. Команды из `packages/server`. Коммит heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Базовая сюита **2069** зелёная.

---

## Файлы

- **Modify** `src/services/savings-pace.ts` — +`computePortfolioPace`, +`describePortfolioPace`, +типы `PortfolioGoal/PortfolioInput/GoalLeg/PortfolioStatus/PortfolioPace`, +`fmtDate` (приватный).
- **Modify** `src/services/savings-pace.test.ts` — +unit для портфеля и форматтера.
- **Modify** `src/services/reflector-core.ts` — `ReflectorFacts` +`financeGoals`; `reflect()` pacing-ветка → portfolio (off сохранить байт-в-байт); импорт.
- **Modify** `src/services/reflector-service.ts` — `gatherReflectorFacts` отдаёт `financeGoals`.
- **Modify** `src/services/reflector-facts.test.ts` — структурная проверка `financeGoals`.
- **Modify** `src/services/savings-coach.ts` — `maybeSavingsCoachLine` + `shouldNudgeOnExpense` → portfolio.
- **Modify** `src/services/savings-coach.test.ts` — обновить статусы гейта; +structural.
- **Modify** test-фикстуры `ReflectorFacts` (любой `*.test.ts` с литералом `ReflectorFacts`) — добавить `financeGoals: []`.

---

## Task 1: Чистое ядро `computePortfolioPace` + `describePortfolioPace` (CHECKPOINT)

**Files:**
- Modify: `src/services/savings-pace.ts` (append после `pickCoachableGoal`, конец файла ~line 86)
- Test: `src/services/savings-pace.test.ts`

- [ ] **Step 1: Написать падающие unit-тесты**

В начало `src/services/savings-pace.test.ts` обновить импорт и добавить блоки. Импорт (заменить строку 2):

```ts
import {
  computeSavingsPace,
  pickCoachableGoal,
  computePortfolioPace,
  describePortfolioPace,
} from './savings-pace.js';
```

Добавить в конец файла:

```ts
describe('computePortfolioPace — портфель целей + якорь', () => {
  const PNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(PNOW.getTime() + n * MS);
  // saved=0, monthlyPace=capacity → required = target / monthsLeft.

  it('нет целей / все закрыты → none', () => {
    expect(computePortfolioPace({ goals: [], capacity: 100000, now: PNOW }).status).toBe('none');
    expect(
      computePortfolioPace({
        goals: [{ text: 'A', target: 1000, targetDate: inM(5), saved: 1000 }],
        capacity: 100000,
        now: PNOW,
      }).status,
    ).toBe('none');
  });

  it('capacity<=0 → stalled', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }],
      capacity: 0,
      now: PNOW,
    });
    expect(r.status).toBe('stalled');
  });

  it('capacity >= суммы нужного → on_track_all (молчим)', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
      capacity: 150_000, // >= 100k
      now: PNOW,
    });
    expect(r.status).toBe('on_track_all');
    expect(Math.round(r.sumRequired)).toBe(100_000);
  });

  it('capacity < нужного на главную → anchor_at_risk + anchorDelta', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }], // req 100k
      capacity: 40_000,
      now: PNOW,
    });
    expect(r.status).toBe('anchor_at_risk');
    expect(r.anchor?.goal.target).toBe(1_000_000);
    expect(Math.round(r.requiredAnchor)).toBe(100_000);
    expect(Math.round(r.anchorDelta)).toBe(60_000);
    expect(r.competitors).toEqual([]);
  });

  it('главную тянешь, мелкая сверху не лезет → collision + topCompetitor + collisionDelta', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k (якорь)
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
      capacity: 60_000, // >= requiredAnchor(50k), < sumRequired(100k)
      now: PNOW,
    });
    expect(r.status).toBe('collision');
    expect(r.anchor?.goal.target).toBe(1_000_000);
    expect(r.topCompetitor?.goal.target).toBe(100_000);
    expect(Math.round(r.collisionDelta)).toBe(40_000);
  });

  it('якорь = самая денежная, даже если конкурент срочнее/требует больше', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(40), saved: 0 }, // req 25k
        { text: 'Срочное', target: 200_000, targetDate: inM(1), saved: 0 }, // req 200k
      ],
      capacity: 30_000,
      now: PNOW,
    });
    expect(r.anchor?.goal.target).toBe(1_000_000); // НЕ по срочности/required
    expect(r.topCompetitor?.goal.target).toBe(200_000);
  });

  it('одна цель → никогда collision', () => {
    const one = { text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }; // req 100k
    expect(computePortfolioPace({ goals: [one], capacity: 100_000, now: PNOW }).status).toBe('on_track_all');
    expect(computePortfolioPace({ goals: [one], capacity: 99_999, now: PNOW }).status).toBe('anchor_at_risk');
  });

  it('кейс Berik: квартира 800к + велик 100к, темп ~51к → anchor_at_risk', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 800_000, targetDate: inM(7), saved: 0 },
        { text: 'Велик', target: 100_000, targetDate: inM(1), saved: 0 },
      ],
      capacity: 50_866,
      now: PNOW,
    });
    expect(r.status).toBe('anchor_at_risk');
    expect(r.anchor?.goal.target).toBe(800_000);
    expect(r.anchorDelta).toBeGreaterThan(60_000);
  });
});

describe('describePortfolioPace — строка коуча', () => {
  const PNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(PNOW.getTime() + n * MS);

  it('on_track_all / none → null (молчим)', () => {
    const ok = computePortfolioPace({
      goals: [{ text: 'A', target: 100_000, targetDate: inM(20), saved: 0 }],
      capacity: 999_999,
      now: PNOW,
    });
    expect(describePortfolioPace(ok)).toBeNull();
    expect(describePortfolioPace(computePortfolioPace({ goals: [], capacity: 1, now: PNOW }))).toBeNull();
  });

  it('anchor_at_risk → «надо +…₸/мес … опоздаешь» + имя главной', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }],
      capacity: 40_000,
      now: PNOW,
    });
    const s = describePortfolioPace(r)!;
    expect(s).toContain('Квартира');
    expect(s).toContain('опоздаешь');
    expect(s).toContain('60000');
  });

  it('collision → имя главной + конкурента + «двигаем»', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 },
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 },
      ],
      capacity: 60_000,
      now: PNOW,
    });
    const s = describePortfolioPace(r)!;
    expect(s).toContain('Квартира');
    expect(s).toContain('Велик');
    expect(s).toContain('двигаем');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd packages/server && npx vitest run src/services/savings-pace.test.ts`
Expected: FAIL — `computePortfolioPace`/`describePortfolioPace` не экспортированы.

- [ ] **Step 3: Реализовать ядро + форматтер**

В конец `src/services/savings-pace.ts` добавить:

```ts
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
```

- [ ] **Step 4: Запустить — зелёный + tsc**

Run: `cd packages/server && npx vitest run src/services/savings-pace.test.ts && npx tsc --noEmit`
Expected: PASS (все новые тесты), tsc без ошибок.

- [ ] **Step 5: Commit (CHECKPOINT — чистое ядро готово)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/savings-pace.ts packages/server/src/services/savings-pace.test.ts && git commit -F - <<'EOF'
feat(coach): pure computePortfolioPace + describePortfolioPace

Portfolio savings-pace core: reason over ALL unmet finance goals at once,
anchor on the largest-target goal (главная), surface trade-off via status
(none|on_track_all|stalled|anchor_at_risk|collision) + anchorDelta/
collisionDelta + topCompetitor. describePortfolioPace renders the shared
deterministic coach line (numbers honest by construction). 11 unit tests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `ReflectorFacts.financeGoals` + `gatherReflectorFacts` populate

**Files:**
- Modify: `src/services/reflector-core.ts` (interface `ReflectorFacts`, ~line 21-43)
- Modify: `src/services/reflector-service.ts` (`gatherReflectorFacts` return, ~line 144-155)
- Modify: `src/services/reflector-facts.test.ts`
- Modify: фикстуры `ReflectorFacts` в тестах

- [ ] **Step 1: Структурный тест на `financeGoals`**

В `src/services/reflector-facts.test.ts`, в блок `'ReflectorFacts расширены под коуча'` (после проверки `now: Date`) добавить:

```ts
    expect(CORE).toMatch(/financeGoals:/);
```

И в блок про `gatherReflectorFacts` добавить:

```ts
    // Portfolio: отдаём ВСЕ фин-цели массивом (не одну).
    expect(SVC).toContain('financeGoals:');
```

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/services/reflector-facts.test.ts`
Expected: FAIL — `financeGoals` ещё нет.

- [ ] **Step 3: Добавить поле в `ReflectorFacts`**

В `src/services/reflector-core.ts` в `interface ReflectorFacts` (после `financeGoalText: string | null;`, ~line 31) добавить:

```ts
  /** ВСЕ незакрытые фин-цели с числовым target — для portfolio-коуча
   *  (on-path). Одиночные financeGoal* поля сохранены для off-пути. */
  financeGoals: {
    text: string;
    target: number;
    targetDate: Date;
    saved: number;
  }[];
```

- [ ] **Step 4: Populate в `gatherReflectorFacts`**

В `src/services/reflector-service.ts` в `return {...}` (после `monthlyBurn,`, ~line 146) добавить:

```ts
    financeGoals: finCandidates.map((c) => ({
      text: c.goal.goalText,
      target: c.target,
      targetDate: c.targetDate,
      saved: c.saved,
    })),
```

(`finCandidates` уже посчитан выше — массив `{goal, target, targetDate, saved}` per-goal.)

- [ ] **Step 5: Починить фикстуры `ReflectorFacts`**

Найти все литералы `ReflectorFacts` в тестах:

Run: `cd packages/server && grep -rln "pacingEnabled:" src --include="*.test.ts"`

В каждом найденном литерале (объект с `monthlyIncome`/`pacingEnabled`) добавить поле `financeGoals: []` (если у фикстуры уже есть незакрытые цели по смыслу теста — оставить `[]`, тесты этих файлов проверяют другие ветки). Типичный файл: `src/services/reflector-core.test.ts`.

- [ ] **Step 6: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/services/reflector-facts.test.ts src/services/reflector-core.test.ts && npx tsc --noEmit`
Expected: PASS, tsc чисто (нет «property financeGoals is missing»).

- [ ] **Step 7: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/reflector-core.ts packages/server/src/services/reflector-service.ts packages/server/src/services/reflector-facts.test.ts packages/server/src/services/reflector-core.test.ts && git commit -F - <<'EOF'
feat(coach): ReflectorFacts.financeGoals[] + gatherReflectorFacts populate

Carry ALL unmet finance goals (text/target/targetDate/saved) for the
portfolio coach; single financeGoal* fields kept for the off-path
(byte-identical rollback). gatherReflectorFacts maps the already-computed
per-goal finCandidates into financeGoals.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `reflect()` pacing-ветка → portfolio (off сохранить байт-в-байт)

**Files:**
- Modify: `src/services/reflector-core.ts` (import ~line 3; `reflect()` секция 2, ~line 81-165)
- Test: `src/services/reflector-core.test.ts`

- [ ] **Step 1: Тесты на portfolio-ветку reflect()**

В `src/services/reflector-core.test.ts` добавить (фикстура-хелпер — мини-`ReflectorFacts`; подставь существующий base, дополнив `financeGoals`):

```ts
describe('reflect() — portfolio pacing (флаг on)', () => {
  const RNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(RNOW.getTime() + n * MS);
  const base = {
    monthlyIncome: 100_000,
    monthlyBurn: 0,
    financeGoalTarget: null,
    financeGoalText: null,
    goalVerdicts: [],
    savedSoFar: 0,
    targetDate: inM(12),
    pacingEnabled: true,
    now: RNOW,
    financeGoals: [] as { text: string; target: number; targetDate: Date; saved: number }[],
  };

  it('anchor_at_risk → инсайт finance:goal_pace с «опоздаешь»', () => {
    const out = reflect({
      ...base,
      monthlyIncome: 40_000, // темп 40k
      financeGoals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }], // req 100k
    });
    const ins = out.find((c) => c.scope === 'finance:goal_pace');
    expect(ins).toBeTruthy();
    expect(ins!.message).toContain('опоздаешь');
  });

  it('collision → kind goal_pace_collision', () => {
    const out = reflect({
      ...base,
      monthlyIncome: 60_000,
      financeGoals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
    });
    const ins = out.find((c) => c.scope === 'finance:goal_pace');
    expect(ins?.kind).toBe('goal_pace_collision');
  });

  it('on_track_all → молчит (нет finance:goal_pace)', () => {
    const out = reflect({
      ...base,
      monthlyIncome: 500_000,
      financeGoals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }],
    });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });

  it('off-путь (pacingEnabled=false) — старый horizon-блок жив', () => {
    const out = reflect({
      ...base,
      pacingEnabled: false,
      monthlyIncome: 100_000,
      monthlyBurn: 99_000, // savings 1000/мес
      financeGoalTarget: 5_000_000,
      financeGoalText: 'Большая цель',
      financeGoals: [], // off-путь игнорит массив
    });
    expect(out.find((c) => c.scope === 'finance:goal_horizon')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/services/reflector-core.test.ts`
Expected: FAIL — reflect() ещё одно-целевой (нет collision-kind, portfolio не зовётся).

- [ ] **Step 3: Заменить импорт**

В `src/services/reflector-core.ts` строку 3 заменить:

```ts
import {
  computePortfolioPace,
  describePortfolioPace,
  type PortfolioStatus,
} from './savings-pace.js';
```

- [ ] **Step 4: Добавить карту insight-метаданных**

После `const UNREACHABLE_YEARS = 30;` (~line 47) добавить:

```ts
/** Статус портфеля → метаданные инсайта (kind/severity/dismissKey).
 *  none/on_track_all отсутствуют → молчим. */
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
```

- [ ] **Step 5: Переписать секцию 2 reflect()**

Заменить ВЕСЬ блок секции 2 (от `// 2. Горизонт фин-цели.` до закрывающей `}` перед `// 3. Кросс-модуль`, текущие строки ~81-165) на:

```ts
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
```

- [ ] **Step 6: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/services/reflector-core.test.ts && npx tsc --noEmit`
Expected: PASS. tsc чисто (`computeSavingsPace` больше не импортируется в reflector-core — убедись, что старый импорт заменён, иначе unused).

- [ ] **Step 7: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/reflector-core.ts packages/server/src/services/reflector-core.test.ts && git commit -F - <<'EOF'
feat(coach): reflect() daily pacing → portfolio (all goals + anchor)

On-path (flag on) now calls computePortfolioPace over financeGoals and emits
one finance:goal_pace insight: goal_pace_stalled / goal_pace_behind
(anchor_at_risk) / goal_pace_collision; on_track_all/none stay silent.
Off-path (flag off) preserves the old single-goal «≥30 лет» horizon block
byte-identical.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Реактив `maybeSavingsCoachLine` + гейт → portfolio

**Files:**
- Modify: `src/services/savings-coach.ts` (`NudgeGateInput`, `shouldNudgeOnExpense`, `maybeSavingsCoachLine`)
- Modify: `src/services/savings-coach.test.ts`

- [ ] **Step 1: Обновить/добавить тесты гейта + структурные**

В `src/services/savings-coach.test.ts`:
(а) В существующих кейсах `shouldNudgeOnExpense` заменить `status: 'behind'` → `status: 'anchor_at_risk'`, `status: 'on_track'`/`'reached'` → `status: 'on_track_all'`, и ключ `requiredMonthly:` → `requiredAnchor:`.
(б) Добавить кейсы:

```ts
import { computePortfolioPace } from './savings-pace.js'; // если ещё не импортирован

describe('shouldNudgeOnExpense — портфельный статус', () => {
  const G = (over: Partial<Parameters<typeof shouldNudgeOnExpense>[0]> = {}) => ({
    status: 'anchor_at_risk' as const,
    monthToDateExpense: 0,
    monthlyIncome: 100_000,
    requiredAnchor: 90_000,
    expenseAmount: 0,
    alreadyCoachedToday: false,
    ...over,
  });
  it('on_track_all → молчит', () => {
    expect(shouldNudgeOnExpense(G({ status: 'on_track_all' as never }))).toBe(false);
  });
  it('none → молчит', () => {
    expect(shouldNudgeOnExpense(G({ status: 'none' as never }))).toBe(false);
  });
  it('alreadyCoachedToday → молчит', () => {
    expect(shouldNudgeOnExpense(G({ alreadyCoachedToday: true }))).toBe(false);
  });
  it('anchor_at_risk + крупная разовая (≥10% дохода) → говорит', () => {
    expect(shouldNudgeOnExpense(G({ expenseAmount: 15_000 }))).toBe(true);
  });
  it('collision + месяц за бюджетом-под-главную → говорит', () => {
    // goalBudget = 100k − 90k = 10k; траты 12k > 10k
    expect(
      shouldNudgeOnExpense(G({ status: 'collision' as never, monthToDateExpense: 12_000 })),
    ).toBe(true);
  });
  it('anchor_at_risk + мелкая трата в рамках бюджета → молчит', () => {
    expect(shouldNudgeOnExpense(G({ expenseAmount: 500, monthToDateExpense: 0 }))).toBe(false);
  });
});

describe('maybeSavingsCoachLine — структурно на portfolio', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/savings-coach.ts'), 'utf-8');
  it('зовёт computePortfolioPace + describePortfolioPace', () => {
    expect(src).toContain('computePortfolioPace');
    expect(src).toContain('describePortfolioPace');
  });
  it('гейт по requiredAnchor', () => {
    expect(src).toContain('requiredAnchor');
  });
});
```

(Если в файле ещё нет `readFileSync`/`join` — добавить в импорты: `import { readFileSync } from 'node:fs'; import { join } from 'node:path';`.)

- [ ] **Step 2: Запустить — падает**

Run: `cd packages/server && npx vitest run src/services/savings-coach.test.ts`
Expected: FAIL — гейт ещё на `'behind'`/`requiredMonthly`; portfolio не зовётся.

- [ ] **Step 3: Переписать `NudgeGateInput` + `shouldNudgeOnExpense`**

В `src/services/savings-coach.ts` заменить импорт типа (строка 1) и интерфейс/функцию:

```ts
import type { PortfolioStatus } from './savings-pace.js';
```

```ts
export interface NudgeGateInput {
  status: PortfolioStatus;
  monthToDateExpense: number;
  monthlyIncome: number;
  requiredAnchor: number; // требование главной (₸/мес)
  expenseAmount: number;
  alreadyCoachedToday: boolean;
}

export function shouldNudgeOnExpense(g: NudgeGateInput): boolean {
  if (g.alreadyCoachedToday) return false;
  if (
    g.status !== 'anchor_at_risk' &&
    g.status !== 'collision' &&
    g.status !== 'stalled'
  ) {
    return false;
  }
  const goalBudget = g.monthlyIncome - g.requiredAnchor; // макс. трат/мес под главную
  const monthOverBudget = g.monthToDateExpense > goalBudget;
  const largeSingle =
    g.monthlyIncome > 0 && g.expenseAmount >= 0.1 * g.monthlyIncome;
  return monthOverBudget || largeSingle;
}
```

- [ ] **Step 4: Переписать тело `maybeSavingsCoachLine`**

В `src/services/savings-coach.ts` заменить импорты ядра (строка 6 `import { computeSavingsPace }`) на:

```ts
import { computePortfolioPace, describePortfolioPace } from './savings-pace.js';
```

Внутри `maybeSavingsCoachLine`, заменить блок от `const facts = await gatherReflectorFacts(...)` до построения `const line = ...` на:

```ts
    const facts = await gatherReflectorFacts(userId, now);
    if (facts.financeGoals.length === 0) return null; // нет фин-целей → молчим

    const pf = computePortfolioPace({
      goals: facts.financeGoals,
      capacity: facts.monthlyIncome - facts.monthlyBurn,
      now,
    });
    if (!pf.anchor || pf.status === 'none' || pf.status === 'on_track_all') {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const dayStart = localDayStartUTC(user?.timezone ?? 'UTC', now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [coachedToday, mtdExp] = await Promise.all([
      prisma.insight.count({
        where: { userId, scopeKey: GOAL_PACE_SCOPE, createdAt: { gte: dayStart } },
      }),
      prisma.expense.aggregate({
        where: { userId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);

    const nudge = shouldNudgeOnExpense({
      status: pf.status,
      monthToDateExpense: mtdExp._sum.amount ?? 0,
      monthlyIncome: facts.monthlyIncome,
      requiredAnchor: pf.requiredAnchor,
      expenseAmount,
      alreadyCoachedToday: coachedToday > 0,
    });
    if (!nudge) return null;

    const line = describePortfolioPace(pf);
    if (!line) return null;
```

(Блок ниже — `prisma.insight.create({... message: line, deliveredAt: now ...})` и `return line;` — оставить без изменений. `SavingsStatus` импорт в строке 1 заменён на `PortfolioStatus`; `computeSavingsPace` больше не используется — убедись, что импорт удалён, иначе unused.)

- [ ] **Step 5: Зелёный + tsc**

Run: `cd packages/server && npx vitest run src/services/savings-coach.test.ts && npx tsc --noEmit`
Expected: PASS. tsc чисто (нет unused `computeSavingsPace`/`SavingsStatus`).

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/savings-coach.ts packages/server/src/services/savings-coach.test.ts && git commit -F - <<'EOF'
feat(coach): reactive maybeSavingsCoachLine → portfolio (anchor trade-off)

After a notable expense the reactive coach now reasons over ALL finance goals
via computePortfolioPace and speaks the anchor-centric trade-off line
(describePortfolioPace). Gate shouldNudgeOnExpense keys on portfolio status
(anchor_at_risk|collision|stalled) and goalBudget = monthlyIncome −
requiredAnchor. Dedup scopeKey finance:goal_pace, best-effort, ≤1/day.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Полная сверка + независимое ревью

**Files:** (нет правок кода — верификация)

- [ ] **Step 1: Полная сюита + tsc**

Run: `cd packages/server && npx vitest run && npx tsc --noEmit`
Expected: все тесты зелёные (2069 + новые), tsc 0.

- [ ] **Step 2: Грепнуть на регрессии флага off**

Run: `cd packages/server && grep -n "goal_horizon" src/services/reflector-core.ts`
Expected: оба `goal_horizon_stalled` и `goal_horizon_far` присутствуют (off-путь цел).

- [ ] **Step 3: Независимое ревью**

Dispatch `superpowers:code-reviewer` на диффе Task 1-4 против спеки `docs/superpowers/specs/2026-06-02-savings-coach-portfolio-design.md`. Проверить инварианты: flag-off байт-в-байт (off-путь не тронут по поведению); money-safety не затронута (коуч только читает + пишет Insight, append-only); best-effort try/catch→null в реактиве цел; дедуп scopeKey `finance:goal_pace` сохранён; pure ядро без БД/AI; on_track_all/none молчат. Исправить замечания, повторить до APPROVED.

- [ ] **Step 4: Обновить память/трекер**

Дописать в `~/.claude/projects/.../memory/remediation_plan_2026_06.md` статус «Коуч v2 portfolio — реализован, ждёт пуш/деплой» + предложить Berik «пуш и деплой».

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- §2 якорь = max target → Task 1 (sort by target), unit «якорь = самая денежная».
- §3 computePortfolioPace + статусы → Task 1 (полная логика + 8 unit).
- §4 сообщения (stalled/anchor_at_risk/collision) → Task 1 describePortfolioPace + unit.
- §5a reflect() → Task 3. §5b реактив+гейт → Task 4.
- §6 ReflectorFacts.financeGoals + одиночные для off → Task 2 (+ off-путь сохранён Task 3).
- §7 флаг/без миграций/off байт-в-байт → Task 3 off-ветка + Task 5 grep-регрессия.
- §8 тесты (pure unit + structural) → Tasks 1-4.

**2. Placeholder scan:** нет TBD/«handle edge cases» — весь код приведён.

**3. Type consistency:** `PortfolioGoal/PortfolioInput/GoalLeg/PortfolioStatus/PortfolioPace` определены в Task 1, используются в Tasks 3-4 теми же именами; `ReflectorFacts.financeGoals` форма `{text,target,targetDate,saved}` совпадает с `PortfolioGoal` (структурно) → передаётся в `computePortfolioPace` без map; гейт `requiredAnchor` (не `requiredMonthly`) консистентен Task 4. `describePortfolioPace` возвращает `string|null`, потребители проверяют null.

---

## Execution Handoff

После сохранения — выбор исполнения (Subagent-Driven рекоменд. / Inline executing-plans). Безопасность: push/deploy/флаг ТОЛЬКО по явному «пуш и деплой» Berik; флаг `FEATURE_V2_SAVINGS_COACH` уже `all` → деплой включит portfolio всем (верифицировать прод-фактами через `/tmp/verify-coach.mjs`-стиль скрипт).
