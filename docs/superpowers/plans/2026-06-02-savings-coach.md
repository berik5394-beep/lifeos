# Коуч по накоплениям — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот считает темп накоплений против срока финансовой цели и проактивно/реактивно советует «успеешь/отстаёшь — откладывай X/мес».

**Architecture:** Подход C — одно чистое ядро `savings-pace.ts` (вся математика, без БД/AI) + три тонких потребителя: рефлектор (дневной проактив), реактивный хук после `add_expense` (точка схождения текст/голос/фото), и опц. on-demand (вне объёма). Всё за флагом `FEATURE_V2_SAVINGS_COACH` (off = байт-в-байт сегодня).

**Tech Stack:** Node + Fastify + Prisma + Postgres, TypeScript strict (no `any`), ESM NodeNext (`.js` импорты), vitest. Тесты: pure unit + структурные (readFileSync+grep), zero `vi.mock`, `createAnthropic()` only (новых AI-вызовов нет). Коммит на шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Spec:** `docs/superpowers/specs/2026-06-02-savings-coach-design.md`

**Правила выкатки:** локальные коммиты по шагам. Push/deploy/флаг — ТОЛЬКО по явному слову Berik. Прод-БД НЕ трогать; миграции применять только на локальном docker (`prisma migrate dev`), на прод — `prisma generate`. Все команды `npx ...` из `packages/server`.

---

## Файловая карта

| Файл | Действие | Ответственность |
|---|---|---|
| `src/services/savings-pace.ts` | 🆕 | Чистое ядро `computeSavingsPace` + типы |
| `src/services/savings-pace.test.ts` | 🆕 | Юнит ядра |
| `src/services/savings-coach.ts` | 🆕 | `shouldNudgeOnExpense` (pure) + `maybeSavingsCoachLine` (хук) |
| `src/services/savings-coach.test.ts` | 🆕 | Гейт unit + структурный |
| `src/services/goal-deadline.ts` | 🆕 | `parseGoalDeadline` (pure) |
| `src/services/goal-deadline.test.ts` | 🆕 | Юнит парсера даты |
| `src/lib/feature-flags.ts` | ✏️ | `isV2SavingsCoachEnabled` |
| `src/services/reflector-core.ts` | ✏️ | `ReflectorFacts` +4 поля; `reflect()` pacing-ветка |
| `src/services/reflector-service.ts` | ✏️ | `gatherReflectorFacts` +savedSoFar/targetDate/pacingEnabled/now; export |
| `src/services/jarvis-orchestrator.ts` | ✏️ | Вызов хука после `add_expense` в 2 точках |
| `src/services/planner-service.ts` | ✏️ | Запись `targetDate` через `parseGoalDeadline` |
| `prisma/schema.prisma` (+миграция) | ✏️ | `YearlyGoal.targetDate DateTime?` |

**Порядок задач** подобран так, что каждая компилируется и тестируется независимо; интеграции (6→11) идут после своих pure-зависимостей (3,4,5).

---

## Task 1: Миграция `YearlyGoal.targetDate`

**Files:**
- Modify: `packages/server/prisma/schema.prisma` (модель `YearlyGoal`, ~стр. 304-330)
- Create: `packages/server/prisma/migrations/<timestamp>_yearly_goal_target_date/migration.sql` (через `prisma migrate dev`)

- [ ] **Step 1: Добавить поле в схему**

В модель `YearlyGoal`, сразу после строки `target     Float?`, добавить:

```prisma
  target     Float?
  targetDate DateTime? // срок фин-цели для коуча; null → адаптер берёт 31 дек
  pacingMode String @default("uniform")
```

- [ ] **Step 2: Сгенерировать миграцию на ЛОКАЛЬНОМ docker**

Run: `npx prisma migrate dev --name yearly_goal_target_date`
Expected: создаётся `prisma/migrations/<ts>_yearly_goal_target_date/migration.sql` с `ALTER TABLE "YearlyGoal" ADD COLUMN "targetDate" TIMESTAMP(3);`. Prisma Client регенерится.
⚠️ Это бьёт по ЛОКАЛЬНОЙ docker-БД (`DATABASE_URL` в `.env` локальной разработки). НЕ запускать против прод-URL. Если локального docker нет — `npx prisma migrate dev` поднимет/применит к dev-БД; на прод миграция уедет позже через `migrate deploy` по слову Berik.

- [ ] **Step 3: Проверить, что Client знает поле**

Run: `npx tsc --noEmit`
Expected: tsc 0 (поле `targetDate` доступно в типах `YearlyGoal`).

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations
git commit -F - <<'EOF'
feat(db): YearlyGoal.targetDate (срок фин-цели для коуча)

Аддитивная nullable-колонка. Миграция применена на локальном docker;
на прод уедет через migrate deploy по слову Berik.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Флаг `isV2SavingsCoachEnabled`

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Test: `packages/server/src/lib/feature-flags.savings-coach.test.ts` (Create)

- [ ] **Step 1: Failing test**

Создать `packages/server/src/lib/feature-flags.savings-coach.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { isV2SavingsCoachEnabled } from './feature-flags.js';

const KEY = 'FEATURE_V2_SAVINGS_COACH';
afterEach(() => { delete process.env[KEY]; });

describe('isV2SavingsCoachEnabled', () => {
  it('unset → false', () => { expect(isV2SavingsCoachEnabled('u1')).toBe(false); });
  it('"all" → true', () => { process.env[KEY] = 'all'; expect(isV2SavingsCoachEnabled('u1')).toBe(true); });
  it('"none" → false', () => { process.env[KEY] = 'none'; expect(isV2SavingsCoachEnabled('u1')).toBe(false); });
  it('per-user список', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2SavingsCoachEnabled('u1')).toBe(true);
    expect(isV2SavingsCoachEnabled('u3')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/lib/feature-flags.savings-coach.test.ts`
Expected: FAIL — `isV2SavingsCoachEnabled` не экспортирован.

- [ ] **Step 3: Реализация**

В `src/lib/feature-flags.ts` рядом с `isV2WriteEnabled` (он использует хелпер `isEnabledForUser`) добавить:

```ts
/**
 * Коуч по накоплениям (deadline-pacing + reactive-on-expense). Та же
 * форма, что у соседей: "all"/"true", "none"/"false"/unset, "user-X,user-Y".
 * Off → рефлектор и расходный путь работают как сегодня (байт-в-байт).
 */
export function isV2SavingsCoachEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_SAVINGS_COACH, userId);
}
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run src/lib/feature-flags.savings-coach.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.savings-coach.test.ts
git commit -F - <<'EOF'
feat(flags): isV2SavingsCoachEnabled (FEATURE_V2_SAVINGS_COACH)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Чистое ядро `savings-pace.ts`

**Files:**
- Create: `packages/server/src/services/savings-pace.ts`
- Test: `packages/server/src/services/savings-pace.test.ts`

- [ ] **Step 1: Failing test**

Создать `packages/server/src/services/savings-pace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSavingsPace } from './savings-pace.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const DEC = new Date('2026-12-31T00:00:00Z'); // ~7 мес

describe('computeSavingsPace — статусы', () => {
  it('no_target при target<=0', () => {
    const r = computeSavingsPace({ target: 0, targetDate: DEC, savedSoFar: 0, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('no_target');
  });
  it('reached когда savedSoFar>=target', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: 1200, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('reached');
  });
  it('stalled когда monthlyPace<=0', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: 100, monthlyPace: 0, now: NOW });
    expect(r.status).toBe('stalled');
  });
  it('behind когда прогноз ниже цели + выдаёт requiredMonthly/paceGap', () => {
    // 3M цель, накоплено 0, темп 200k/мес × 7 мес = 1.4M < 3M
    const r = computeSavingsPace({ target: 3_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 200_000, now: NOW });
    expect(r.status).toBe('behind');
    expect(r.requiredMonthly).toBeGreaterThan(200_000); // надо больше текущего темпа
    expect(r.paceGap).toBeGreaterThan(0);
    expect(r.shortfall).toBeGreaterThan(0);
  });
  it('on_track когда прогноз достигает цели', () => {
    const r = computeSavingsPace({ target: 1_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 160_000, now: NOW });
    expect(['on_track', 'ahead']).toContain(r.status);
  });
  it('ahead когда прогноз >=110% цели', () => {
    const r = computeSavingsPace({ target: 1_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 300_000, now: NOW });
    expect(r.status).toBe('ahead');
  });
});

describe('computeSavingsPace — границы (без NaN/Infinity)', () => {
  it('срок прошёл (monthsLeft=0, не добрал) → behind, requiredMonthly=remaining', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const r = computeSavingsPace({ target: 1000, targetDate: past, savedSoFar: 400, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('behind');
    expect(r.monthsLeft).toBe(0);
    expect(r.requiredMonthly).toBe(600);
    expect(Number.isFinite(r.requiredMonthly)).toBe(true);
  });
  it('перерасход savedSoFar<0 — не падает', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: -200, monthlyPace: -50, now: NOW });
    expect(r.status).toBe('stalled');
    expect(Number.isFinite(r.progressPct)).toBe(true);
  });
});
```

(Поле `monthlyPaceUsed` в sanity-проверке убрать — оно лишнее; оставлено для ясности интента. Корректная проверка ниже в Step 3 не требует его; при реализации заменить строку на `expect(r.requiredMonthly).toBeGreaterThan(200_000);`.)

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/savings-pace.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализация**

Создать `packages/server/src/services/savings-pace.ts`:

```ts
/**
 * Чистое ядро коуча по накоплениям. Без БД/AI — вся математика «темп vs
 * срок» здесь, тестируется раз, зовут три потребителя (рефлектор,
 * реактивный хук, опц. on-demand). Честность by construction: числа из
 * входа (адаптер берёт их из БД), статус детерминирован.
 */
export interface SavingsPaceFacts {
  target: number;       // сумма цели (₸); <=0 → no_target
  targetDate: Date;     // срок (адаптер подставляет 31 дек если не задан)
  savedSoFar: number;   // Σ(Income) − Σ(Expense) с начала года (может быть < 0)
  monthlyPace: number;  // текущий темп сбережений/мес (может быть <= 0)
  now: Date;
}

export type SavingsStatus =
  | 'no_target' | 'reached' | 'stalled' | 'behind' | 'on_track' | 'ahead';

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
```

- [ ] **Step 4: Run → pass + tsc**

Run: `npx vitest run src/services/savings-pace.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/savings-pace.ts packages/server/src/services/savings-pace.test.ts
git commit -F - <<'EOF'
feat(coach): чистое ядро savings-pace (темп накоплений vs срок)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Чистый гейт `shouldNudgeOnExpense`

**Files:**
- Create: `packages/server/src/services/savings-coach.ts` (только pure-гейт; хук — Task 8)
- Test: `packages/server/src/services/savings-coach.test.ts`

- [ ] **Step 1: Failing test**

Создать `packages/server/src/services/savings-coach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldNudgeOnExpense } from './savings-coach.js';

const base = {
  status: 'behind' as const,
  monthToDateExpense: 0,
  monthlyIncome: 500_000,
  requiredMonthly: 250_000,   // goalBudget = 250_000
  expenseAmount: 1000,
  alreadyCoachedToday: false,
};

describe('shouldNudgeOnExpense — гейт «бьёт по цели»', () => {
  it('молчит если уже советовали сегодня', () => {
    expect(shouldNudgeOnExpense({ ...base, alreadyCoachedToday: true, monthToDateExpense: 999_999 })).toBe(false);
  });
  it('молчит если статус не behind/stalled', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'on_track' })).toBe(false);
  });
  it('говорит когда траты месяца превысили бюджет под цель', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 300_000 })).toBe(true); // >250k
  });
  it('говорит на крупную разовую трату (>=10% дохода)', () => {
    expect(shouldNudgeOnExpense({ ...base, expenseAmount: 60_000 })).toBe(true); // 12% от 500k
  });
  it('молчит на обычную трату в рамках бюджета', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 100_000, expenseAmount: 1000 })).toBe(false);
  });
  it('stalled тоже триггерит (при превышении бюджета)', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'stalled', monthToDateExpense: 300_000 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/savings-coach.test.ts`
Expected: FAIL — модуль/функция отсутствуют.

- [ ] **Step 3: Реализация (только гейт)**

Создать `packages/server/src/services/savings-coach.ts`:

```ts
import type { SavingsStatus } from './savings-pace.js';

/**
 * Чистый гейт реактивного коуча: после расхода говорить ТОЛЬКО когда он
 * «бьёт по цели». Защищает от занудства (см. spec §7a).
 */
export interface NudgeGateInput {
  status: SavingsStatus;
  monthToDateExpense: number;
  monthlyIncome: number;
  requiredMonthly: number;
  expenseAmount: number;
  alreadyCoachedToday: boolean;
}

export function shouldNudgeOnExpense(g: NudgeGateInput): boolean {
  if (g.alreadyCoachedToday) return false;
  if (g.status !== 'behind' && g.status !== 'stalled') return false;
  const goalBudget = g.monthlyIncome - g.requiredMonthly; // макс. трат/мес чтобы успевать
  const monthOverBudget = g.monthToDateExpense > goalBudget;
  const largeSingle = g.monthlyIncome > 0 && g.expenseAmount >= 0.1 * g.monthlyIncome;
  return monthOverBudget || largeSingle;
}
```

- [ ] **Step 4: Run → pass + tsc**

Run: `npx vitest run src/services/savings-coach.test.ts && npx tsc --noEmit`
Expected: PASS (6), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/savings-coach.ts packages/server/src/services/savings-coach.test.ts
git commit -F - <<'EOF'
feat(coach): чистый гейт shouldNudgeOnExpense (бьёт по цели)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Парсер срока `parseGoalDeadline`

**Files:**
- Create: `packages/server/src/services/goal-deadline.ts`
- Test: `packages/server/src/services/goal-deadline.test.ts`

- [ ] **Step 1: Failing test**

Создать `packages/server/src/services/goal-deadline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGoalDeadline } from './goal-deadline.js';

const NOW = new Date('2026-06-01T00:00:00Z');

describe('parseGoalDeadline', () => {
  it('«к декабрю» → 31 дек текущего года', () => {
    const d = parseGoalDeadline('накопить 3 млн к декабрю', NOW)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // декабрь
    expect(d.getDate()).toBe(31);
  });
  it('«к концу года» → 31 дек', () => {
    const d = parseGoalDeadline('накопить миллион к концу года', NOW)!;
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
  it('«до июня 2027» → 30 июня 2027', () => {
    const d = parseGoalDeadline('отложить на машину до июня 2027', NOW)!;
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(5); // июнь
    expect(d.getDate()).toBe(30);
  });
  it('нет даты → null', () => {
    expect(parseGoalDeadline('накопить 3 млн', NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/goal-deadline.test.ts`
Expected: FAIL — модуль отсутствует.

- [ ] **Step 3: Реализация**

Создать `packages/server/src/services/goal-deadline.ts`:

```ts
/**
 * Чистый парсер срока из текста цели. «к декабрю», «к концу года»,
 * «до июня 2027». Нет даты → null (адаптер подставит 31 дек). `now`
 * инжектируется → тестируется без часов.
 */
const MONTH_STEMS: Array<[string, number]> = [
  ['январ', 0], ['феврал', 1], ['март', 2], ['апрел', 3],
  ['ма', 4], ['июн', 5], ['июл', 6], ['август', 7],
  ['сентябр', 8], ['октябр', 9], ['ноябр', 10], ['декабр', 11],
];

export function parseGoalDeadline(text: string, now: Date): Date | null {
  const t = text.toLowerCase();
  if (/(к|до)\s+конц[а-яё]*\s+год/.test(t)) {
    return new Date(now.getFullYear(), 11, 31);
  }
  const m = t.match(/(?:к|до)\s+([а-яё]+)(?:\s+(\d{4}))?/);
  if (m) {
    const word = m[1];
    for (const [stem, idx] of MONTH_STEMS) {
      if (word.startsWith(stem)) {
        const year = m[2] ? Number(m[2]) : now.getFullYear();
        // последний день месяца: день 0 следующего месяца
        return new Date(year, idx + 1, 0);
      }
    }
  }
  return null;
}
```

⚠️ Порядок `MONTH_STEMS` важен: `'ма'` (май) идёт ПОСЛЕ `'март'`, иначе «март» начнётся с «ма». Проверено: для «март» сначала матчится `'март'`. Для «мае/маю/мая» — `'ма'`.

- [ ] **Step 4: Run → pass + tsc**

Run: `npx vitest run src/services/goal-deadline.test.ts && npx tsc --noEmit`
Expected: PASS (4), tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/goal-deadline.ts packages/server/src/services/goal-deadline.test.ts
git commit -F - <<'EOF'
feat(coach): parseGoalDeadline — срок из текста цели

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Рефлектор-факты — savedSoFar / targetDate / pacingEnabled / now

**Files:**
- Modify: `packages/server/src/services/reflector-core.ts` (интерфейс `ReflectorFacts`, ~стр. 20-34)
- Modify: `packages/server/src/services/reflector-service.ts` (`gatherReflectorFacts`, ~стр. 26-105; экспорт)
- Test: `packages/server/src/services/reflector-facts.test.ts` (Create, структурный)

- [ ] **Step 1: Failing structural test**

Создать `packages/server/src/services/reflector-facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = readFileSync(join(process.cwd(), 'src/services/reflector-core.ts'), 'utf-8');
const SVC = readFileSync(join(process.cwd(), 'src/services/reflector-service.ts'), 'utf-8');

describe('ReflectorFacts расширены под коуча', () => {
  it('интерфейс несёт savedSoFar/targetDate/pacingEnabled/now', () => {
    expect(CORE).toMatch(/savedSoFar:\s*number/);
    expect(CORE).toMatch(/targetDate:\s*Date/);
    expect(CORE).toMatch(/pacingEnabled:\s*boolean/);
    expect(CORE).toMatch(/now:\s*Date/);
  });
  it('gatherReflectorFacts считает savedSoFar с начала года и pacingEnabled по флагу', () => {
    expect(SVC).toContain('isV2SavingsCoachEnabled');
    expect(SVC).toContain('savedSoFar');
    expect(SVC).toContain('targetDate');
  });
  it('gatherReflectorFacts экспортирован (для переиспользования коучем)', () => {
    expect(SVC).toMatch(/export\s+async\s+function\s+gatherReflectorFacts/);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/reflector-facts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Расширить `ReflectorFacts`** (`reflector-core.ts`)

В интерфейс `ReflectorFacts` (после поля `goalVerdicts: GoalVerdict[];`) добавить:

```ts
  goalVerdicts: GoalVerdict[];
  /** Σ(Income) − Σ(Expense) с начала года — фактически «накоплено». */
  savedSoFar: number;
  /** Срок фин-цели (адаптер: targetDate или 31 дек). */
  targetDate: Date;
  /** Флаг коуча: true → новый pacing-блок; false → старый «30 лет». */
  pacingEnabled: boolean;
  /** Текущее время (для расчёта monthsLeft в чистом ядре). */
  now: Date;
}
```

- [ ] **Step 4: Заполнить факты + экспорт** (`reflector-service.ts`)

(а) Добавить импорт флага вверху файла:
```ts
import { isV2SavingsCoachEnabled } from '../lib/feature-flags.js';
```

(б) Сделать `gatherReflectorFacts` экспортируемой — заменить
```ts
async function gatherReflectorFacts(
```
на
```ts
export async function gatherReflectorFacts(
```

(в) Добавить два агрегата с начала года. В блоке `Promise.all([...])` (после `expAgg`) добавить элементы И их деструктуризацию. Заменить заголовок:
```ts
  const [incAgg, expAgg, goals, planWeeks] = await Promise.all([
```
на
```ts
  const yearStart = new Date(year, 0, 1);
  const [incAgg, expAgg, incYtd, expYtd, goals, planWeeks] = await Promise.all([
```
и в массив `Promise.all` ПОСЛЕ блока `expAgg` (после его закрывающей `}),`) вставить:
```ts
    prisma.income.aggregate({
      where: { userId, date: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: yearStart } },
      _sum: { amount: true },
    }),
```

(г) После строки `const monthlyBurn = (expAgg._sum.amount ?? 0) / WINDOW_MONTHS;` добавить:
```ts
  const savedSoFar = (incYtd._sum.amount ?? 0) - (expYtd._sum.amount ?? 0);
```

(д) В `return {...}` (после `financeGoalText: finGoal?.goalText ?? null,`) добавить:
```ts
    goalVerdicts,
    savedSoFar,
    targetDate: finGoal?.targetDate ?? new Date(year, 11, 31),
    pacingEnabled: isV2SavingsCoachEnabled(userId),
    now,
  };
```
(заменить существующий хвост `goalVerdicts,\n  };` на блок выше — `goalVerdicts` теперь не последний).

(е) В `select` для `goals` (внутри `prisma.yearlyGoal.findMany`) добавить `targetDate: true,` (после `target: true,`), чтобы `finGoal.targetDate` существовал:
```ts
        target: true,
        targetDate: true,
        updatedAt: true,
```

- [ ] **Step 5: Run → pass + tsc + рефлектор-сервис тесты не сломаны**

Run: `npx vitest run src/services/reflector-facts.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0. (Если есть `reflector-service.test.ts` — прогнать его тоже: `npx vitest run src/services/reflector`.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/reflector-core.ts packages/server/src/services/reflector-service.ts packages/server/src/services/reflector-facts.test.ts
git commit -F - <<'EOF'
feat(coach): рефлектор-факты несут savedSoFar/targetDate/pacingEnabled/now

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: `reflect()` — pacing-ветка за флагом

**Files:**
- Modify: `packages/server/src/services/reflector-core.ts` (блок 2 «горизонт фин-цели», ~стр. 72-117)
- Test: `packages/server/src/services/reflector-pacing.test.ts` (Create, unit)

- [ ] **Step 1: Failing test**

Создать `packages/server/src/services/reflector-pacing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reflect, type ReflectorFacts } from './reflector-core.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const base: ReflectorFacts = {
  monthlyIncome: 500_000,
  monthlyBurn: 300_000,           // pace 200k/мес
  financeGoalTarget: 3_000_000,
  financeGoalText: 'накопить 3 млн',
  goalVerdicts: [],
  savedSoFar: 0,
  targetDate: new Date('2026-12-31T00:00:00Z'),
  pacingEnabled: true,
  now: NOW,
};

describe('reflect — pacing-ветка', () => {
  it('behind → инсайт scope finance:goal_pace с requiredMonthly', () => {
    const out = reflect(base);
    const pace = out.find((c) => c.scope === 'finance:goal_pace');
    expect(pace).toBeDefined();
    expect(pace!.kind).toBe('goal_pace_behind');
    expect(pace!.message).toMatch(/откладыва/i);
  });
  it('on_track (быстрый темп) → молчит про горизонт', () => {
    const out = reflect({ ...base, monthlyBurn: 100_000, financeGoalTarget: 1_000_000 }); // pace 400k × 7 ≈ 2.8M > 1M
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
  it('pacingEnabled=false → старый блок (нет scope finance:goal_pace)', () => {
    const out = reflect({ ...base, pacingEnabled: false });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/reflector-pacing.test.ts`
Expected: FAIL (нет scope `finance:goal_pace`).

- [ ] **Step 3: Реализация** (`reflector-core.ts`)

(а) Импорт вверху:
```ts
import { computeSavingsPace } from './savings-pace.js';
```

(б) Заменить ВЕСЬ блок 2 «Горизонт фин-цели…» (от комментария `// 2. Горизонт фин-цели...` до закрывающей `}` этого `if`-блока, ~стр. 72-117) на:

```ts
  // 2. Горизонт фин-цели. pacingEnabled (флаг коуча) → новый расчёт по
  //    сроку (savings-pace); off → старый блок «≥30 лет» (байт-в-байт).
  if (
    f.financeGoalTarget !== null &&
    f.financeGoalTarget > 0 &&
    f.monthlyIncome > 0
  ) {
    if (f.pacingEnabled) {
      const pace = computeSavingsPace({
        target: f.financeGoalTarget,
        targetDate: f.targetDate,
        savedSoFar: f.savedSoFar,
        monthlyPace: monthlySavings,
        now: f.now,
      });
      if (pace.status === 'stalled') {
        out.push({
          kind: 'goal_pace_stalled',
          scope: 'finance:goal_pace',
          severity: 7,
          message:
            `Цель «${f.financeGoalText ?? 'финансовая'}» (${Math.round(
              f.financeGoalTarget,
            )}₸): при нулевых/отрицательных сбережениях она НЕ приближается. ` +
            `Сначала вывести денежный поток в плюс.`,
          rationale: `pace stalled savings<=0`,
          source: 'reflector',
          dismissKey: 'reflector_goal_pace_stalled',
        });
      } else if (pace.status === 'behind') {
        out.push({
          kind: 'goal_pace_behind',
          scope: 'finance:goal_pace',
          severity: 6,
          message:
            `Цель «${f.financeGoalText ?? 'финансовая'}» (${Math.round(
              f.financeGoalTarget,
            )}₸): при темпе ~${Math.round(monthlySavings)}₸/мес к сроку будет ` +
            `~${Math.round(pace.projected)}₸ — не хватит ${Math.round(
              pace.shortfall,
            )}₸. Надо откладывать ~${Math.round(pace.requiredMonthly)}₸/мес.`,
          rationale: `behind paceGap=${Math.round(pace.paceGap)}`,
          source: 'reflector',
          dismissKey: 'reflector_goal_pace_behind',
        });
      }
      // on_track / ahead / reached → молчим (хорошие новости не пушим)
    } else {
      // СТАРЫЙ блок «≥30 лет» — без изменений (flag off = байт-в-байт).
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
  }
```

(Модульные константы `YEAR_MONTHS=12` и `UNREACHABLE_YEARS=30` остаются использованными в `else`-ветке выше — `noUnusedLocals` доволен.)

- [ ] **Step 4: Run → pass + tsc + полный прогон рефлектора**

Run: `npx vitest run src/services/reflector-pacing.test.ts src/services/reflector-core.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0. Если `reflector-core.test.ts` проверял старый горизонт — убедиться, что он гоняет с `pacingEnabled:false` (старое поведение цело); при необходимости обновить его факты добавив новые поля.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/reflector-core.ts packages/server/src/services/reflector-pacing.test.ts
git commit -F - <<'EOF'
feat(coach): reflect() pacing-ветка по сроку за флагом (off=старый блок)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: Реактивный хук `maybeSavingsCoachLine`

**Files:**
- Modify: `packages/server/src/services/savings-coach.ts` (добавить хук к pure-гейту)
- Test: `packages/server/src/services/savings-coach-hook.test.ts` (Create, структурный)

- [ ] **Step 1: Failing structural test**

Создать `packages/server/src/services/savings-coach-hook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/savings-coach.ts'), 'utf-8');

describe('maybeSavingsCoachLine — проводка хука', () => {
  it('гейтнут флагом и не роняет расход (try/catch→null)', () => {
    expect(SRC).toContain('export async function maybeSavingsCoachLine');
    expect(SRC).toContain('isV2SavingsCoachEnabled');
    expect(SRC).toMatch(/catch[\s\S]{0,80}return null/);
  });
  it('переиспользует gatherReflectorFacts + computeSavingsPace + shouldNudgeOnExpense', () => {
    expect(SRC).toContain('gatherReflectorFacts');
    expect(SRC).toContain('computeSavingsPace');
    expect(SRC).toContain('shouldNudgeOnExpense');
  });
  it('дневной дедуп по scopeKey finance:goal_pace', () => {
    expect(SRC).toContain("'finance:goal_pace'");
    expect(SRC).toContain('localDayStartUTC');
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/savings-coach-hook.test.ts`
Expected: FAIL — функция не реализована.

- [ ] **Step 3: Реализация хука** — дописать в `packages/server/src/services/savings-coach.ts`

Добавить импорты вверху файла:
```ts
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { isV2SavingsCoachEnabled } from '../lib/feature-flags.js';
import { gatherReflectorFacts } from './reflector-service.js';
import { computeSavingsPace } from './savings-pace.js';
```

В конец файла добавить:
```ts
const GOAL_PACE_SCOPE = 'finance:goal_pace';

/**
 * Реактивный коуч после расхода. Точка схождения (текст/голос/фото).
 * Best-effort: любая ошибка → null, расход НИКОГДА не ломается и ответ
 * не задерживается. Возвращает короткую строку для дописывания к ответу
 * бота, либо null (нет цели / гейт не прошёл / флаг off / дедуп).
 */
export async function maybeSavingsCoachLine(
  userId: string,
  expenseAmount: number,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2SavingsCoachEnabled(userId)) return null;
  try {
    const facts = await gatherReflectorFacts(userId, now);
    if (facts.financeGoalTarget === null || facts.financeGoalTarget <= 0) {
      return null; // нет числовой фин-цели → молчим
    }
    const pace = computeSavingsPace({
      target: facts.financeGoalTarget,
      targetDate: facts.targetDate,
      savedSoFar: facts.savedSoFar,
      monthlyPace: facts.monthlyIncome - facts.monthlyBurn,
      now,
    });

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
      status: pace.status,
      monthToDateExpense: mtdExp._sum.amount ?? 0,
      monthlyIncome: facts.monthlyIncome,
      requiredMonthly: pace.requiredMonthly,
      expenseAmount,
      alreadyCoachedToday: coachedToday > 0,
    });
    if (!nudge) return null;

    const line =
      `Кстати — это уже выводит месяц за темп к цели «${facts.financeGoalText ?? 'накопить'}». ` +
      `Чтобы успеть, надо откладывать ~${Math.round(pace.requiredMonthly)}₸/мес — ` +
      `дальше лучше попридержать.`;

    // Маркер дневного дедупа: сразу deliveredAt=now → не будет ещё и
    // запушен deliverTopInsight, и следующий реактив/дневной за сутки молчит.
    await prisma.insight
      .create({
        data: {
          userId,
          severity: 6,
          scope: { key: GOAL_PACE_SCOPE, kind: 'goal_pace_reactive' },
          scopeKey: GOAL_PACE_SCOPE,
          source: 'savings_coach',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});

    return line;
  } catch (err) {
    console.warn(
      '[savings-coach] non-fatal:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

⚠️ Поле `scopeKey` есть в модели `Insight` (его пишет `persistCandidates`). Если у `Insight.create` tsc ругается на обязательные поля — свериться со схемой (`scope` Json обязателен, `severity` Int обязателен, `message` String обязателен — все заданы).

- [ ] **Step 4: Run → pass + tsc + гейт-тесты целы**

Run: `npx vitest run src/services/savings-coach.test.ts src/services/savings-coach-hook.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/savings-coach.ts packages/server/src/services/savings-coach-hook.test.ts
git commit -F - <<'EOF'
feat(coach): maybeSavingsCoachLine — реактивный хук (best-effort, дедуп)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Проводка хука в оркестратор (2 точки схождения)

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts` (`runConfirmedAction` ~стр. 361; EXECUTABLE-ветка ~стр. 807)
- Test: `packages/server/src/services/savings-coach-wiring.test.ts` (Create, структурный)

- [ ] **Step 1: Failing structural test**

Создать `packages/server/src/services/savings-coach-wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('savings-coach проводка в оркестратор', () => {
  it('импортирует хук', () => {
    expect(SRC).toContain("import { maybeSavingsCoachLine }");
  });
  it('зовётся в ОБЕИХ точках исполнения add_expense', () => {
    const calls = SRC.match(/maybeSavingsCoachLine\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
  it('только для add_expense', () => {
    expect(SRC).toContain("=== 'add_expense'");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/savings-coach-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

(а) Импорт (рядом с другими импортами сервисов вверху файла):
```ts
import { maybeSavingsCoachLine } from './savings-coach.js';
```

(б) В `runConfirmedAction` — после строки `const message = out.message ?? 'Готово.';` (~стр. 364) и ДО `console.log(...)` вставить:
```ts
    let message = out.message ?? 'Готово.';
    if (action === 'add_expense') {
      const coach = await maybeSavingsCoachLine(
        userId,
        Number((input as { amount?: unknown }).amount) || 0,
      );
      if (coach) message += `\n\n${coach}`;
    }
```
(заменив исходную строку `const message = out.message ?? 'Готово.';` на блок выше — `const`→`let`).

(в) В EXECUTABLE-ветке — после строки `const replyText = out.message ?? 'Готово.';` (~стр. 812) вставить:
```ts
      let replyText = out.message ?? 'Готово.';
      if (intent.action === 'add_expense') {
        const coach = await maybeSavingsCoachLine(
          userId,
          Number((input as { amount?: unknown }).amount) || 0,
        );
        if (coach) replyText += `\n\n${coach}`;
      }
```
(заменив исходную `const replyText = out.message ?? 'Готово.';` на блок выше — `const`→`let`).

- [ ] **Step 4: Run → pass + tsc**

Run: `npx vitest run src/services/savings-coach-wiring.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/savings-coach-wiring.test.ts
git commit -F - <<'EOF'
feat(coach): хук коуча после add_expense в 2 точках схождения (текст/голос/фото)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: Запись `targetDate` при разборе цели

**Files:**
- Modify: `packages/server/src/services/planner-service.ts` (импорт + update-патч ~стр. 587-597)
- Test: `packages/server/src/services/planner-deadline.test.ts` (Create, структурный)

- [ ] **Step 1: Failing structural test**

Создать `packages/server/src/services/planner-deadline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/planner-service.ts'), 'utf-8');

describe('planner пишет targetDate из текста цели', () => {
  it('импортирует parseGoalDeadline', () => {
    expect(SRC).toContain("import { parseGoalDeadline }");
  });
  it('кладёт targetDate в yearlyGoal.update патч', () => {
    expect(SRC).toMatch(/targetDate:\s*parseGoalDeadline/);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/services/planner-deadline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

(а) Импорт вверху `planner-service.ts`:
```ts
import { parseGoalDeadline } from './goal-deadline.js';
```

(б) В `tx.yearlyGoal.update({ ... data: { target: rows.yearlyPatch.target, ... } })` (~стр. 589-596) добавить поле `targetDate` в `data`. Заменить:
```ts
        data: {
          target: rows.yearlyPatch.target,
          pacingMode: rows.yearlyPatch.pacingMode,
```
на
```ts
        data: {
          target: rows.yearlyPatch.target,
          // null → undefined: не затираем уже стоящий срок, если в тексте даты нет
          targetDate: parseGoalDeadline(g, todayUTC) ?? undefined,
          pacingMode: rows.yearlyPatch.pacingMode,
```
(`g` — текст цели, `todayUTC` — уже в области видимости функции, см. стр. 442/465).

- [ ] **Step 4: Run → pass + tsc**

Run: `npx vitest run src/services/planner-deadline.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/planner-service.ts packages/server/src/services/planner-deadline.test.ts
git commit -F - <<'EOF'
feat(coach): planner пишет YearlyGoal.targetDate из текста цели

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 11: Финальная проверка

**Files:** нет (только прогон)

- [ ] **Step 1: Полная сюита**

Run: `npx vitest run`
Expected: всё зелёное (база ~2010 + новые ~30). Ноль падений.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: 0 ошибок.

- [ ] **Step 3: lint-дисциплина Anthropic (новых сырых клиентов нет)**

Run: `npx vitest run src/services/anthropic-discipline.test.ts`
Expected: PASS (в фиче новых AI-вызовов нет).

- [ ] **Step 4: Сводка для Berik**

Подготовить краткий отчёт: что в коммитах, флаг `FEATURE_V2_SAVINGS_COACH` (off=байт-в-байт), миграция `targetDate` (на прод через `migrate deploy`), SMOKE-план. НЕ пушить/деплоить/флажить без явного слова Berik.

---

## Self-Review (заполняется автором плана)

**1. Покрытие спеки:**
- §4 модель данных → Task 1 (targetDate) ✓; savedSoFar derived → Task 6 ✓.
- §5 чистое ядро → Task 3 ✓ (все статусы + границы).
- §6 проактив → Task 6 (факты) + Task 7 (reflect ветка, behind/stalled, on_track молчит, cashflow_negative цел) ✓.
- §7a реактив → Task 4 (гейт) + Task 8 (хук, дедуп, best-effort) + Task 9 (2 точки, только add_expense) ✓.
- §7c срок → Task 5 (парсер) + Task 10 (запись) ✓.
- §9 флаг → Task 2 + ветвление в Task 7/8 ✓.
- §10 тесты → pure unit (3,4,5) + структурные (6,7,8,9,10) ✓.

**2. Плейсхолдеры:** нет TBD/«добавь обработку». Код полный в каждом шаге.

**3. Согласованность типов:** `SavingsPaceFacts`/`SavingsPace`/`SavingsStatus` (Task 3) используются в Task 4 (`SavingsStatus`), Task 7 (`computeSavingsPace`), Task 8 (`computeSavingsPace`+`shouldNudgeOnExpense`). `ReflectorFacts` +4 поля (Task 6) ровно те, что читает `reflect()` (Task 7) и `gatherReflectorFacts` отдаёт (Task 6). `maybeSavingsCoachLine(userId, expenseAmount, now?)` (Task 8) ровно так зовётся в Task 9. `parseGoalDeadline(text, now)` (Task 5) ровно так зовётся в Task 10. `GOAL_PACE_SCOPE='finance:goal_pace'` совпадает в Task 7 (scope инсайта) и Task 8 (дедуп). Согласовано.
