# Goal-Impact (кросс-домен Срез 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) или
> subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Вычисленный детерминированный инсайт — как траты-категории и i_owe-обязательства
«съедают» денежную цель (числами), а не «надежда на LLM».

**Architecture:** Чистые хелперы (формулы) + `buildGoalImpact` (gather: реюз портфельного
пейсера savings-coach + expense groupBy + obligation aggregate) → enrichment (числа по
запросу) + проактивный детектор. За флагом, READ-ONLY, off=байт-идентично.

**Tech Stack:** Prisma 6, Postgres, vitest 2.1.9, тест-БД харнес.

**Rollout:** коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`).
Push/deploy/флаг — ТОЛЬКО по слову Berik. Флаг сначала `user-<Berik>`, потом all.
Все пути относительно `packages/server/`.

**Pinned (из explore):**
- Денежная цель + requiredMonthly = ПОРТФЕЛЬНЫЙ пейсер (как savings-coach):
  `gatherReflectorFacts(userId, now)` (`src/services/reflector-service.ts`) →
  `{ financeGoals:[{goalText,area,target,targetDate}], monthlyIncome, monthlyBurn }`;
  `computePortfolioPace({ goals, capacity: monthlyIncome-monthlyBurn, now })` → `pf`
  с `pf.anchor` (приоритетная цель, имеет goalText/target), `pf.requiredAnchor`
  (≈requiredMonthly), `pf.status`. **Точные имена полей + файл — досверить:**
  `grep -rn "computePortfolioPace\|requiredAnchor\|interface PortfolioPace\|anchor" src/services | grep -v test`.
- Гейт инсайта: `pf.anchor` существует И `pf.status` НЕ on-track (savings-coach
  глушит при `status==='none'||'on_track_all'`).
- `requiredMonthly` в формулах = `pf.requiredAnchor`.
- Траты по категории: `prisma.expense.groupBy({ by:['category'], where:{ userId,
  date:{ gte: monthStart }}, _sum:{ amount:true } })`. `monthStart = new Date(
  now.getFullYear(), now.getMonth(), 1)`.
- i_owe долги: `prisma.obligation.aggregate({ _sum:{amount:true}, where:{ userId,
  kind:'money', direction:'i_owe', status:'open' } })`.
- Флаг — копия `isV2AxesEnabled`. Детектор — паттерн `detectObligationDue`
  (ранний флаг-return). Enrichment — паттерн obligations-section.

---

### Task 1: Флаг `isV2GoalImpactEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Добавить флаг** (после `isV2ObligationsEnabled`)

```ts
/**
 * Goal-Impact (кросс-домен Срез 1). Same shape as isV2AxesEnabled.
 */
export function isV2GoalImpactEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_GOAL_IMPACT;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 2: Юнит-тест** (добавить в `src/lib/feature-flags.test.ts`; импорт + блок)

В import-список добавить `isV2GoalImpactEnabled,`. В конец файла:

```ts
describe('isV2GoalImpactEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_GOAL_IMPACT;
  });
  it('unset → false', () => {
    expect(isV2GoalImpactEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_GOAL_IMPACT = 'all';
    expect(isV2GoalImpactEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_GOAL_IMPACT = 'user-u1';
    expect(isV2GoalImpactEnabled('u1')).toBe(true);
    expect(isV2GoalImpactEnabled('u2')).toBe(false);
  });
});
```

- [ ] **Step 3: Run + tsc.** `npm test -- feature-flags 2>&1 | tail -4` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-flags.ts src/lib/feature-flags.test.ts
git commit -m "feat(goal-impact): isV2GoalImpactEnabled flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистые хелперы (формулы, TDD)

**Files:** Create `src/services/goal-impact/types.ts`, `src/services/goal-impact/types.test.ts`

- [ ] **Step 1: Падающий тест** `src/services/goal-impact/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  computeCategoryImpact,
  computeObligationImpact,
  pickTopCategory,
  describeGoalImpact,
} from './types.js';

describe('goal-impact/types', () => {
  it('computeCategoryImpact: доля = трата/requiredMonthly; req<=0 → null', () => {
    expect(computeCategoryImpact(34000, 85000)?.share).toBeCloseTo(0.4, 2);
    expect(computeCategoryImpact(34000, 0)).toBeNull();
    expect(computeCategoryImpact(34000, -5)).toBeNull();
  });
  it('computeObligationImpact: monthsDelay = долг/req; req<=0 → null', () => {
    expect(computeObligationImpact(500000, 100000)?.monthsDelay).toBeCloseTo(5, 5);
    expect(computeObligationImpact(500000, 0)).toBeNull();
  });
  it('pickTopCategory: запись с max amount или null', () => {
    expect(
      pickTopCategory([
        { category: 'food', amount: 12000 },
        { category: 'transport', amount: 34000 },
      ]),
    ).toEqual({ category: 'transport', amount: 34000 });
    expect(pickTopCategory([])).toBeNull();
  });
  it('describeGoalImpact: строка с числами; null если нечего сказать', () => {
    const s = describeGoalImpact(
      'миллион',
      85000,
      { category: 'food', amount: 34000 },
      500000,
    );
    expect(s).toContain('миллион');
    expect(s).toContain('40%');
    expect(describeGoalImpact('миллион', 85000, null, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — упасть.** `npm test -- goal-impact/types 2>&1 | tail -4` → FAIL (module not found).

- [ ] **Step 3: Реализация** `src/services/goal-impact/types.ts`

```ts
export interface CategorySpend {
  category: string;
  amount: number;
}

export interface CategoryImpact {
  share: number; // доля категории от месячной нормы накопления (0..N)
}

export interface ObligationImpact {
  monthsDelay: number; // на сколько месяцев долги отодвигают цель
}

/** Доля траты-категории от того, что нужно откладывать в месяц. req<=0 → null. */
export function computeCategoryImpact(
  categorySpend: number,
  requiredMonthly: number,
): CategoryImpact | null {
  if (requiredMonthly <= 0) return null;
  return { share: categorySpend / requiredMonthly };
}

/** На сколько месяцев накопления отодвигают долги. req<=0 → null. */
export function computeObligationImpact(
  totalOwed: number,
  requiredMonthly: number,
): ObligationImpact | null {
  if (requiredMonthly <= 0) return null;
  return { monthsDelay: totalOwed / requiredMonthly };
}

/** Категория с максимальной тратой, или null если список пуст. */
export function pickTopCategory(byCategory: CategorySpend[]): CategorySpend | null {
  if (byCategory.length === 0) return null;
  return byCategory.reduce((max, c) => (c.amount > max.amount ? c : max));
}

/** Человеческая строка из чисел. null если совсем нечего сказать. */
export function describeGoalImpact(
  goalText: string,
  requiredMonthly: number,
  topCat: CategorySpend | null,
  totalOwed: number,
): string | null {
  if (requiredMonthly <= 0) return null;
  const r = (n: number) => Math.round(n);
  const parts: string[] = [];
  const cat = topCat ? computeCategoryImpact(topCat.amount, requiredMonthly) : null;
  if (topCat && cat && cat.share >= 0.1) {
    parts.push(
      `«${topCat.category}» съела ${r(topCat.amount)}₸ = ${r(cat.share * 100)}% ` +
        `от нужного на цель`,
    );
  }
  const obl = totalOwed > 0 ? computeObligationImpact(totalOwed, requiredMonthly) : null;
  if (obl && obl.monthsDelay >= 0.5) {
    parts.push(`долги ${r(totalOwed)}₸ сдвинут цель на ~${r(obl.monthsDelay)} мес`);
  }
  if (parts.length === 0) return null;
  return `🎯 «${goalText}»: нужно ~${r(requiredMonthly)}₸/мес. ` + parts.join('; ') + '.';
}
```

- [ ] **Step 4: Run — зелёный.** `npm test -- goal-impact/types 2>&1 | tail -4` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/goal-impact/types.ts src/services/goal-impact/types.test.ts
git commit -m "feat(goal-impact): pure formula helpers (category/obligation impact)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `buildGoalImpact` (gather + compute) + index

**Files:** Create `src/services/goal-impact/goal-impact.ts`, `src/services/goal-impact/index.ts`

- [ ] **Step 1: Досверить портфельный пейсер**

Run: `grep -rn "export function computePortfolioPace\|export async function gatherReflectorFacts\|requiredAnchor\|anchor" src/services | grep -v test | head`
Зафиксируй: файл `computePortfolioPace`, точные поля `pf.anchor` (есть ли `.goalText`),
`pf.requiredAnchor`, `pf.status`, и значения status, при которых «на треке»
(`'none'`, `'on_track_all'`). Если имя поля иное — подставь реальное в Step 2.

- [ ] **Step 2: Реализация** `src/services/goal-impact/goal-impact.ts`

```ts
import { prisma } from '../../lib/prisma.js';
import { gatherReflectorFacts } from '../reflector-service.js';
import { computePortfolioPace } from '../portfolio-pace.js'; // путь досверить в Step 1
import {
  computeCategoryImpact,
  computeObligationImpact,
  describeGoalImpact,
  pickTopCategory,
  type CategorySpend,
} from './types.js';

export interface GoalImpact {
  goalText: string;
  requiredMonthly: number;
  topCategory: CategorySpend | null;
  categoryShare: number | null;
  totalOwed: number;
  monthsDelay: number | null;
  status: string;
  insightText: string;
}

/**
 * Кросс-доменный инсайт: как траты-категории и i_owe-долги «съедают» денежную
 * цель. READ-ONLY. null если денежной цели нет / цель на треке / нечего сказать.
 */
export async function buildGoalImpact(
  userId: string,
  now: Date = new Date(),
): Promise<GoalImpact | null> {
  try {
    const facts = await gatherReflectorFacts(userId, now);
    if (facts.financeGoals.length === 0) return null;
    const pf = computePortfolioPace({
      goals: facts.financeGoals,
      capacity: facts.monthlyIncome - facts.monthlyBurn,
      now,
    });
    // Гейт: есть приоритетная цель И НЕ на треке (иначе не ноем).
    if (!pf.anchor || pf.status === 'none' || pf.status === 'on_track_all') {
      return null;
    }
    const requiredMonthly = pf.requiredAnchor;
    if (requiredMonthly <= 0) return null;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [byCatRaw, owedAgg] = await Promise.all([
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.obligation.aggregate({
        _sum: { amount: true },
        where: { userId, kind: 'money', direction: 'i_owe', status: 'open' },
      }),
    ]);

    const byCategory: CategorySpend[] = byCatRaw.map((r) => ({
      category: r.category,
      amount: r._sum.amount ?? 0,
    }));
    const topCategory = pickTopCategory(byCategory);
    const totalOwed = owedAgg._sum.amount ?? 0;
    const goalText = pf.anchor.goalText;

    const catImpact = topCategory
      ? computeCategoryImpact(topCategory.amount, requiredMonthly)
      : null;
    const oblImpact =
      totalOwed > 0 ? computeObligationImpact(totalOwed, requiredMonthly) : null;
    const insightText = describeGoalImpact(
      goalText,
      requiredMonthly,
      topCategory,
      totalOwed,
    );
    if (!insightText) return null;

    return {
      goalText,
      requiredMonthly,
      topCategory,
      categoryShare: catImpact?.share ?? null,
      totalOwed,
      monthsDelay: oblImpact?.monthsDelay ?? null,
      status: pf.status,
      insightText,
    };
  } catch (err) {
    console.warn('[goal-impact] buildGoalImpact failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 3: Re-export** `src/services/goal-impact/index.ts`

```ts
export * from './types.js';
export * from './goal-impact.js';
```

- [ ] **Step 4: tsc.** `npx tsc --noEmit` → 0. (Если имя поля pf/путь импорта не сошлись —
  поправить по Step 1 и повторить.)

- [ ] **Step 5: Commit**

```bash
git add src/services/goal-impact/goal-impact.ts src/services/goal-impact/index.ts
git commit -m "feat(goal-impact): buildGoalImpact gather+compute (reuse portfolio pacer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Поведенческий тест через тест-БД харнес

**Files:** Create `src/services/goal-impact/goal-impact.it.test.ts`

- [ ] **Step 1: Тест** (реальная БД; финансовая цель behind + траты 2 категорий + i_owe)

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildGoalImpact } from './goal-impact.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'GI', passwordHash: 'x' } });
  return u.id;
}

describe('goal-impact buildGoalImpact — реальная БД', () => {
  it('денежная цель позади + траты + долг → числовой инсайт', async () => {
    const userId = await seedUser('gi-a@a.test');
    // финансовая годовая цель: накопить, target большой, прогресс маленький → behind
    await prisma.yearlyGoal.create({
      data: {
        userId,
        year: new Date().getFullYear(),
        area: 'finance',
        goalText: 'миллион',
        target: 1_000_000,
        progress: 5,
      },
    });
    // доход/расход — чтобы capacity>0, но темп отстаёт
    await prisma.income.create({ data: { userId, date: new Date(), source: 'work', amount: 300000 } });
    await prisma.expense.create({ data: { userId, date: new Date(), category: 'food', description: 'доставка', amount: 80000 } });
    await prisma.expense.create({ data: { userId, date: new Date(), category: 'transport', description: 'такси', amount: 20000 } });
    await prisma.obligation.create({
      data: { userId, personName: 'Ахмет', personEntityId: null, direction: 'i_owe', kind: 'money', amount: 500000, description: 'долг', source: 'manual' },
    });

    const gi = await buildGoalImpact(userId, new Date());
    expect(gi).not.toBeNull();
    expect(gi!.goalText).toBe('миллион');
    expect(gi!.requiredMonthly).toBeGreaterThan(0);
    expect(gi!.topCategory?.category).toBe('food'); // 80k > 20k
    expect(gi!.totalOwed).toBe(500000);
    expect(gi!.insightText).toContain('миллион');
  });

  it('нет финансовой цели → null', async () => {
    const userId = await seedUser('gi-none@a.test');
    expect(await buildGoalImpact(userId, new Date())).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('gi-iso-a@a.test');
    const b = await seedUser('gi-iso-b@a.test');
    await prisma.yearlyGoal.create({
      data: { userId: a, year: new Date().getFullYear(), area: 'finance', goalText: 'A-цель', target: 1_000_000, progress: 1 },
    });
    await prisma.expense.create({ data: { userId: a, date: new Date(), category: 'food', description: 'x', amount: 90000 } });
    const giB = await buildGoalImpact(b, new Date());
    expect(giB).toBeNull(); // у B нет цели/трат
  });
});
```

- [ ] **Step 2: Прогнать через харнес.** Run: `npm run test:db:up && npm run test:it 2>&1 | grep -E "goal-impact|Tests "` → PASS (+ baseline integration зелёный). Если поля YearlyGoal/Income/Expense иначе — свериться: `grep -A12 "model YearlyGoal" prisma/schema.prisma`.

- [ ] **Step 3: Commit**

```bash
git add src/services/goal-impact/goal-impact.it.test.ts
git commit -m "test(goal-impact): behavioral buildGoalImpact + cross-user isolation (real DB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enrichment — числа в контекст мозга

**Files:** Modify `src/services/v2-enrichment.ts`, Create `src/services/goal-impact-enrichment.test.ts`

- [ ] **Step 1: Найти точку сборки блоков** (как obligations)

Run: `grep -n "isV2ObligationsEnabled\|formatObligationsSection\|withTimeout\|isV2AxesEnabled" src/services/v2-enrichment.ts | head`

- [ ] **Step 2: Добавить форматтер + вызов** (по тому же паттерну)

```ts
import { isV2GoalImpactEnabled } from '../lib/feature-flags.js';
import { buildGoalImpact } from './goal-impact/index.js';
import { withTimeout } from '../lib/with-timeout.js';

export function formatGoalImpactSection(insightText: string | null): string {
  if (!insightText) return '';
  return `Влияние на цель (вычислено): ${insightText}`;
}
// …в основной enrich-функции, рядом с obligations:
let goalImpactBlock = '';
if (isV2GoalImpactEnabled(userId)) {
  const gi = await withTimeout(buildGoalImpact(userId), 700, null);
  goalImpactBlock = formatGoalImpactSection(gi?.insightText ?? null);
}
// …вставить goalImpactBlock в собираемый системный контекст.
```

- [ ] **Step 3: Структурный тест** `src/services/goal-impact-enrichment.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('goal-impact enrichment', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
  it('за флагом + withTimeout + форматтер', () => {
    expect(src).toContain('isV2GoalImpactEnabled');
    expect(src).toContain('buildGoalImpact');
    expect(src).toContain('withTimeout');
    expect(src).toContain('formatGoalImpactSection');
  });
});
```

- [ ] **Step 4: Run + tsc.** `npm test -- goal-impact-enrichment 2>&1 | tail -4` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/v2-enrichment.ts src/services/goal-impact-enrichment.test.ts
git commit -m "feat(goal-impact): enrich brain context with computed goal impact (flag+withTimeout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Проактивный детектор `detectGoalImpact`

**Files:** Modify `src/services/v2-proactivity-engine.ts`, Create `src/services/v2-proactivity-goal-impact.test.ts`

- [ ] **Step 1: Добавить `'goal_impact'` в union `NudgeSource`** (после `'obligation_due'`)

```ts
  | 'goal_impact';
```

- [ ] **Step 2: Блок в `TEMPLATES`** (после `obligation_due`)

```ts
  goal_impact: {
    gentle: '«{{category}}» съела {{share}}% месячной нормы на цель «{{goal}}». Поднажми?',
    curious: 'Заметил: «{{category}}» = {{share}}% от того, что нужно на «{{goal}}». Подвинем?',
    supportive: 'Цель «{{goal}}» отстаёт; «{{category}}» ест {{share}}% нормы. Перенаправим — нагоним.',
  },
```

- [ ] **Step 3: Детектор** (рядом с `detectObligationDue`, с РАННИМ флаг-return)

```ts
async function detectGoalImpact(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2GoalImpactEnabled } = await import('../lib/feature-flags.js');
    if (!isV2GoalImpactEnabled(userId)) return [];
    const { buildGoalImpact } = await import('./goal-impact/index.js');
    const gi = await buildGoalImpact(userId);
    if (!gi) return [];
    const share = gi.categoryShare ?? 0;
    const delay = gi.monthsDelay ?? 0;
    if (share < 0.25 && delay < 1) return [];
    const cand: NudgeCandidate = {
      source: 'goal_impact',
      significance: 0,
      payload: {
        goal: gi.goalText,
        category: gi.topCategory?.category ?? '',
        share: String(Math.round(share * 100)),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectGoalImpact failed:', err);
    return [];
  }
}
```

- [ ] **Step 4: Зарегистрировать** в `V2ProactivityEngine.detectCandidates` `Promise.allSettled([...])` — добавить строку `detectGoalImpact(userId),`.

- [ ] **Step 5: Структурный тест** `src/services/v2-proactivity-goal-impact.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('goal_impact detector wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
  it('источник+шаблон+детектор+флаг-гейт+регистрация', () => {
    expect(src).toContain("'goal_impact'");
    expect(src).toContain('goal_impact:');
    expect(src).toContain('async function detectGoalImpact');
    expect(src).toContain('isV2GoalImpactEnabled'); // ранний флаг-return
    expect(src).toMatch(/detectCandidates[\s\S]*detectGoalImpact\(userId\)/);
  });
});
```

- [ ] **Step 6: Run + tsc.** `npm test -- v2-proactivity-goal-impact 2>&1 | tail -4` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/v2-proactivity-engine.ts src/services/v2-proactivity-goal-impact.test.ts
git commit -m "feat(goal-impact): detectGoalImpact proactivity detector (flag-gated) + templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: No-write guard + полная верификация + ревью

**Files:** Create `src/services/goal-impact/no-write-guard.test.ts`

- [ ] **Step 1: Структурный money/read-only guard**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('goal-impact read-only guard', () => {
  it('ни одного prisma write в services/goal-impact', () => {
    const dir = join(process.cwd(), 'src/services/goal-impact');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
    }
  });
});
```

- [ ] **Step 2: Запустить guard + tsc + оба прогона**

Run: `npm test -- goal-impact/no-write-guard 2>&1 | tail -4` → PASS.
Run: `npx tsc --noEmit` → 0.
Run: `npm test 2>&1 | tail -3` → unit (~2231 + новые) PASS.
Run: `npm run test:db:up && npm run test:it 2>&1 | tail -3` → integration PASS.

- [ ] **Step 3: Negative control (детектор реально флаг-гейтнут)**

Временно убрать строку `if (!isV2GoalImpactEnabled(userId)) return [];` из `detectGoalImpact`
→ структурный тест Task 6 КРАСНЕЕТ (нет `isV2GoalImpactEnabled` в нужном месте? —
проверь, что тест ловит; если нет — добавить ассерт на ранний-return) → откатить.
(Цель: убедиться, что off=байт-идентично для проактивности.)

- [ ] **Step 4: Независимое ревью** — `pr-review-toolkit:code-reviewer` по диффу goal-impact:
  фокус (a) READ-ONLY (ноль write), (b) cross-user изоляция (всё по userId),
  (c) флаг-гейтинг детектора+enrichment (off=identical), (d) деление на ноль (req<=0→null).

- [ ] **Step 5: Commit guard**

```bash
git add src/services/goal-impact/no-write-guard.test.ts
git commit -m "test(goal-impact): read-only guard + full verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec coverage:** флаг (T1), формулы (T2), gather buildGoalImpact (T3), поведенческий
  харнес (T4), enrichment (T5), детектор (T6), read-only guard+verify (T7). Все секции спеки.
- **Placeholder scan:** код в каждом шаге; «досверить grep'ом» (PortfolioPace поля, enrichment
  точка вставки, YearlyGoal поля) — локаторы интеграционных точек, не плейсхолдеры.
- **Type consistency:** `CategorySpend`/`CategoryImpact`/`ObligationImpact`/`GoalImpact`
  едины; `buildGoalImpact(userId, now?)→GoalImpact|null`; `requiredMonthly=pf.requiredAnchor`
  везде; детектор+enrichment зовут `buildGoalImpact` одинаково.
- **Money/read-only:** T7 guard запрещает любой prisma write в goal-impact.
- **Открытый риск:** точные поля `pf` (anchor.goalText/requiredAnchor/status) и путь
  `computePortfolioPace` — досверяются в T3 Step 1 grep'ом (интеграционная точка).

## Verification gate (вся фича)
1. `npm run test:db:up` healthy.
2. `npm run test:it` — goal-impact integration + baseline зелёные.
3. `npm test` unit (~2231 + новые) зелёные; `npx tsc --noEmit` 0.
4. Negative control: убрать флаг-гейт детектора → красный → откат.
5. Флаг OFF → enrichment пуст, детектор пуст → байт-идентично.
6. Read-only guard: ноль prisma write в services/goal-impact.
