# CashSnapshot → Runway «на сколько хватит» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать runway-движку точку отсчёта — текущий баланс со слов юзера — чтобы он отвечал «на сколько хватит денег» реальным числом, а не просил недостающие данные.

**Architecture:** Новая модель `CashSnapshot` (референсная точка, не денежный ledger) + write-инструмент `set_balance` (1:1 с `add_income`, `needsConfirm`). `buildRunway` при наличии последнего снапшота и включённом флаге берёт его как якорь: `cashOnHand = balance − Σрасход(date>asOf) + Σдоход(date>asOf)`; при якоре показывает число для любого статуса (healthy позитивно), без якоря — старое silent-when-healthy поведение. Флаг `FEATURE_V2_RUNWAY_BALANCE`, off = байт-идентично.

**Tech Stack:** Fastify, Prisma 6, Postgres, TypeScript strict (ESM `.js` импорты), vitest (zero vi.mock), defineTool registry.

---

## File Structure

| Файл | Ответственность | Действие |
|---|---|---|
| `prisma/schema.prisma` | модель `CashSnapshot` + relation в `User` | Modify |
| `src/lib/feature-flags.ts` | `isV2RunwayBalanceEnabled` | Modify |
| `src/lib/feature-flags.test.ts` | юнит флага | Modify |
| `src/services/runway/types.ts` | `computeAnchoredCash` + `describeRunway(hasAnchor)` | Modify |
| `src/services/runway/types.test.ts` | pure-юниты | Modify |
| `src/services/runway/runway.ts` | якорь-снапшот в `buildRunway` | Modify |
| `src/services/runway/cash-snapshot.it.test.ts` | поведенческий (тест-БД) | Create |
| `src/tools/set-balance.ts` | инструмент `set_balance` | Create |
| `src/tools/set-balance.test.ts` | money-safety + структурный | Create |
| `src/tools/index.ts` | регистрация `setBalanceTool` | Modify |

**Money-safety:** `runway.ts` остаётся READ-ONLY (структурный guard). `set_balance` пишет `CashSnapshot` только за `needsConfirm` (явное «да»).

---

## Task 1: Prisma модель CashSnapshot + ручная миграция

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Добавить модель + relation**

В `schema.prisma` добавить relation-поле в модель `User` (рядом с другими `[]`-relations, напр. после `incomes Income[]`):

```prisma
  cashSnapshots  CashSnapshot[]
```

И новую модель (рядом с `Income`):

```prisma
model CashSnapshot {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  balance   Float
  asOf      DateTime @db.Date
  createdAt DateTime @default(now())

  @@index([userId, asOf])
}
```

- [ ] **Step 2: Применить руками к ПРОД-БД (`.env` = прод, НЕ `migrate dev`)**

Run:
```bash
cd packages/server && npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
CREATE TABLE IF NOT EXISTS "CashSnapshot" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "balance"   DOUBLE PRECISION NOT NULL,
  "asOf"      DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CashSnapshot_userId_asOf_idx" ON "CashSnapshot" ("userId", "asOf");
DO $$ BEGIN
  ALTER TABLE "CashSnapshot" ADD CONSTRAINT "CashSnapshot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL
```
Expected: `Script executed successfully.`

- [ ] **Step 3: Перегенерировать клиент**

Run: `cd packages/server && npx prisma generate`
Expected: `Generated Prisma Client` (теперь `prisma.cashSnapshot` доступен в типах).

- [ ] **Step 4: tsc + commit**

Run: `cd packages/server && npx tsc --noEmit`
Expected: без ошибок.

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/prisma/schema.prisma
git commit -F - <<'EOF'
feat(schema): CashSnapshot model — точка отсчёта баланса для runway

Референсная точка (balance, asOf), НЕ денежный ledger. Миграция руками
(.env=прод): CREATE TABLE IF NOT EXISTS + index + FK + prisma generate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Флаг isV2RunwayBalanceEnabled

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Test: `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Написать падающий тест**

В `feature-flags.test.ts` добавить импорт `isV2RunwayBalanceEnabled` в существующий импорт-блок из `'./feature-flags.js'`, затем новый describe:

```ts
describe('isV2RunwayBalanceEnabled', () => {
  const KEY = 'FEATURE_V2_RUNWAY_BALANCE';
  afterEach(() => { delete process.env[KEY]; });
  it('false when unset', () => {
    delete process.env[KEY];
    expect(isV2RunwayBalanceEnabled('user-abc')).toBe(false);
  });
  it('false for none/false/empty', () => {
    for (const v of ['none', 'false', '']) {
      process.env[KEY] = v;
      expect(isV2RunwayBalanceEnabled('user-abc')).toBe(false);
    }
  });
  it('true for all/true', () => {
    process.env[KEY] = 'all';
    expect(isV2RunwayBalanceEnabled('anybody')).toBe(true);
    process.env[KEY] = 'true';
    expect(isV2RunwayBalanceEnabled('anybody')).toBe(true);
  });
  it('matches user-<id> allowlist', () => {
    process.env[KEY] = 'user-abc,user-def';
    expect(isV2RunwayBalanceEnabled('abc')).toBe(true);
    expect(isV2RunwayBalanceEnabled('zzz')).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — RED**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t "isV2RunwayBalanceEnabled"`
Expected: FAIL — `isV2RunwayBalanceEnabled is not a function` / import error.

- [ ] **Step 3: Реализовать флаг**

В `feature-flags.ts` добавить (копия `isV2AxesEnabled`, env `FEATURE_V2_RUNWAY_BALANCE`):

```ts
/**
 * Runway-баланс: якорь cashOnHand из CashSnapshot + инструмент set_balance.
 * Same shape as isV2AxesEnabled.
 */
export function isV2RunwayBalanceEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RUNWAY_BALANCE;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Запустить — GREEN + tsc**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t "isV2RunwayBalanceEnabled" && npx tsc --noEmit`
Expected: PASS, tsc чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(flags): isV2RunwayBalanceEnabled (FEATURE_V2_RUNWAY_BALANCE)

Гейтит якорь-снапшот в runway + инструмент set_balance. Форма
all|true|none|false|user-X (копия isV2AxesEnabled). off=байт-идентично.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Чистые хелперы — computeAnchoredCash + describeRunway(hasAnchor)

**Files:**
- Modify: `packages/server/src/services/runway/types.ts`
- Test: `packages/server/src/services/runway/types.test.ts`

- [ ] **Step 1: Написать падающие тесты**

В `types.test.ts` добавить импорт `computeAnchoredCash` к существующему импорту из `'./types.js'`, затем:

```ts
describe('computeAnchoredCash', () => {
  it('balance − expensesSince + incomesSince', () => {
    expect(
      computeAnchoredCash({ balance: 500_000, expensesSince: 120_000, incomesSince: 0 }),
    ).toBe(380_000);
  });
  it('no expenses → balance unchanged', () => {
    expect(
      computeAnchoredCash({ balance: 500_000, expensesSince: 0, incomesSince: 0 }),
    ).toBe(500_000);
  });
  it('income since snapshot extends cash', () => {
    expect(
      computeAnchoredCash({ balance: 100_000, expensesSince: 30_000, incomesSince: 350_000 }),
    ).toBe(420_000);
  });
  it('expenses exceed balance → negative (underwater)', () => {
    expect(
      computeAnchoredCash({ balance: 50_000, expensesSince: 90_000, incomesSince: 0 }),
    ).toBe(-40_000);
  });
});

describe('describeRunway — hasAnchor', () => {
  it('healthy + hasAnchor → positive non-null string', () => {
    const r = { netBurnRate: 50_000, runwayMonths: 6, status: 'healthy' as const };
    const s = describeRunway(r, 300_000, { hasAnchor: true, monthlyIncome: 200_000 });
    expect(s).toBeTruthy();
    expect(s).toMatch(/6 мес/);
  });
  it('healthy WITHOUT anchor → null (silent-when-healthy preserved)', () => {
    const r = { netBurnRate: 50_000, runwayMonths: 6, status: 'healthy' as const };
    expect(describeRunway(r, 300_000)).toBeNull();
  });
  it('cash_positive + hasAnchor → positive string (no months)', () => {
    const r = { netBurnRate: -10_000, runwayMonths: null, status: 'cash_positive' as const };
    const s = describeRunway(r, 300_000, { hasAnchor: true, monthlyIncome: 400_000 });
    expect(s).toBeTruthy();
  });
  it('income tail appended when monthlyIncome<=0 and hasAnchor', () => {
    const r = { netBurnRate: 80_000, runwayMonths: 2, status: 'short' as const };
    const s = describeRunway(r, 160_000, { hasAnchor: true, monthlyIncome: 0 });
    expect(s).toMatch(/записывай зарплату/);
  });
  it('no income tail when income known', () => {
    const r = { netBurnRate: 80_000, runwayMonths: 2, status: 'short' as const };
    const s = describeRunway(r, 160_000, { hasAnchor: true, monthlyIncome: 200_000 });
    expect(s).not.toMatch(/записывай зарплату/);
  });
});
```

- [ ] **Step 2: Запустить — RED**

Run: `cd packages/server && npx vitest run src/services/runway/types.test.ts`
Expected: FAIL — `computeAnchoredCash is not a function` + describeRunway arity.

- [ ] **Step 3: Реализовать**

В `types.ts` добавить хелпер (после `describeRunway` или перед — порядок свободный):

```ts
/** Якорный кэш: баланс со слов юзера минус траты после снапшота плюс доходы после. */
export function computeAnchoredCash(input: {
  balance: number;
  expensesSince: number;
  incomesSince: number;
}): number {
  return input.balance - input.expensesSince + input.incomesSince;
}
```

Заменить `describeRunway` целиком на версию с `opts`:

```ts
/**
 * Человеческая строка. Без якоря — null для healthy/cash_positive/no_data
 * (молчим, проактивный «ноет когда мало»). С якорем (юзер сам назвал баланс)
 * — число для любого статуса кроме no_data; healthy/cash_positive позитивно.
 */
export function describeRunway(
  r: RunwayResult,
  cashOnHand: number,
  opts: { hasAnchor?: boolean; monthlyIncome?: number } = {},
): string | null {
  const round = (n: number) => Math.round(n);
  const tail =
    opts.hasAnchor && (opts.monthlyIncome ?? 0) <= 0
      ? ' — считаю без учёта дохода, записывай зарплату → посчитаю точнее'
      : '';
  if (r.status === 'no_data') return null;
  if (r.status === 'underwater') {
    return (
      '💸 По записям расходы давно обгоняют доходы (накоплен минус). Стоит сократить траты.' +
      tail
    );
  }
  if (r.status === 'critical' || r.status === 'short') {
    const months = r.runwayMonths == null ? 0 : Math.round(r.runwayMonths * 10) / 10;
    return (
      `💸 По записям у тебя ~${round(cashOnHand)}₸, чистый расход ~${round(r.netBurnRate)}₸/мес → ` +
      `денег хватит на ~${months} мес.` +
      tail
    );
  }
  // healthy / cash_positive — молчим, ЕСЛИ нет якоря-снапшота.
  if (!opts.hasAnchor) return null;
  if (r.status === 'cash_positive') {
    return (
      `✅ По записям расходы не превышают доход — баланс ~${round(cashOnHand)}₸ держится, хватит надолго.` +
      tail
    );
  }
  // healthy
  const months = r.runwayMonths == null ? 0 : Math.round(r.runwayMonths * 10) / 10;
  return (
    `✅ По записям у тебя ~${round(cashOnHand)}₸, при текущем темпе хватит на ~${months} мес — спокойно.` +
    tail
  );
}
```

- [ ] **Step 4: Запустить — GREEN + tsc**

Run: `cd packages/server && npx vitest run src/services/runway/types.test.ts && npx tsc --noEmit`
Expected: PASS (вкл. старые describeRunway-тесты — сигнатура backward-compatible), tsc чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/runway/types.ts packages/server/src/services/runway/types.test.ts
git commit -F - <<'EOF'
feat(runway): computeAnchoredCash + describeRunway hasAnchor/income-tail

Чистые хелперы. describeRunway получил opts{hasAnchor,monthlyIncome}:
с якорем показывает число для любого статуса (healthy позитивно),
без якоря — старое silent-when-healthy. Хвост-стимул при доходе<=0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: buildRunway — якорь-снапшот

**Files:**
- Modify: `packages/server/src/services/runway/runway.ts`
- Test: `packages/server/src/services/runway/runway.test.ts` (структурный no-write guard — если файла нет, создать)

- [ ] **Step 1: Написать падающий структурный тест**

Создать/дополнить `packages/server/src/services/runway/runway.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'runway.ts'), 'utf8');

describe('runway.ts — anchor integration (structural)', () => {
  it('gates snapshot anchor behind isV2RunwayBalanceEnabled', () => {
    expect(SRC).toMatch(/isV2RunwayBalanceEnabled\(/);
  });
  it('reads latest CashSnapshot ordered by asOf desc', () => {
    expect(SRC).toMatch(/cashSnapshot\.findFirst/);
    expect(SRC).toMatch(/asOf:\s*'desc'/);
  });
  it('sums expenses/incomes strictly after asOf (date gt)', () => {
    expect(SRC).toMatch(/date:\s*\{\s*gt:/);
  });
  it('uses computeAnchoredCash', () => {
    expect(SRC).toMatch(/computeAnchoredCash\(/);
  });
  it('READ-ONLY — no prisma writes', () => {
    expect(SRC).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
    expect(SRC).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
  });
});
```

- [ ] **Step 2: Запустить — RED**

Run: `cd packages/server && npx vitest run src/services/runway/runway.test.ts`
Expected: FAIL — нет `isV2RunwayBalanceEnabled`/`cashSnapshot.findFirst`/`computeAnchoredCash` в исходнике.

- [ ] **Step 3: Реализовать якорь в buildRunway**

В `runway.ts` обновить импорты:

```ts
import { computeRunway, describeRunway, computeAnchoredCash, type RunwayStatus } from './types.js';
import { isV2RunwayBalanceEnabled } from '../../lib/feature-flags.js';
```

Заменить тело `try` в `buildRunway` (после получения `facts`/`incAgg`/`expAgg`) на:

```ts
    let cashOnHand = (incAgg._sum.amount ?? 0) - (expAgg._sum.amount ?? 0);
    let hasAnchor = false;
    // Якорь: если юзер назвал баланс (CashSnapshot) — считаем вперёд от него.
    if (isV2RunwayBalanceEnabled(userId)) {
      const snap = await prisma.cashSnapshot.findFirst({
        where: { userId },
        orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
      });
      if (snap) {
        const [expSince, incSince] = await Promise.all([
          prisma.expense.aggregate({
            _sum: { amount: true },
            where: { userId, date: { gt: snap.asOf } },
          }),
          prisma.income.aggregate({
            _sum: { amount: true },
            where: { userId, date: { gt: snap.asOf } },
          }),
        ]);
        cashOnHand = computeAnchoredCash({
          balance: snap.balance,
          expensesSince: expSince._sum.amount ?? 0,
          incomesSince: incSince._sum.amount ?? 0,
        });
        hasAnchor = true;
      }
    }
    const r = computeRunway({
      cashOnHand,
      monthlyIncome: facts.monthlyIncome,
      monthlyBurn: facts.monthlyBurn,
    });
    // Без якоря — старое поведение: молчим при здоровом/положительном/no_data.
    if (
      !hasAnchor &&
      (r.status === 'healthy' || r.status === 'cash_positive' || r.status === 'no_data')
    ) {
      return null;
    }
    // С якорём — нечего проецировать только если вообще нет темпа трат.
    if (hasAnchor && r.status === 'no_data') return null;
    const insightText = describeRunway(r, cashOnHand, {
      hasAnchor,
      monthlyIncome: facts.monthlyIncome,
    });
    if (!insightText) return null;

    return {
      cashOnHand,
      monthlyIncome: facts.monthlyIncome,
      monthlyBurn: facts.monthlyBurn,
      netBurnRate: r.netBurnRate,
      runwayMonths: r.runwayMonths,
      status: r.status,
      insightText,
    };
```

Удалить старую строку `const cashOnHand = ...` и старый блок-комментарий «ВНИМАНИЕ (осознанно)» (заменён новой логикой; горизонт-комментарий больше не точен).

- [ ] **Step 4: Запустить — GREEN + tsc**

Run: `cd packages/server && npx vitest run src/services/runway/runway.test.ts && npx tsc --noEmit`
Expected: PASS, tsc чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/runway/runway.ts packages/server/src/services/runway/runway.test.ts
git commit -F - <<'EOF'
feat(runway): anchor cashOnHand to latest CashSnapshot (flag-gated)

При isV2RunwayBalanceEnabled + есть снапшот → cashOnHand = balance −
Σрасход(date>asOf) + Σдоход(date>asOf), hasAnchor=true (число для любого
статуса). Иначе — старый all-time net (silent-when-healthy). READ-ONLY.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Поведенческий тест (тест-БД)

**Files:**
- Create: `packages/server/src/services/runway/cash-snapshot.it.test.ts`

**Важно:** `buildRunway` по умолчанию использует РЕАЛЬНОЕ `now` сервера для reflector-фактов, но `asOf`-фильтр сравнивает с датами Expense/Income, которые мы сидим сами. Сидим `asOf` и даты относительно фиксированных значений, не зависящих от «сейчас» (фильтр `date > asOf` чисто календарный). Флаг включаем в тесте через `process.env`.

- [ ] **Step 1: Написать поведенческий тест**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { buildRunway } from './runway.js';

const KEY = 'FEATURE_V2_RUNWAY_BALANCE';

async function mkUser(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email, name: 'T', passwordHash: 'x' },
  });
  return u.id;
}

describe('buildRunway — CashSnapshot anchor (integration)', () => {
  beforeEach(() => { process.env[KEY] = 'all'; });
  afterEach(async () => {
    delete process.env[KEY];
    await prisma.cashSnapshot.deleteMany({});
    await prisma.expense.deleteMany({});
    await prisma.income.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: '@cash-it' } } });
  });

  it('anchors cashOnHand to balance minus expenses after asOf', async () => {
    const userId = await mkUser('a@cash-it');
    const asOf = new Date('2026-05-01');
    await prisma.cashSnapshot.create({ data: { userId, balance: 500_000, asOf } });
    // расход ПОСЛЕ asOf — вычитается
    await prisma.expense.create({
      data: { userId, date: new Date('2026-05-10'), category: 'food', description: '', amount: 120_000 },
    });
    // расход В день asOf — НЕ вычитается (уже в балансе)
    await prisma.expense.create({
      data: { userId, date: asOf, category: 'food', description: '', amount: 99_000 },
    });
    const rw = await buildRunway(userId);
    expect(rw).not.toBeNull();
    // cashOnHand = 500000 − 120000 = 380000 (99000 в день asOf не в счёт)
    expect(rw!.cashOnHand).toBe(380_000);
  });

  it('income after asOf extends cash', async () => {
    const userId = await mkUser('b@cash-it');
    const asOf = new Date('2026-05-01');
    await prisma.cashSnapshot.create({ data: { userId, balance: 100_000, asOf } });
    await prisma.income.create({
      data: { userId, date: new Date('2026-05-15'), source: 'зп', amount: 350_000 },
    });
    await prisma.expense.create({
      data: { userId, date: new Date('2026-05-20'), category: 'food', description: '', amount: 50_000 },
    });
    const rw = await buildRunway(userId);
    expect(rw!.cashOnHand).toBe(400_000); // 100000 + 350000 − 50000
  });

  it('no snapshot → falls back to all-time net (no anchor)', async () => {
    const userId = await mkUser('c@cash-it');
    await prisma.income.create({
      data: { userId, date: new Date('2026-05-01'), source: 'зп', amount: 100_000 },
    });
    await prisma.expense.create({
      data: { userId, date: new Date('2026-05-02'), category: 'food', description: '', amount: 300_000 },
    });
    // net = 100000 − 300000 = −200000, burn>income → underwater, без якоря тоже не молчит
    const rw = await buildRunway(userId);
    expect(rw).not.toBeNull();
    expect(rw!.cashOnHand).toBe(-200_000);
  });

  it('cross-user isolation: A does not see B snapshot', async () => {
    const a = await mkUser('d@cash-it');
    const b = await mkUser('e@cash-it');
    await prisma.cashSnapshot.create({
      data: { userId: b, balance: 999_000, asOf: new Date('2026-05-01') },
    });
    await prisma.expense.create({
      data: { userId: a, date: new Date('2026-05-02'), category: 'food', description: '', amount: 300_000 },
    });
    const rwA = await buildRunway(a);
    // A без снапшота → all-time net = −300000, НЕ 999000
    expect(rwA?.cashOnHand).toBe(-300_000);
  });
});
```

- [ ] **Step 2: Запустить — проверить (поднять тест-БД)**

Run: `cd packages/server && npm run test:db:up && npx vitest run --config vitest.it.config.ts src/services/runway/cash-snapshot.it.test.ts`
(если в проекте `npm run test:it` фильтрует по `*.it.test.ts` — использовать его с path-фильтром)
Expected: 4 passed. Если RED из-за неверных чисел — чинить реализацию Task 4, не тест.

- [ ] **Step 3: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/runway/cash-snapshot.it.test.ts
git commit -F - <<'EOF'
test(runway): behavioral CashSnapshot anchor (date>asOf, isolation)

Тест-БД: расход после asOf вычитается, в день asOf — нет; доход
продлевает; без снапшота — fallback; A не видит снапшот B.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Инструмент set_balance + регистрация

**Files:**
- Create: `packages/server/src/tools/set-balance.ts`
- Create: `packages/server/src/tools/set-balance.test.ts`
- Modify: `packages/server/src/tools/index.ts`

- [ ] **Step 1: Написать падающий тест (money-safety + структурный)**

`set-balance.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { setBalanceTool } from './set-balance.js';

const SRC = readFileSync(join(__dirname, 'set-balance.ts'), 'utf8');

describe('set_balance — money-safety', () => {
  it('needsConfirm + sideEffects write', () => {
    expect(setBalanceTool.name).toBe('set_balance');
    expect(setBalanceTool.needsConfirm).toBe(true);
    expect(setBalanceTool.sideEffects).toBe('write');
  });
  it('flag-gated in handler', () => {
    expect(SRC).toMatch(/isV2RunwayBalanceEnabled\(ctx\.userId\)/);
  });
  it('writes only CashSnapshot (no Income/Expense ledger)', () => {
    expect(SRC).toMatch(/cashSnapshot\.create/);
    expect(SRC).not.toMatch(/prisma\.(income|expense)\.create/);
  });
});

describe('set_balance — registry', () => {
  it('registered in tools/index.ts', () => {
    const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(idx).toMatch(/setBalanceTool/);
  });
});
```

- [ ] **Step 2: Запустить — RED**

Run: `cd packages/server && npx vitest run src/tools/set-balance.test.ts`
Expected: FAIL — модуль `./set-balance.js` не найден.

- [ ] **Step 3: Реализовать инструмент**

`set-balance.ts`:

```ts
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2RunwayBalanceEnabled } from '../lib/feature-flags.js';
import { buildRunway } from '../services/runway/runway.js';
import { defineTool } from './_types.js';

/**
 * Текущий баланс на счету со слов юзера → CashSnapshot (точка отсчёта runway).
 * ДЕНЬГИ-факт: needsConfirm:true. Не денежный ledger — на суммы трат/доходов
 * не влияет, только на якорь runway. Запись после явного «да».
 */
export const setBalanceTool = defineTool({
  name: 'set_balance',
  description:
    'Запомнить текущий баланс на счету (со слов пользователя), чтобы точно ' +
    'считать «на сколько хватит денег». Выполняется только после явного ' +
    'подтверждения («да»). Не подтверждай сам.',
  category: 'finance',
  aliases: { amount: 'balance', sum: 'balance', cash: 'balance', счёт: 'balance', на_счету: 'balance' },
  schema: z.object({
    balance: z.number().positive().max(1_000_000_000),
    asOf: z.string().optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['на счету 500000', 'у меня 350 тысяч на карте', 'баланс 1.2 млн'],
  handler: async (input, ctx) => {
    if (!isV2RunwayBalanceEnabled(ctx.userId)) return { error: 'функция отключена' };
    const tz = await getUserTimezone(ctx.userId);
    let asOf = localDayStartUTC(tz);
    if (input.asOf) {
      const d = new Date(input.asOf);
      if (!Number.isNaN(d.getTime())) asOf = d;
    }
    await prisma.cashSnapshot.create({
      data: { userId: ctx.userId, balance: input.balance, asOf },
    });
    let message = `Записал баланс ${Math.round(input.balance)} ₸.`;
    try {
      const rw = await buildRunway(ctx.userId);
      if (rw?.insightText) message += ` ${rw.insightText}`;
    } catch {
      // проекция best-effort — баланс уже сохранён
    }
    return { message };
  },
});
```

- [ ] **Step 4: Зарегистрировать в реестре**

В `tools/index.ts` добавить импорт (рядом с другими finance-инструментами):

```ts
import { setBalanceTool } from './set-balance.js';
```

И в массив `ALL_TOOLS` (рядом с `addIncomeTool`, в секции «деньги»):

```ts
  setBalanceTool,
```

- [ ] **Step 5: Запустить — GREEN + tsc**

Run: `cd packages/server && npx vitest run src/tools/set-balance.test.ts && npx tsc --noEmit`
Expected: PASS (4), tsc чисто. Дубликат-имя guard в index.ts не падает.

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/tools/set-balance.ts packages/server/src/tools/set-balance.test.ts packages/server/src/tools/index.ts
git commit -F - <<'EOF'
feat(tools): set_balance — записать баланс счёта (needsConfirm, flag-gated)

1:1 с add_income: needsConfirm, sideEffects write, TZ-aware, aliases.
Пишет CashSnapshot (не денежный ledger), сразу отдаёт runway-проекцию.
Handler-gate isV2RunwayBalanceEnabled. Зарегистрирован в ALL_TOOLS.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Финальная проверка + независимое ревью

**Files:** нет правок — только верификация.

- [ ] **Step 1: Полный прогон**

Run: `cd packages/server && npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected: tsc чисто; `Test Files … passed`, `Tests … passed` (≥ baseline 2295 + новые).

- [ ] **Step 2: Интеграционный прогон**

Run: `cd packages/server && npm run test:db:up && npm run test:it 2>&1 | tail -3`
Expected: все it зелёные (25 baseline + 4 новых).

- [ ] **Step 3: Negative-control (флаг off = байт-идентично)**

Проверить вручную: при `FEATURE_V2_RUNWAY_BALANCE` unset — `buildRunway` не вызывает `cashSnapshot.findFirst` (ветка за флагом), `set_balance.handler` возвращает `{ error: 'функция отключена' }`. Подтверждается структурными тестами Task 4/6.

- [ ] **Step 4: Независимое ревью**

Дать code-reviewer subagent весь diff фичи (git diff baseline..HEAD по затронутым файлам). Оси: READ-ONLY runway, money-safety (needsConfirm), флаг-гейт (off=identical), null-safety, реюз. Починить найденное.

- [ ] **Step 5: Rollout (по слову Berik — стандартное правило flag=all)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git push origin main
~/.npm-global/bin/railway variables --service lifeos-api --set "FEATURE_V2_RUNWAY_BALANCE=all"
```
SMOKE: боту «на счету 500000» → подтверждение «да» → «Записал баланс… хватит на ~N мес». Затем «на сколько мне хватит денег» → число.

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:** S1 модель+флаг → Task 1+2 ✓. S2 runway (computeAnchoredCash, hasAnchor, date>asOf, healthy-нюанс) → Task 3+4 ✓. S3 set_balance + income-tail → Task 3 (tail) + Task 6 (tool) ✓. S4 тесты (pure/поведенческий/структурный/money-safety) → Task 3/5/4/6 ✓. Money-safety раздел → Task 4 guard + Task 6 needsConfirm ✓.

**2. Placeholder scan:** нет TBD/«handle edge cases» — весь код приведён.

**3. Type consistency:** `computeAnchoredCash({balance,expensesSince,incomesSince})` — одно имя везде (Task 3 def, Task 4 use). `describeRunway(r, cashOnHand, {hasAnchor,monthlyIncome})` — единая сигнатура (Task 3 def, Task 4 use). `setBalanceTool` / `set_balance` — консистентно. Флаг `isV2RunwayBalanceEnabled` — одно имя везде.

**Замечание по регистрации:** инструменты в этом репо регистрируются в `ALL_TOOLS` безусловно, флаг-гейт — в хендлере (как obligations). Поэтому `set_balance` всегда в реестре, но `handler` возвращает `{error}` при выключенном флаге — это и есть off-поведение (агент видит инструмент, но он отказывает). Полная байт-идентичность достигается на уровне эффекта (ничего не пишется/не считается), не на уровне списка инструментов — это принятый в репо компромисс.
