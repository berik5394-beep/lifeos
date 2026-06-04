# Решения ↔ Исходы (Decision↔Outcome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Журнал решений + ретро: юзер фиксирует решение и ожидание, ассистент проактивно возвращается на дату проверки спросить «как вышло?», фиксирует исход с вердиктом и считает win-rate.

**Architecture:** Паттерн Obligations write-моста 1:1 — модель `Decision` + 2 write-инструмента (needsConfirm) + проактивный детектор по `reviewDate` + enrichment-врезка с `computeWinRate`. Флаг `FEATURE_V2_DECISIONS`, off=байт-идентично. READ-ONLY кроме confirm-гейтнутых write.

**Tech Stack:** Fastify, Prisma 6, Postgres, TypeScript strict (ESM `.js`), vitest (zero vi.mock), defineTool registry.

---

## File Structure

| Файл | Ответственность | Действие |
|---|---|---|
| `prisma/schema.prisma` | модель `Decision` + relation в `User` | Modify |
| `prisma/migrations/20260604010000_decisions/migration.sql` | idempotent CREATE TABLE | Create |
| `src/lib/feature-flags.ts` (+`.test.ts`) | `isV2DecisionsEnabled` | Modify |
| `src/services/decisions/types.ts` (+`.test.ts`) | чистые: parseVerdict, computeWinRate, describeDecisionReview | Create |
| `src/services/decisions/decisions.ts` | `buildDecisionsContext` (READ-ONLY) | Create |
| `src/services/decisions/index.ts` | re-export | Create |
| `src/services/decisions/decisions.it.test.ts` | поведенческий тест-БД | Create |
| `src/tools/log-decision.ts` + `review-decision.ts` (+tests) | write-инструменты | Create |
| `src/tools/index.ts` | регистрация | Modify |
| `src/services/v2-enrichment.ts` (+`.test.ts`) | врезка decisions | Modify |
| `src/services/v2-proactivity-engine.ts` (+`.test.ts`) | детектор decision_review | Modify |
| `src/routes/auth.ts` | GDPR delete | Modify |

**Money-safety:** `decisions.ts` + детектор READ-ONLY (structural guard). Инструменты пишут только `decision.create/update`. Оба `needsConfirm:true`.

---

## Task 1: Prisma модель Decision + idempotent миграция

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/20260604010000_decisions/migration.sql`

- [ ] **Step 1: Добавить relation в User + модель**

В `schema.prisma` в модель `User` рядом с `cashSnapshots CashSnapshot[]` добавить:
```prisma
  decisions      Decision[]
```
И новую модель (рядом с `CashSnapshot`):
```prisma
model Decision {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title           String
  expectedOutcome String?
  reviewDate      DateTime  @db.Date
  status          String    @default("open")
  actualOutcome   String?
  verdict         String?
  decidedAt       DateTime  @default(now())
  reviewedAt      DateTime?
  source          String    @default("manual")

  @@index([userId, status, reviewDate])
}
```

- [ ] **Step 2: Создать idempotent migration.sql**

`prisma/migrations/20260604010000_decisions/migration.sql`:
```sql
-- Decision: журнал решений + ретро (кросс-домен мост #4). Идемпотентно
-- (IF NOT EXISTS) — таблица создаётся raw-SQL на проде, replay через
-- migrate deploy безопасен (no-op на проде, fresh на тест-БД).
CREATE TABLE IF NOT EXISTS "Decision" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "expectedOutcome" TEXT,
  "reviewDate"      DATE NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'open',
  "actualOutcome"   TEXT,
  "verdict"         TEXT,
  "decidedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"      TIMESTAMP(3),
  "source"          TEXT NOT NULL DEFAULT 'manual',
  CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Decision_userId_status_reviewDate_idx"
  ON "Decision" ("userId", "status", "reviewDate");

DO $$ BEGIN
  ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 3: Применить к ПРОД-БД + сгенерировать клиент**

Run:
```bash
cd packages/server && npx prisma db execute --schema prisma/schema.prisma --stdin < prisma/migrations/20260604010000_decisions/migration.sql
npx prisma generate
```
Expected: `Script executed successfully.` + `Generated Prisma Client`.

- [ ] **Step 4: tsc + commit**

Run: `cd packages/server && npx tsc --noEmit`
Expected: без ошибок.
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/20260604010000_decisions/migration.sql
git commit -F - <<'EOF'
feat(schema): Decision model — журнал решений + ретро (мост #4)

reviewDate-якорь, status open|reviewed, verdict worked|didnt|mixed.
Idempotent миграция (IF NOT EXISTS) + raw-SQL на прод + generate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Флаг isV2DecisionsEnabled

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Test: `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Падающий тест**

В `feature-flags.test.ts` добавить `isV2DecisionsEnabled` к импорту из `'./feature-flags.js'`, затем:
```ts
describe('isV2DecisionsEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_DECISIONS; });
  it('unset → false', () => {
    expect(isV2DecisionsEnabled('u1')).toBe(false);
  });
  it('none/false/empty → false', () => {
    for (const v of ['none', 'false', '']) {
      process.env.FEATURE_V2_DECISIONS = v;
      expect(isV2DecisionsEnabled('u1')).toBe(false);
    }
  });
  it('all/true → true', () => {
    process.env.FEATURE_V2_DECISIONS = 'all';
    expect(isV2DecisionsEnabled('anybody')).toBe(true);
    process.env.FEATURE_V2_DECISIONS = 'true';
    expect(isV2DecisionsEnabled('anybody')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_DECISIONS = 'user-u1';
    expect(isV2DecisionsEnabled('u1')).toBe(true);
    expect(isV2DecisionsEnabled('u2')).toBe(false);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t "isV2DecisionsEnabled"` → FAIL (not a function).

- [ ] **Step 3: Реализовать**

В `feature-flags.ts` после `isV2RunwayBalanceEnabled`:
```ts
/**
 * Решения↔исходы: журнал решений + ретро + детектор decision_review.
 * Same shape as isV2AxesEnabled (env FEATURE_V2_DECISIONS).
 */
export function isV2DecisionsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_DECISIONS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: GREEN + tsc** — Run: `npx vitest run src/lib/feature-flags.test.ts -t "isV2DecisionsEnabled" && npx tsc --noEmit` → PASS, чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(flags): isV2DecisionsEnabled (FEATURE_V2_DECISIONS)

Гейтит инструменты log/review_decision + детектор + врезку.
Форма all|true|none|false|user-X. off=байт-идентично.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Чистые хелперы decisions/types.ts

**Files:**
- Create: `packages/server/src/services/decisions/types.ts`
- Test: `packages/server/src/services/decisions/types.test.ts`

- [ ] **Step 1: Падающий тест**

`types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseVerdict, computeWinRate, describeDecisionReview } from './types.js';

describe('parseVerdict', () => {
  it('canonical values pass through', () => {
    expect(parseVerdict('worked')).toBe('worked');
    expect(parseVerdict('didnt')).toBe('didnt');
    expect(parseVerdict('mixed')).toBe('mixed');
  });
  it('russian synonyms map', () => {
    expect(parseVerdict('сработало')).toBe('worked');
    expect(parseVerdict('Да')).toBe('worked');
    expect(parseVerdict('нет')).toBe('didnt');
    expect(parseVerdict('провал')).toBe('didnt');
    expect(parseVerdict('частично')).toBe('mixed');
  });
  it('junk → null', () => {
    expect(parseVerdict('бла')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });
});

describe('computeWinRate', () => {
  it('only worked counts; mixed/didnt/null do not', () => {
    const r = computeWinRate([
      { verdict: 'worked' }, { verdict: 'worked' },
      { verdict: 'mixed' }, { verdict: 'didnt' }, { verdict: null },
    ]);
    expect(r).toEqual({ reviewed: 5, worked: 2, rate: 0.4 });
  });
  it('empty → rate null', () => {
    expect(computeWinRate([])).toEqual({ reviewed: 0, worked: 0, rate: null });
  });
  it('all worked → 1', () => {
    expect(computeWinRate([{ verdict: 'worked' }]).rate).toBe(1);
  });
});

describe('describeDecisionReview', () => {
  it('mentions title, expected, weeks ago', () => {
    const now = new Date('2026-06-04');
    const s = describeDecisionReview(
      { title: 'нанять Айгуль', expectedOutcome: 'закрыть найм', decidedAt: new Date('2026-05-07') },
      now,
    );
    expect(s).toMatch(/нанять Айгуль/);
    expect(s).toMatch(/закрыть найм/);
    expect(s).toMatch(/нед/);
  });
  it('handles null expectedOutcome', () => {
    const s = describeDecisionReview(
      { title: 'X', expectedOutcome: null, decidedAt: new Date('2026-05-07') },
      new Date('2026-06-04'),
    );
    expect(s).toMatch(/X/);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/decisions/types.test.ts` → FAIL (module not found).

- [ ] **Step 3: Реализовать**

`types.ts`:
```ts
export type Verdict = 'worked' | 'didnt' | 'mixed';

const DAY_MS = 86_400_000;

const VERDICT_SYNONYMS: Record<string, Verdict> = {
  worked: 'worked', сработало: 'worked', да: 'worked', успех: 'worked', окупилось: 'worked',
  didnt: 'didnt', 'didn\'t': 'didnt', нет: 'didnt', провал: 'didnt', неудача: 'didnt',
  mixed: 'mixed', частично: 'mixed', смешанно: 'mixed', 'так-себе': 'mixed',
};

/** Defensive: текст вердикта → канон | null. */
export function parseVerdict(raw: string): Verdict | null {
  const key = raw.trim().toLowerCase();
  return VERDICT_SYNONYMS[key] ?? null;
}

/** Win-rate по проверенным решениям. Только 'worked' = успех. */
export function computeWinRate(
  reviewed: { verdict: string | null }[],
): { reviewed: number; worked: number; rate: number | null } {
  const total = reviewed.length;
  const worked = reviewed.filter((d) => d.verdict === 'worked').length;
  return { reviewed: total, worked, rate: total === 0 ? null : worked / total };
}

/** Строка проактивного возврата к решению. */
export function describeDecisionReview(
  d: { title: string; expectedOutcome?: string | null; decidedAt: Date },
  now: Date,
): string {
  const weeks = Math.max(1, Math.floor((now.getTime() - d.decidedAt.getTime()) / (7 * DAY_MS)));
  const exp = d.expectedOutcome ? `, ожидал «${d.expectedOutcome}»` : '';
  return `${weeks} нед назад ты решил «${d.title}»${exp} — как на самом деле вышло?`;
}
```

- [ ] **Step 4: GREEN + tsc** — Run: `npx vitest run src/services/decisions/types.test.ts && npx tsc --noEmit` → PASS, чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/decisions/types.ts packages/server/src/services/decisions/types.test.ts
git commit -F - <<'EOF'
feat(decisions): pure helpers parseVerdict + computeWinRate + describe

Чистые: вердикт-парс (рус синонимы), win-rate (только worked), строка
проактивного возврата. Фундамент движка решений.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Сервис buildDecisionsContext + поведенческий it

**Files:**
- Create: `packages/server/src/services/decisions/decisions.ts`
- Create: `packages/server/src/services/decisions/index.ts`
- Create: `packages/server/src/services/decisions/decisions.it.test.ts`

- [ ] **Step 1: Реализовать сервис (READ-ONLY)**

`decisions.ts`:
```ts
import { prisma } from '../../lib/prisma.js';
import { computeWinRate } from './types.js';

export interface DecisionsContext {
  dueForReview: Array<{ title: string; expectedOutcome: string | null; decidedAt: Date }>;
  winRate: ReturnType<typeof computeWinRate>;
}

/**
 * READ-ONLY кросс-домен контекст решений: открытые решения, которым пора
 * ретро (reviewDate <= now), + win-rate по уже проверенным. null если пусто.
 */
export async function buildDecisionsContext(
  userId: string,
  now: Date = new Date(),
): Promise<DecisionsContext | null> {
  try {
    const [due, reviewed] = await Promise.all([
      prisma.decision.findMany({
        where: { userId, status: 'open', reviewDate: { lte: now } },
        orderBy: { reviewDate: 'asc' },
        take: 5,
        select: { title: true, expectedOutcome: true, decidedAt: true },
      }),
      prisma.decision.findMany({
        where: { userId, status: 'reviewed' },
        select: { verdict: true },
      }),
    ]);
    const winRate = computeWinRate(reviewed);
    if (due.length === 0 && winRate.reviewed === 0) return null;
    return { dueForReview: due, winRate };
  } catch (err) {
    console.warn(
      '[decisions] buildDecisionsContext failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

`index.ts`:
```ts
export { buildDecisionsContext, type DecisionsContext } from './decisions.js';
export { parseVerdict, computeWinRate, describeDecisionReview, type Verdict } from './types.js';
```

- [ ] **Step 2: Поведенческий тест**

`decisions.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildDecisionsContext } from './decisions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'D', passwordHash: 'x' } });
  return u.id;
}

describe('buildDecisionsContext — реальная БД', () => {
  it('открытое решение с reviewDate в прошлом → dueForReview', async () => {
    const userId = await seedUser('dec-a@a.test');
    await prisma.decision.create({
      data: { userId, title: 'поставщик A', expectedOutcome: '−15%', reviewDate: new Date('2026-05-01'), decidedAt: new Date('2026-04-01') },
    });
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx).not.toBeNull();
    expect(ctx!.dueForReview).toHaveLength(1);
    expect(ctx!.dueForReview[0].title).toBe('поставщик A');
  });

  it('reviewDate в будущем → не в dueForReview', async () => {
    const userId = await seedUser('dec-b@a.test');
    await prisma.decision.create({
      data: { userId, title: 'будущее', reviewDate: new Date('2026-12-01'), decidedAt: new Date('2026-06-01') },
    });
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx).toBeNull(); // нет due + нет reviewed
  });

  it('reviewed решения → win-rate', async () => {
    const userId = await seedUser('dec-c@a.test');
    for (const v of ['worked', 'worked', 'didnt']) {
      await prisma.decision.create({
        data: { userId, title: `d-${v}`, reviewDate: new Date('2026-05-01'), status: 'reviewed', verdict: v, decidedAt: new Date('2026-04-01') },
      });
    }
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx!.winRate).toEqual({ reviewed: 3, worked: 2, rate: 2 / 3 });
  });

  it('изоляция: A не видит решения B', async () => {
    const a = await seedUser('dec-iso-a@a.test');
    const b = await seedUser('dec-iso-b@a.test');
    await prisma.decision.create({
      data: { userId: b, title: 'B-секрет', reviewDate: new Date('2026-05-01'), decidedAt: new Date('2026-04-01') },
    });
    expect(await buildDecisionsContext(a, new Date('2026-06-04'))).toBeNull();
  });
});
```

- [ ] **Step 3: Запустить it (тест-БД, migrate deploy создаст таблицу)**

Run: `cd packages/server && npm run test:db:up && npx vitest run --project integration src/services/decisions/decisions.it.test.ts`
Expected: 4 passed.

- [ ] **Step 4: tsc + commit**

Run: `cd packages/server && npx tsc --noEmit` → чисто.
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/decisions/decisions.ts packages/server/src/services/decisions/index.ts packages/server/src/services/decisions/decisions.it.test.ts
git commit -F - <<'EOF'
feat(decisions): buildDecisionsContext (READ-ONLY) + behavioral it

Открытые решения на ретро (reviewDate<=now) + win-rate по reviewed.
Тест-БД: due/future/winrate/изоляция.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Инструменты log_decision + review_decision + регистрация

**Files:**
- Create: `packages/server/src/tools/log-decision.ts`, `review-decision.ts`
- Create: `packages/server/src/tools/decisions-tools.test.ts`
- Modify: `packages/server/src/tools/index.ts`

- [ ] **Step 1: Падающий тест**

`decisions-tools.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { logDecisionTool } from './log-decision.js';
import { reviewDecisionTool } from './review-decision.js';

const LOG = readFileSync(join(__dirname, 'log-decision.ts'), 'utf8');
const REV = readFileSync(join(__dirname, 'review-decision.ts'), 'utf8');

describe('decision tools — money-safety', () => {
  it('log_decision: needsConfirm + write + flag-gated', () => {
    expect(logDecisionTool.name).toBe('log_decision');
    expect(logDecisionTool.needsConfirm).toBe(true);
    expect(logDecisionTool.sideEffects).toBe('write');
    expect(LOG).toMatch(/isV2DecisionsEnabled\(ctx\.userId\)/);
  });
  it('review_decision: needsConfirm + write + flag-gated', () => {
    expect(reviewDecisionTool.name).toBe('review_decision');
    expect(reviewDecisionTool.needsConfirm).toBe(true);
    expect(reviewDecisionTool.sideEffects).toBe('write');
    expect(REV).toMatch(/isV2DecisionsEnabled\(ctx\.userId\)/);
  });
  it('write only Decision (no income/expense)', () => {
    for (const s of [LOG, REV]) {
      expect(s).not.toMatch(/prisma\.(income|expense)\.(create|update)/);
    }
    expect(LOG).toMatch(/decision\.create/);
    expect(REV).toMatch(/decision\.update/);
  });
});

describe('decision tools — registry', () => {
  it('both registered in tools/index.ts', () => {
    const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(idx).toMatch(/logDecisionTool/);
    expect(idx).toMatch(/reviewDecisionTool/);
  });
});
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/tools/decisions-tools.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Реализовать log-decision.ts**
```ts
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2DecisionsEnabled } from '../lib/feature-flags.js';
import { defineTool } from './_types.js';

const DAY_MS = 86_400_000;

/**
 * Зафиксировать решение + ожидаемый исход + дату проверки. needsConfirm:true.
 * Пишет ТОЛЬКО Decision (не денежный ledger). Дефолт reviewDate = +90 дней.
 */
export const logDecisionTool = defineTool({
  name: 'log_decision',
  description:
    'Записать важное решение пользователя (что решил, что ожидает, когда ' +
    'проверить). Позже ассистент вернётся спросить, как вышло. Выполняется ' +
    'только после явного подтверждения. Не подтверждай сам.',
  category: 'planning',
  aliases: { decision: 'title', что: 'title', ожидаю: 'expectedOutcome', expect: 'expectedOutcome' },
  schema: z.object({
    title: z.string().min(1).max(240),
    expectedOutcome: z.string().max(500).optional(),
    reviewDate: z.string().optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['реши: беру поставщика A, ожидаю −15% себестоимости, проверь через месяц'],
  handler: async (input, ctx) => {
    if (!isV2DecisionsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const tz = await getUserTimezone(ctx.userId);
    const today = localDayStartUTC(tz);
    let reviewDate = new Date(today.getTime() + 90 * DAY_MS);
    if (input.reviewDate) {
      const d = new Date(input.reviewDate);
      if (!Number.isNaN(d.getTime())) reviewDate = d;
    }
    await prisma.decision.create({
      data: {
        userId: ctx.userId,
        title: input.title,
        expectedOutcome: input.expectedOutcome ?? null,
        reviewDate,
        status: 'open',
        source: 'manual',
      },
    });
    return {
      message: `Записал решение «${input.title}». Вернусь ${reviewDate
        .toISOString()
        .slice(0, 10)} спросить, как вышло.`,
    };
  },
});
```

- [ ] **Step 4: Реализовать review-decision.ts**
```ts
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isV2DecisionsEnabled } from '../lib/feature-flags.js';
import { defineTool } from './_types.js';

/**
 * Зафиксировать фактический исход ранее записанного решения + вердикт.
 * Вердикт ассистент ВЫВОДИТ из текста ретро и предлагает; юзер подтверждает.
 * needsConfirm:true. Пишет ТОЛЬКО Decision.
 */
export const reviewDecisionTool = defineTool({
  name: 'review_decision',
  description:
    'Зафиксировать, как вышло ранее записанное решение, и вердикт ' +
    '(worked/didnt/mixed). Вердикт определи из слов пользователя и предложи. ' +
    'Выполняется только после явного подтверждения.',
  category: 'planning',
  aliases: { что: 'title', outcome: 'actualOutcome', result: 'actualOutcome' },
  schema: z.object({
    title: z.string().min(1),
    actualOutcome: z.string().min(1).max(500),
    verdict: z.enum(['worked', 'didnt', 'mixed']),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['поставщик A сработал, себестоимость −12%'],
  handler: async (input, ctx) => {
    if (!isV2DecisionsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const found = await prisma.decision.findFirst({
      where: { userId: ctx.userId, status: 'open', title: { contains: input.title, mode: 'insensitive' } },
      orderBy: { decidedAt: 'desc' },
    });
    if (!found) return { error: 'не нашёл такое открытое решение' };
    await prisma.decision.update({
      where: { id: found.id },
      data: {
        status: 'reviewed',
        reviewedAt: new Date(),
        actualOutcome: input.actualOutcome,
        verdict: input.verdict,
      },
    });
    const label = input.verdict === 'worked' ? 'сработало ✅' : input.verdict === 'didnt' ? 'не вышло ❌' : 'частично ⚖️';
    return { message: `Записал исход «${found.title}»: ${label}.` };
  },
});
```

- [ ] **Step 5: Зарегистрировать**

В `tools/index.ts` добавить импорты (рядом с obligations):
```ts
import { logDecisionTool } from './log-decision.js';
import { reviewDecisionTool } from './review-decision.js';
```
И в `ALL_TOOLS` (рядом с obligations-инструментами):
```ts
  // Решения↔исходы (мост #4) — флаг-гейт в хендлерах
  logDecisionTool,
  reviewDecisionTool,
```

- [ ] **Step 6: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/tools/decisions-tools.test.ts && npx tsc --noEmit` → PASS, чисто.

- [ ] **Step 7: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/tools/log-decision.ts packages/server/src/tools/review-decision.ts packages/server/src/tools/decisions-tools.test.ts packages/server/src/tools/index.ts
git commit -F - <<'EOF'
feat(tools): log_decision + review_decision (needsConfirm, flag-gated)

Паттерн obligations 1:1. log пишет Decision (дефолт reviewDate +90д),
review fuzzy-матчит открытое решение + ставит verdict (worked/didnt/mixed).
Пишут только Decision. Handler-gate isV2DecisionsEnabled. В ALL_TOOLS.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Enrichment-врезка decisions

**Files:**
- Modify: `packages/server/src/services/v2-enrichment.ts`
- Test: `packages/server/src/services/v2-enrichment.test.ts`

- [ ] **Step 1: Падающий структурный тест**

В `v2-enrichment.test.ts` в `describe('structural — fetcher', ...)` добавить:
```ts
  it('wires decisions branch behind flag with per-builder timeout', () => {
    expect(SRC).toMatch(/isV2DecisionsEnabled\(userId\)/);
    expect(SRC).toMatch(/buildDecisionsContext\(/);
    expect(SRC).toMatch(/formatDecisionsSection\(/);
  });
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/v2-enrichment.test.ts -t "decisions branch"` → FAIL.

- [ ] **Step 3: Реализовать врезку**

В `v2-enrichment.ts`:
1. Импорты (рядом с другими сервис-импортами):
```ts
import { buildDecisionsContext } from './decisions/index.js';
import { computeWinRate } from './decisions/index.js';
```
И добавить `isV2DecisionsEnabled` в существующий импорт из `'../lib/feature-flags.js'`.

2. В тип `V2EnrichmentData` добавить поле (рядом с `relationship`):
```ts
  decisions: string | null;
```

3. Чистый рендер (рядом с `formatRelationshipSection`):
```ts
function formatDecisionsSection(
  ctx: Awaited<ReturnType<typeof buildDecisionsContext>>,
): string | null {
  if (!ctx) return null;
  const lines: string[] = [];
  for (const d of ctx.dueForReview) {
    lines.push(`— «${d.title}» (пора спросить, как вышло)`);
  }
  if (ctx.winRate.reviewed >= 3 && ctx.winRate.rate !== null) {
    lines.push(
      `Решений проверено ${ctx.winRate.reviewed}, сработало ${ctx.winRate.worked} — ${Math.round(
        ctx.winRate.rate * 100,
      )}%.`,
    );
  }
  return lines.length > 0 ? `Решения на проверке:\n${lines.join('\n')}` : null;
}
```
(`computeWinRate` импорт оставить если используется; если нет — убрать, чтобы tsc не ругался на unused.)

4. В `fetchV2EnrichmentData` `Promise.all` добавить ветку (рядом с relationship):
```ts
      isV2DecisionsEnabled(userId)
        ? withTimeout(
            buildDecisionsContext(userId).then((c) => formatDecisionsSection(c)),
            CROSS_DOMAIN_BUDGET_MS,
            null,
          ).catch(() => null)
        : Promise.resolve(null),
```

5. Добавить `decisions` в деструктуризацию массива `Promise.all` (последним) и в возвращаемый объект:
```ts
      decisions,
```

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/services/v2-enrichment.test.ts && npx tsc --noEmit` → PASS, чисто. (если `computeWinRate` импорт не используется в файле — удалить строку импорта.)

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/v2-enrichment.ts packages/server/src/services/v2-enrichment.test.ts
git commit -F - <<'EOF'
feat(enrichment): decisions-врезка (на проверку + win-rate)

За isV2DecisionsEnabled, per-builder withTimeout. Список решений на ретро
+ строка win-rate при ≥3 проверенных. Ответ на «как мои решения?».

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Проактивный детектор decision_review

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Test: `packages/server/src/services/v2-proactivity-engine.test.ts`

- [ ] **Step 1: Падающий тест — расширить exhaustiveness + детектор**

В `v2-proactivity-engine.test.ts`, в тесте `'covers all known sources'`, добавить `'decision_review'` в массив (сохраняя `.sort()`):
```ts
        'decision_review',
```

- [ ] **Step 2: RED** — Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts -t "covers all known sources"` → FAIL (TEMPLATES не содержит decision_review).

- [ ] **Step 3: Реализовать**

В `v2-proactivity-engine.ts`:
1. В `type NudgeSource` добавить член:
```ts
  | 'decision_review';
```
2. В `scoreSignificance` добавить case (рядом с obligation_due):
```ts
    case 'decision_review': {
      // Решение, которому пора ретро — стабильно значимо.
      return 0.55;
    }
```
3. В `TEMPLATES` добавить блок:
```ts
  decision_review: {
    gentle: '{{weeks}} нед назад ты решил «{{title}}»{{expectedSuffix}} — как вышло?',
    curious: 'Помнишь решение «{{title}}»? {{weeks}} нед прошло — как на самом деле?',
    supportive:
      'Пора оглянуться: «{{title}}» ({{weeks}} нед назад). Сработало или нет?',
  },
```
4. Добавить детектор (рядом с `detectObligationDue`):
```ts
async function detectDecisionReview(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2DecisionsEnabled } = await import('../lib/feature-flags.js');
    if (!isV2DecisionsEnabled(userId)) return [];
    const { prisma } = await import('../lib/prisma.js');
    const now = Date.now();
    const rows = await prisma.decision.findMany({
      where: { userId, status: 'open' },
      orderBy: [{ reviewDate: 'asc' }],
      take: 20,
    });
    const out: NudgeCandidate[] = [];
    for (const d of rows) {
      const due = d.reviewDate.getTime();
      if (due > now) continue;
      const weeks = Math.max(1, Math.floor((now - d.decidedAt.getTime()) / (7 * DAY_MS)));
      const cand: NudgeCandidate = {
        source: 'decision_review',
        significance: 0,
        payload: {
          title: d.title,
          weeks,
          expectedSuffix: d.expectedOutcome ? `, ожидал «${d.expectedOutcome}»` : '',
        },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectDecisionReview failed:', err);
    return [];
  }
}
```
5. В `detectCandidates` `Promise.allSettled([...])` добавить вызов:
```ts
      detectDecisionReview(userId),
```
6. Обновить doc-comment счётчик `(12 detectors)` → `(13 detectors)`.

- [ ] **Step 4: GREEN + tsc** — Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts && npx tsc --noEmit` → PASS, чисто.

- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -F - <<'EOF'
feat(proactivity): detectDecisionReview (reviewDate<=now → «как вышло?»)

NudgeSource decision_review + scoreSignificance + TEMPLATES + детектор
(1:1 detectObligationDue, флаг-гейт) + регистрация + exhaustiveness.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: GDPR — удаление Decision при удалении аккаунта

**Files:**
- Modify: `packages/server/src/routes/auth.ts`

- [ ] **Step 1: Добавить delete в транзакцию**

В `auth.ts` рядом с `tx.cashSnapshot.deleteMany({ where: { userId } });` добавить:
```ts
      await tx.decision.deleteMany({ where: { userId } });
```

- [ ] **Step 2: Проверить coverage-тест + tsc**

Run: `cd packages/server && npx vitest run src/routes/auth-delete-coverage.test.ts && npx tsc --noEmit`
Expected: PASS (модель Decision покрыта удалением), чисто.

- [ ] **Step 3: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/routes/auth.ts
git commit -F - <<'EOF'
fix(auth): delete Decision on account deletion (GDPR coverage)

Новая user-owned модель удаляется при удалении аккаунта (delete-coverage
тест стережёт). decision.deleteMany рядом с cashSnapshot.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Финальная проверка + независимое ревью + rollout

**Files:** нет правок — верификация.

- [ ] **Step 1: Полный прогон**

Run: `cd packages/server && npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected: tsc чисто; `Test Files … passed`, `Tests … passed` (≥ baseline 2320 + новые).

- [ ] **Step 2: Интеграция**

Run: `cd packages/server && npm run test:db:up && npm run test:it 2>&1 | tail -3`
Expected: все it зелёные (29 baseline + 4 новых = 33).

- [ ] **Step 3: Negative-control (флаг off = байт-идентично)**

Проверить структурно: при `FEATURE_V2_DECISIONS` unset — инструменты возвращают `{error:'функция отключена'}`, детектор/врезка отдают пусто/null (ранние флаг-гейты Task 5/6/7).

- [ ] **Step 4: Независимое ревью**

Дать code-reviewer subagent весь diff фичи. Оси: READ-ONLY decisions.ts+детектор, money-safety (needsConfirm, ноль income/expense write), флаг off=identical, GDPR, null-safety, реюз паттерна obligations. Починить найденное.

- [ ] **Step 5: Rollout (стандартное правило flag=all)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git push origin main
~/.npm-global/bin/railway variables --service lifeos-api --set "FEATURE_V2_DECISIONS=all"
```
Дождаться deploy SUCCESS + health 200. SMOKE: «реши: беру поставщика A, ожидаю −15%, проверь через месяц» → «да» → запись; (на reviewDate) проактивный «как вышло?»; «сработало, −12%» → бот предлагает verdict ✅; «как мои решения?» → список + win-rate.

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:** S1 модель+миграция → T1 ✓. S1 флаг → T2 ✓. S3 чистые (parseVerdict/computeWinRate/describeDecisionReview) → T3 ✓. S3 сервис buildDecisionsContext → T4 ✓. S2 инструменты log/review + авто-вердикт (review_decision принимает уже-определённый verdict) → T5 ✓. S3 enrichment-врезка + win-rate → T6 ✓. S3 детектор → T7 ✓. S4 GDPR → T8 ✓. S4 money-safety guard → T5 (no income/expense) + T4/T7 (READ-ONLY) ✓. Тесты — каждая категория покрыта.

**2. Placeholder scan:** нет TBD — весь код приведён.

**3. Type consistency:** `Verdict='worked'|'didnt'|'mixed'` един везде. `computeWinRate(...)→{reviewed,worked,rate}` един (T3 def, T4/T6 use). `buildDecisionsContext(userId,now?)→{dueForReview,winRate}|null` един (T4 def, T6 use). `logDecisionTool`/`reviewDecisionTool`, `detectDecisionReview`, `isV2DecisionsEnabled`, source `'decision_review'` — консистентны. TEMPLATES decision_review использует `{{title}}/{{weeks}}/{{expectedSuffix}}`, детектор payload отдаёт ровно эти ключи.

**Замечание:** регистрация инструментов — в `ALL_TOOLS` безусловно, флаг-гейт в хендлере (идиома репо, как obligations). off=identical по эффекту (инструмент отказывает), не по списку — принятый компромисс.
