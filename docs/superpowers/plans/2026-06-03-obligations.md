# «Обязательства» (Obligations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) или
> subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Дать LifeOS first-class «обязательства» (кто кому что должен — действие/деньги,
со сроком, оба направления), захват ручной+авто-подтверждаемый, проактивные напоминания,
кросс-связь с деньгами — поверх нашего v2-мозга.

**Architecture:** Новая модель `Obligation` (опц. связь с `Entity` person) + чистые
хелперы + postgres-store + 4 инструмента реестра + детектор проактивности + enrichment
в контекст. Всё за флагом `isV2ObligationsEnabled`. Деньги — только через существующий
confirm + add_income/add_expense (ноль обхода money-safety).

**Tech Stack:** Prisma 6, Postgres+pgvector, Fastify 5, zod, vitest 2.1.9, createAnthropic+haiku.

**Rollout:** коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`).
Миграцию — руками идемпотентно (.env=ПРОД, без `migrate dev`). Push/deploy/флаг — ТОЛЬКО
по явному слову Berik. Все пути относительно `packages/server/`.

**Pinned факты (из explore):**
- Tool-shape: `defineTool({ name, description, category, aliases, schema(zod), needsConfirm,
  sideEffects, examples, handler: async(input, ctx) })`, `ctx.userId`, import из `./_types.js`,
  `prisma` из `../lib/prisma.js`.
- Flag-shape: копия `isV2AxesEnabled` (env `(all|true|none|false|user-X)`).
- Proactivity: `NudgeSource` union, `NudgeCandidate { source, significance, patternId?,
  entityId?, payload, toneHint }`, `TEMPLATES: Record<NudgeSource, Partial<Record<NudgeTone,
  string>>>`, детектор = async fn → `NudgeCandidate[]` (try/catch, `scoreSignificance`),
  регистрация в `V2ProactivityEngine.detectCandidates` `Promise.allSettled([...])`.
- `DAY_MS` уже определён в v2-proactivity-engine.ts.
- Harness: `test/integration/build-test-app.ts` (`buildTestApp`), `PrismaClient` напрямую,
  `*.it.test.ts`, `npm run test:db:up` + `npm run test:it`.
- `resolveEntity` есть в `services/entity-graph/index.ts` (best-effort person link).
- Money tools `add_expense`/`add_income` существуют (money-safe confirm) — settle ВОЗВРАЩАЕТ
  предложение, НЕ создаёт запись.

---

### Task 1: Prisma model `Obligation` + идемпотентная миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260603130000_obligations/migration.sql`
- Modify: `src/routes/auth.ts` (delete-account transaction)
- Test: `src/routes/auth-delete-coverage.test.ts` (guard уже динамический — проверит авто)

- [ ] **Step 1: Добавить модель в `prisma/schema.prisma`** (в конец файла)

```prisma
model Obligation {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  personEntityId String?
  person         Entity?   @relation("EntityObligations", fields: [personEntityId], references: [id], onDelete: SetNull)
  personName     String
  direction      String // 'i_owe' | 'owed_to_me'
  kind           String // 'action' | 'money'
  description    String
  amount         Float?
  currency       String?   @default("₸")
  dueDate        DateTime? @db.Date
  status         String    @default("open") // 'open' | 'done' | 'cancelled'
  source         String // 'manual' | 'ai_suggested'
  note           String?
  createdAt      DateTime  @default(now())
  settledAt      DateTime?

  @@index([userId, status, dueDate])
  @@index([userId, personEntityId])
}
```

- [ ] **Step 2: Добавить back-relations**

В `model User { … }` добавить строку: `obligations Obligation[]`
В `model Entity { … }` добавить строку: `obligations Obligation[] @relation("EntityObligations")`

- [ ] **Step 3: Сгенерировать клиент**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` без ошибок.

- [ ] **Step 4: Создать идемпотентную миграцию** `prisma/migrations/20260603130000_obligations/migration.sql`

```sql
-- Obligations: first-class «кто кому что должен». ИДЕМПОТЕНТНА (как reconcile):
-- CREATE TABLE/INDEX IF NOT EXISTS + FK через DO/pg_constraint → no-op на проде,
-- полная на чистой БД. .env=ПРОД, миграцию накатывает Railway migrate deploy.
CREATE TABLE IF NOT EXISTS "Obligation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personEntityId" TEXT,
    "personName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT DEFAULT '₸',
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Obligation_userId_status_dueDate_idx" ON "Obligation"("userId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Obligation_userId_personEntityId_idx" ON "Obligation"("userId", "personEntityId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Obligation_userId_fkey') THEN
  ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Obligation_personEntityId_fkey') THEN
  ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_personEntityId_fkey" FOREIGN KEY ("personEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END IF; END $$;
```

- [ ] **Step 5: Применить на тест-БД (проверка миграции)**

Run: `npm run test:db:down && npm run test:db:up && DATABASE_URL='postgresql://lifeos:lifeos@localhost:5433/lifeos_test' npx prisma migrate deploy 2>&1 | tail -3`
Expected: `All migrations have been successfully applied.`

- [ ] **Step 6: Покрыть удаление аккаунта (cascade достаточно, но guard это утверждает)**

`Obligation` имеет `onDelete: Cascade` на userId → guard-тест `auth-delete-coverage.test.ts`
проходит автоматически (cascaded=true). Проверить:
Run: `npm test -- auth-delete-coverage 2>&1 | tail -5`
Expected: PASS (Obligation не попадает в `ownedUncovered`).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260603130000_obligations
git commit -m "feat(obligations): Obligation model + idempotent migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистые хелперы `types.ts` (TDD)

**Files:**
- Create: `src/services/obligations/types.ts`
- Test: `src/services/obligations/types.test.ts`

- [ ] **Step 1: Падающий тест** `src/services/obligations/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { isOverdue, normalizeDirection, obligationLabel } from './types.js';

describe('obligations/types', () => {
  it('isOverdue: срок в прошлом → true; будущий/нет → false', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    expect(isOverdue(new Date('2026-06-01'), now)).toBe(true);
    expect(isOverdue(new Date('2026-06-10'), now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
  it('normalizeDirection: алиасы → канон', () => {
    expect(normalizeDirection('я должен')).toBe('i_owe');
    expect(normalizeDirection('мне должны')).toBe('owed_to_me');
    expect(normalizeDirection('i_owe')).toBe('i_owe');
    expect(normalizeDirection('owed_to_me')).toBe('owed_to_me');
    expect(normalizeDirection('бред')).toBeNull();
  });
  it('obligationLabel: человекочитаемо', () => {
    expect(
      obligationLabel({ direction: 'i_owe', personName: 'Серик', description: 'договор' }),
    ).toBe('Ты должен: Серик — договор');
    expect(
      obligationLabel({ direction: 'owed_to_me', personName: 'Ахмет', description: '500к' }),
    ).toBe('Тебе должен: Ахмет — 500к');
  });
});
```

- [ ] **Step 2: Запустить — упасть.** Run: `npm test -- obligations/types 2>&1 | tail -5` → FAIL (module not found).

- [ ] **Step 3: Реализация** `src/services/obligations/types.ts`

```ts
export type Direction = 'i_owe' | 'owed_to_me';
export type ObligationKind = 'action' | 'money';
export type ObligationStatus = 'open' | 'done' | 'cancelled';

export function isOverdue(dueDate: Date | null, now: Date): boolean {
  if (!dueDate) return false;
  return dueDate.getTime() < now.getTime();
}

export function normalizeDirection(raw: string): Direction | null {
  const s = raw.trim().toLowerCase();
  if (s === 'i_owe' || s.includes('я должен') || s.includes('я обещал')) return 'i_owe';
  if (s === 'owed_to_me' || s.includes('мне должны') || s.includes('мне обещал')) return 'owed_to_me';
  return null;
}

export function obligationLabel(o: {
  direction: Direction;
  personName: string;
  description: string;
}): string {
  const head = o.direction === 'i_owe' ? 'Ты должен' : 'Тебе должен';
  return `${head}: ${o.personName} — ${o.description}`;
}
```

- [ ] **Step 4: Запустить — зелёный.** Run: `npm test -- obligations/types 2>&1 | tail -5` → PASS. `npx tsc --noEmit` чисто.

- [ ] **Step 5: Commit**

```bash
git add src/services/obligations/types.ts src/services/obligations/types.test.ts
git commit -m "feat(obligations): pure helpers (isOverdue/normalizeDirection/obligationLabel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Store `postgres-impl.ts` + `index.ts`

**Files:**
- Create: `src/services/obligations/postgres-impl.ts`
- Create: `src/services/obligations/index.ts`

- [ ] **Step 1: Реализация** `src/services/obligations/postgres-impl.ts`

```ts
import { prisma } from '../../lib/prisma.js';
import type { Direction, ObligationKind } from './types.js';

export type CreateInput = {
  userId: string;
  personName: string;
  personEntityId?: string | null;
  direction: Direction;
  kind: ObligationKind;
  description: string;
  amount?: number | null;
  currency?: string | null;
  dueDate?: Date | null;
  source: 'manual' | 'ai_suggested';
  note?: string | null;
};

export async function createObligation(input: CreateInput) {
  return prisma.obligation.create({
    data: {
      userId: input.userId,
      personName: input.personName,
      personEntityId: input.personEntityId ?? null,
      direction: input.direction,
      kind: input.kind,
      description: input.description,
      amount: input.kind === 'money' ? (input.amount ?? null) : null,
      currency: input.currency ?? '₸',
      dueDate: input.dueDate ?? null,
      status: 'open',
      source: input.source,
      note: input.note ?? null,
    },
  });
}

export async function listObligations(
  userId: string,
  opts: { status?: string; direction?: Direction; personName?: string } = {},
) {
  return prisma.obligation.findMany({
    where: {
      userId,
      status: opts.status ?? 'open',
      ...(opts.direction ? { direction: opts.direction } : {}),
      ...(opts.personName
        ? { personName: { contains: opts.personName, mode: 'insensitive' } }
        : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
}

export async function settleObligation(userId: string, id: string) {
  // Атомарно с проверкой ownership (паттерн как tasks DELETE).
  return prisma.$transaction(async (tx) => {
    const o = await tx.obligation.findFirst({ where: { id, userId } });
    if (!o) return null;
    return tx.obligation.update({
      where: { id },
      data: { status: 'done', settledAt: new Date() },
    });
  });
}

export async function cancelObligation(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.obligation.findFirst({ where: { id, userId } });
    if (!o) return null;
    return tx.obligation.update({ where: { id }, data: { status: 'cancelled' } });
  });
}

export async function openObligationsForContext(userId: string, limit = 5) {
  return prisma.obligation.findMany({
    where: { userId, status: 'open' },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}
```

- [ ] **Step 2: Re-export** `src/services/obligations/index.ts`

```ts
export * from './types.js';
export * from './postgres-impl.js';
```

- [ ] **Step 3: tsc** Run: `npx tsc --noEmit` → чисто.

- [ ] **Step 4: Commit**

```bash
git add src/services/obligations/postgres-impl.ts src/services/obligations/index.ts
git commit -m "feat(obligations): postgres store (create/list/settle/cancel/context)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Флаг `isV2ObligationsEnabled` (структурный тест)

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Test: `src/lib/feature-flags.test.ts` (добавить кейс) — если файла нет, создать структурный.

- [ ] **Step 1: Добавить флаг в `src/lib/feature-flags.ts`** (рядом с isV2AxesEnabled)

```ts
/**
 * Obligations (память отношений+обещаний). Same shape as isV2AxesEnabled.
 */
export function isV2ObligationsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_OBLIGATIONS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 2: Юнит-тест** (добавить в `src/lib/feature-flags.test.ts`; если нет — создать)

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { isV2ObligationsEnabled } from './feature-flags.js';

describe('isV2ObligationsEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_OBLIGATIONS; });
  it('unset → false', () => { expect(isV2ObligationsEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env.FEATURE_V2_OBLIGATIONS = 'all'; expect(isV2ObligationsEnabled('u1')).toBe(true); });
  it('user-list', () => { process.env.FEATURE_V2_OBLIGATIONS = 'user-u1,user-u2'; expect(isV2ObligationsEnabled('u1')).toBe(true); expect(isV2ObligationsEnabled('u3')).toBe(false); });
});
```

- [ ] **Step 3: Запустить.** Run: `npm test -- feature-flags 2>&1 | tail -5` → PASS. tsc чисто.

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-flags.ts src/lib/feature-flags.test.ts
git commit -m "feat(obligations): isV2ObligationsEnabled flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 4 инструмента реестра + регистрация за флагом

**Files:**
- Create: `src/tools/create-obligation.ts`, `list-obligations.ts`, `settle-obligation.ts`, `cancel-obligation.ts`
- Modify: `src/tools/index.ts` (регистрация за `isV2ObligationsEnabled`)
- Test: `src/tools/obligations-tools.test.ts` (структурный)

- [ ] **Step 1: `src/tools/create-obligation.ts`**

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { createObligation } from '../services/obligations/index.js';
import { normalizeDirection } from '../services/obligations/types.js';

export const createObligationTool = defineTool({
  name: 'create_obligation',
  description:
    'Записать обязательство: что ты обещал человеку ИЛИ что обещали тебе ' +
    '(действие или деньги), с человеком и сроком. Вызывай на «я должен X», ' +
    '«я обещал X», «X должен мне», «X обещал прислать».',
  category: 'memory',
  aliases: { who: 'personName', person: 'personName', name: 'personName', what: 'description', amount_money: 'amount', due: 'dueDate', date: 'dueDate' },
  schema: z.object({
    personName: z.string().max(120),
    direction: z.string().max(40),
    kind: z.enum(['action', 'money']).default('action'),
    description: z.string().max(500),
    amount: z.number().positive().nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['я должен Серику договор к пятнице', 'Ахмет должен мне 500000', 'я обещал маме позвонить завтра'],
  handler: async (input, ctx) => {
    const direction = normalizeDirection(String(input.direction || ''));
    if (!direction) return { error: 'не понял направление (я должен / мне должны)' };
    const created = await createObligation({
      userId: ctx.userId,
      personName: String(input.personName).trim(),
      direction,
      kind: input.kind === 'money' ? 'money' : 'action',
      description: String(input.description).trim(),
      amount: input.amount ?? null,
      dueDate: input.dueDate ? new Date(String(input.dueDate)) : null,
      source: 'manual',
    });
    return { ok: true, id: created.id, personName: created.personName };
  },
});
```

- [ ] **Step 2: `src/tools/list-obligations.ts`**

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { listObligations } from '../services/obligations/index.js';
import { normalizeDirection } from '../services/obligations/types.js';

export const listObligationsTool = defineTool({
  name: 'list_obligations',
  description:
    'Показать открытые обязательства: что ты кому должен и кто должен тебе. ' +
    'Read-only. Вызывай на «что я кому должен», «кто мне должен», «мои обещания».',
  category: 'memory',
  aliases: { person: 'personName', who: 'personName' },
  schema: z.object({
    direction: z.string().max(40).nullable().optional(),
    personName: z.string().max(120).nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что я кому должен', 'кто мне должен', 'мои обещания Серику'],
  handler: async (input, ctx) => {
    const dir = input.direction ? normalizeDirection(String(input.direction)) : null;
    const rows = await listObligations(ctx.userId, {
      status: 'open',
      direction: dir ?? undefined,
      personName: input.personName ? String(input.personName) : undefined,
    });
    return {
      obligations: rows.map((o) => ({
        id: o.id,
        direction: o.direction,
        kind: o.kind,
        person: o.personName,
        description: o.description,
        amount: o.amount,
        due: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
      })),
    };
  },
});
```

- [ ] **Step 3: `src/tools/settle-obligation.ts`** (money → ВОЗВРАЩАЕТ предложение, без записи денег)

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { settleObligation } from '../services/obligations/index.js';

export const settleObligationTool = defineTool({
  name: 'settle_obligation',
  description:
    'Закрыть обязательство (выполнено/отдано). Вызывай на «закрой долг X», ' +
    '«я отдал X», «вернули долг». Если это деньги — ПРЕДЛОЖИ записать доход/расход ' +
    '(add_income/add_expense), но НЕ записывай сам — пусть юзер подтвердит.',
  category: 'memory',
  aliases: { obligation_id: 'id' },
  schema: z.object({ id: z.string().max(64) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['закрой обязательство', 'я отдал долг Ахмету', 'вернули 500000'],
  handler: async (input, ctx) => {
    const settled = await settleObligation(ctx.userId, String(input.id));
    if (!settled) return { error: 'обязательство не найдено' };
    // money: вернуть предложение записать финансы (money-safe: только предложение).
    if (settled.kind === 'money' && settled.amount) {
      const financeAction = settled.direction === 'owed_to_me' ? 'add_income' : 'add_expense';
      return {
        ok: true,
        settled: true,
        proposeFinance: { action: financeAction, amount: settled.amount, who: settled.personName },
      };
    }
    return { ok: true, settled: true };
  },
});
```

- [ ] **Step 4: `src/tools/cancel-obligation.ts`**

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { cancelObligation } from '../services/obligations/index.js';

export const cancelObligationTool = defineTool({
  name: 'cancel_obligation',
  description: 'Отменить обязательство (больше не актуально). Вызывай на «отмени обязательство», «уже не должен».',
  category: 'memory',
  aliases: { obligation_id: 'id' },
  schema: z.object({ id: z.string().max(64) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отмени обязательство', 'это уже не актуально'],
  handler: async (input, ctx) => {
    const c = await cancelObligation(ctx.userId, String(input.id));
    if (!c) return { error: 'обязательство не найдено' };
    return { ok: true, cancelled: true };
  },
});
```

- [ ] **Step 5: Регистрация в `src/tools/index.ts` за флагом**

Найти где регистрируются v2-инструменты за флагом (grep: `isV2HermesEnabled` или `getRegistryForUser`/`buildRegistry`). По тому же паттерну добавить (показать пример — точное место сверить grep'ом):

```ts
import { createObligationTool } from './create-obligation.js';
import { listObligationsTool } from './list-obligations.js';
import { settleObligationTool } from './settle-obligation.js';
import { cancelObligationTool } from './cancel-obligation.js';
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';
// …в функции сборки реестра для userId:
if (isV2ObligationsEnabled(userId)) {
  tools.push(createObligationTool, listObligationsTool, settleObligationTool, cancelObligationTool);
}
```

- [ ] **Step 6: Структурный тест** `src/tools/obligations-tools.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('obligations tools wiring', () => {
  const idx = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');
  it('4 инструмента зарегистрированы за флагом isV2ObligationsEnabled', () => {
    expect(idx).toContain('isV2ObligationsEnabled');
    for (const t of ['createObligationTool', 'listObligationsTool', 'settleObligationTool', 'cancelObligationTool']) {
      expect(idx).toContain(t);
    }
  });
  it('settle money НЕ пишет деньги напрямую — только proposeFinance', () => {
    const settle = readFileSync(join(process.cwd(), 'src/tools/settle-obligation.ts'), 'utf-8');
    expect(settle).toContain('proposeFinance');
    expect(settle).not.toMatch(/prisma\.(income|expense)\.create/);
  });
});
```

- [ ] **Step 7: Запустить + tsc.** Run: `npm test -- obligations-tools 2>&1 | tail -5` → PASS. `npx tsc --noEmit` чисто.

- [ ] **Step 8: Commit**

```bash
git add src/tools/create-obligation.ts src/tools/list-obligations.ts src/tools/settle-obligation.ts src/tools/cancel-obligation.ts src/tools/index.ts src/tools/obligations-tools.test.ts
git commit -m "feat(obligations): 4 registry tools (create/list/settle/cancel) flag-gated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Проактивный детектор `detectObligationDue`

**Files:**
- Modify: `src/services/v2-proactivity-engine.ts`
- Test: `src/services/v2-proactivity-obligation.test.ts` (структурный)

- [ ] **Step 1: Добавить `'obligation_due'` в union `NudgeSource`** (строка ~19)

```ts
  | 'obligation_due'
```

- [ ] **Step 2: Добавить блок в `TEMPLATES`** (после `commitment_due`)

```ts
  obligation_due: {
    gentle: 'Ты обещал {{person}}: «{{description}}» — срок {{dueLabel}}. Закрыл?',
    curious: 'Как там с {{person}} — «{{description}}»? {{dueLabel}}.',
    supportive: '{{person}} ждёт «{{description}}». Срок {{dueLabel}} — напомнить или закрыть?',
  },
```

- [ ] **Step 3: Детектор** (рядом с `detectCommitmentDue`)

```ts
async function detectObligationDue(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const now = Date.now();
    const rows = await prisma.obligation.findMany({
      where: { userId, status: 'open' },
      orderBy: [{ dueDate: 'asc' }],
      take: 20,
    });
    const out: NudgeCandidate[] = [];
    for (const o of rows) {
      const due = o.dueDate ? o.dueDate.getTime() : NaN;
      const isDue = Number.isFinite(due) && due <= now;
      const ageDays = Math.floor((now - o.createdAt.getTime()) / DAY_MS);
      // Кандидат: просрочен ИЛИ висит без срока > 5 дней.
      if (!isDue && !(Number.isNaN(due) && ageDays > 5)) continue;
      const dueLabel = Number.isFinite(due)
        ? `был ${o.dueDate!.toISOString().slice(0, 10)}`
        : `висит ${ageDays} дней`;
      const cand: NudgeCandidate = {
        source: 'obligation_due',
        significance: 0,
        entityId: o.personEntityId ?? undefined,
        payload: { person: o.personName, description: o.description, dueLabel, direction: o.direction },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectObligationDue failed:', err);
    return [];
  }
}
```

- [ ] **Step 4: Зарегистрировать в `detectCandidates`** `Promise.allSettled([...])` — добавить строку `detectObligationDue(userId),`

- [ ] **Step 5: Структурный тест** `src/services/v2-proactivity-obligation.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('obligation_due detector wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
  it('источник в union + шаблон + детектор + регистрация', () => {
    expect(src).toContain("'obligation_due'");
    expect(src).toContain('obligation_due:');
    expect(src).toContain('async function detectObligationDue');
    expect(src).toMatch(/detectCandidates[\s\S]*detectObligationDue\(userId\)/);
  });
});
```

- [ ] **Step 6: Запустить + tsc.** Run: `npm test -- v2-proactivity-obligation 2>&1 | tail -5` → PASS. tsc чисто.

- [ ] **Step 7: Commit**

```bash
git add src/services/v2-proactivity-engine.ts src/services/v2-proactivity-obligation.test.ts
git commit -m "feat(obligations): detectObligationDue proactivity detector + templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Enrichment — открытые обязательства в контекст мозга

**Files:**
- Modify: `src/services/v2-enrichment.ts` (точное место — grep `formatAxesSection`/`enrich`)
- Test: `src/services/v2-enrichment-obligations.test.ts` (структурный)

- [ ] **Step 1: Добавить форматтер + вызов в enrichment** (за флагом, withTimeout)

Найти в `v2-enrichment.ts` где собираются блоки (паттерн axes/identity). Добавить:

```ts
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';
import { openObligationsForContext } from './obligations/index.js';
import { obligationLabel, type Direction } from './obligations/types.js';
import { withTimeout } from '../lib/with-timeout.js';

export function formatObligationsSection(
  rows: Array<{ direction: string; personName: string; description: string; dueDate: Date | null }>,
): string {
  if (rows.length === 0) return '';
  const lines = rows.map((o) => {
    const lbl = obligationLabel({ direction: o.direction as Direction, personName: o.personName, description: o.description });
    const due = o.dueDate ? ` (срок ${o.dueDate.toISOString().slice(0, 10)})` : '';
    return `- ${lbl}${due}`;
  });
  return `Открытые обязательства:\n${lines.join('\n')}`;
}
// …в основной функции enrich, рядом с axes:
let obligationsBlock = '';
if (isV2ObligationsEnabled(userId)) {
  const rows = await withTimeout(openObligationsForContext(userId, 5), 600, []);
  obligationsBlock = formatObligationsSection(rows);
}
// …вставить obligationsBlock в собираемый системный контекст (где axes/identity).
```

- [ ] **Step 2: Структурный тест** `src/services/v2-enrichment-obligations.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('obligations enrichment', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
  it('за флагом + withTimeout + форматтер', () => {
    expect(src).toContain('isV2ObligationsEnabled');
    expect(src).toContain('openObligationsForContext');
    expect(src).toContain('withTimeout');
    expect(src).toContain('formatObligationsSection');
  });
});
```

- [ ] **Step 3: Запустить + tsc.** Run: `npm test -- v2-enrichment-obligations 2>&1 | tail -5` → PASS. tsc чисто.

- [ ] **Step 4: Commit**

```bash
git add src/services/v2-enrichment.ts src/services/v2-enrichment-obligations.test.ts
git commit -m "feat(obligations): enrich brain context with open obligations (flag+withTimeout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Поведенческие тесты через тест-БД харнес

**Files:**
- Test: `src/services/obligations/postgres-impl.it.test.ts`

- [ ] **Step 1: Написать integration-тест**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createObligation, listObligations, settleObligation,
} from './postgres-impl.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function makeUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'O', passwordHash: 'x' } });
  return u.id;
}

describe('obligations store — реальная БД', () => {
  it('create → list(open) → settle → пропадает из open', async () => {
    const userId = await makeUser('obl-a@a.test');
    const o = await createObligation({
      userId, personName: 'Серик', direction: 'i_owe', kind: 'action',
      description: 'договор', source: 'manual',
    });
    expect((await listObligations(userId, { status: 'open' })).map((x) => x.id)).toContain(o.id);
    const settled = await settleObligation(userId, o.id);
    expect(settled?.status).toBe('done');
    expect((await listObligations(userId, { status: 'open' }))).toHaveLength(0);
  });

  it('cross-user изоляция: B не видит и не закрывает обязательство A', async () => {
    const a = await makeUser('obl-iso-a@a.test');
    const b = await makeUser('obl-iso-b@a.test');
    const o = await createObligation({
      userId: a, personName: 'Ахмет', direction: 'owed_to_me', kind: 'money',
      amount: 500000, description: 'долг', source: 'manual',
    });
    expect((await listObligations(b, { status: 'open' }))).toHaveLength(0);
    expect(await settleObligation(b, o.id)).toBeNull(); // B не закрывает чужое
    const row = await prisma.obligation.findUnique({ where: { id: o.id } });
    expect(row?.status).toBe('open'); // цело
  });
});
```

- [ ] **Step 2: Запустить через харнес.** Run: `npm run test:db:up && npm run test:it 2>&1 | grep -E "obligations|Tests "` → PASS (+ baseline 11 остаются).

- [ ] **Step 3: Commit**

```bash
git add src/services/obligations/postgres-impl.it.test.ts
git commit -m "test(obligations): behavioral create/list/settle + cross-user isolation (real DB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Telegram `/obligations` (поверхность)

**Files:**
- Modify: `src/services/telegram-bot.ts` (точное место — grep существующих команд, напр. `/axes`/`/identity`)
- Test: structural в существующем telegram-тесте или новый `src/services/telegram-obligations.test.ts`

- [ ] **Step 1: Добавить команду по паттерну `/axes`** (за флагом)

```ts
// рядом с другими bot.command(...) / onText:
bot.command('obligations', async (msg) => {
  const userId = await resolveUserIdFromChat(msg); // существующий хелпер
  if (!userId || !isV2ObligationsEnabled(userId)) return;
  const rows = await listObligations(userId, { status: 'open' });
  if (rows.length === 0) { await sendTelegramTo(msg.chat.id, 'Открытых обязательств нет.'); return; }
  const iOwe = rows.filter((o) => o.direction === 'i_owe').map((o) => `• ${o.personName} — ${o.description}`);
  const owed = rows.filter((o) => o.direction === 'owed_to_me').map((o) => `• ${o.personName} — ${o.description}`);
  const parts = [];
  if (iOwe.length) parts.push('Ты должен:\n' + iOwe.join('\n'));
  if (owed.length) parts.push('Тебе должны:\n' + owed.join('\n'));
  await sendTelegramTo(msg.chat.id, parts.join('\n\n'));
});
```
(Точные имена `resolveUserIdFromChat`/`sendTelegramTo`/форму регистрации команды — сверить
grep'ом по `telegram-bot.ts`, как у `/axes`.)

- [ ] **Step 2: Структурный тест** (`src/services/telegram-obligations.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('telegram /obligations', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf-8');
  it('команда за флагом + listObligations', () => {
    expect(src).toMatch(/obligations/);
    expect(src).toContain('isV2ObligationsEnabled');
    expect(src).toContain('listObligations');
  });
});
```

- [ ] **Step 3: Запустить + tsc.** Run: `npm test -- telegram-obligations 2>&1 | tail -5` → PASS. tsc чисто.

- [ ] **Step 4: Commit**

```bash
git add src/services/telegram-bot.ts src/services/telegram-obligations.test.ts
git commit -m "feat(obligations): /obligations Telegram command (flag-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Полная верификация + независимое ревью

**Files:** нет новых

- [ ] **Step 1: tsc + оба прогона**

Run: `npx tsc --noEmit` → чисто.
Run: `npm test 2>&1 | tail -3` → unit ~2200+ новые, все PASS.
Run: `npm run test:db:up && npm run test:it 2>&1 | tail -3` → integration (11 + obligations) PASS.

- [ ] **Step 2: Negative control (изоляция реально ловит регресс)**

Временно в `settleObligation` убрать `userId` из `findFirst where` → cross-user тест КРАСНЕЕТ → откатить → зелёный.

- [ ] **Step 3: Независимое ревью** — `pr-review-toolkit:code-reviewer` или `/code-review` по диффу обязательств (money-safety, изоляция, флаг-гейтинг, no-any).

- [ ] **Step 4: Лог итога** — фича готова, флаг OFF (байт-идентично). Push/deploy/флаг — по слову Berik.

---

## Self-Review
- **Spec coverage:** модель+миграция (T1), хелперы (T2), store (T3), флаг (T4), 4 инструмента
  +захват (T5), проактивность (T6), enrichment (T7), поведенческие тесты харнес (T8),
  поверхность бот (T9), верификация (T10). Авто-захват (extract-obligation haiku) —
  СОЗНАТЕЛЬНО отложен: ручной инструмент + проактивность дают рабочую вертикаль; авто-
  предложение добавим отдельным слайсом после доказательства ядра (YAGNI для slice 1).
- **Placeholder scan:** код в каждом шаге; «сверить grep'ом» — это локатор точки вставки
  для интеграционных правок (tools/index, enrichment, telegram), не плейсхолдер.
- **Type consistency:** `Direction`/`ObligationKind` из types.ts во всех тулзах/сторе;
  `createObligation(CreateInput)` сигнатура едина; `settleObligation`→`{status:'done'}`.
- **Money-safety:** settle money ВОЗВРАЩАЕТ `proposeFinance`, тест запрещает прямую запись.
- **Скоуп-уточнение:** авто-захват через haiku вынесен из slice 1 (см. выше) — план честно
  отражает, что строим ядро (ручной+проактивность+enrichment), а не всё сразу.

## Verification gate (вся фича)
1. `npm run test:db:up` healthy.
2. `npm run test:it` — obligations integration + baseline 11 зелёные.
3. `npm test` unit (~2200 + новые) зелёные; `npx tsc --noEmit` чисто.
4. Negative control: ломаю изоляцию settle → красный → откат → зелёный.
5. Флаг OFF → байт-идентично сегодня.
