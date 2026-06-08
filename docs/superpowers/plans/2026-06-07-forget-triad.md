# Забывание-троица (F1/F3/F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Goal:** Сырые `message` не лезут в recall (F1), ридер чтит `invalidAt` (F3), дедуп не сбрасывает `createdAt` (F5) — за флагом `FEATURE_V2_FORGET`, off=байт-идентично.

**Architecture:** Ридер `getRelevantMemories` (3 пути) и писатель `writeMemory` (дедуп-update) флаг-гейтят 3 правки. off → SQL/поведение байт-идентичны сегодняшним. Без миграции.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict (no any), vitest (zero vi.mock). Baseline ~2707 unit зелёный. Commit-per-step + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push/deploy/флаг — по слову Berik.

**Несущие факты (проверены чтением + прод):** `getRelevantMemories` (memory-service.ts:121) 3 пути: findMany `:130-138`, hybrid `$queryRawUnsafe :149-178`, fallback `$queryRaw :185-216` — все фильтруют только expiresAt; recency по `m."createdAt"`. `writeMemory` дедуп-update (episodic-memory.ts:206-215) ставит `createdAt: new Date()` (:213). Флаг-образец `isV2BirthdayEnabled` (feature-flags.ts:66). Прод Berik: message=62/204, invalidAt_set=0.

---

## File Structure
| Файл | Действие | Ответственность |
|---|---|---|
| `src/lib/feature-flags.ts` | Modify | `isV2ForgetEnabled` (копия birthday). |
| `src/lib/feature-flags.test.ts` | Modify | Юнит флага. |
| `src/services/memory-service.ts` | Modify | F1+F3: ридер 3 пути флаг-гейт. |
| `src/services/episodic-memory.ts` | Modify | F5: дедуп не сбрасывает createdAt под флагом. |
| `src/services/forget-triad.it.test.ts` | Create | real prisma: recall-исключение + createdAt. |
| `src/services/forget-triad-wiring.test.ts` | Create | структурный гард. |

---

## Task 1: Флаг `isV2ForgetEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `feature-flags.test.ts`

- [ ] **Step 1: Failing test** — в `feature-flags.test.ts`:
```typescript
import { isV2ForgetEnabled } from './feature-flags.js';
describe('isV2ForgetEnabled', () => {
  const KEY = 'FEATURE_V2_FORGET'; const orig = process.env[KEY];
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
  it('unset → false', () => { delete process.env[KEY]; expect(isV2ForgetEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2ForgetEnabled('u1')).toBe(true); });
  it('none/false/empty → false', () => { for (const v of ['none','false','']) { process.env[KEY]=v; expect(isV2ForgetEnabled('u1')).toBe(false); } });
  it('csv', () => { process.env[KEY]='user-u1'; expect(isV2ForgetEnabled('u1')).toBe(true); expect(isV2ForgetEnabled('u2')).toBe(false); });
});
```
- [ ] **Step 2: Run → fail.** `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t isV2ForgetEnabled`.
- [ ] **Step 3: Implement** — в `feature-flags.ts` рядом с `isV2BirthdayEnabled`:
```typescript
/** Забывание-троица (F1/F3/F5): message вне recall, ридер чтит invalidAt, дедуп не сбрасывает createdAt. */
export function isV2ForgetEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_FORGET;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: tsc + commit** (`feat(forget): флаг isV2ForgetEnabled (F1/F3/F5, Task1)`).

---

## Task 2: F1+F3 — ридер `getRelevantMemories` (3 пути) флаг-гейт (CRITICAL — прод chat-ридер)

**Files:** Modify `src/services/memory-service.ts`; Create `src/services/forget-triad.it.test.ts`

- [ ] **Step 1: it-тест** — `forget-triad.it.test.ts`:
```typescript
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRelevantMemories } from './memory-service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const KEY = 'FEATURE_V2_FORGET'; const orig = process.env[KEY];
afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
async function mkUser(email: string) { const u = await prisma.user.create({ data: { email, name: 'FG', passwordHash: 'x', timezone: 'Asia/Almaty' } }); return u.id; }

describe('getRelevantMemories — F1+F3 forget-gate', () => {
  it('flag ON: message исключён, invalidAt-запись скрыта, активный факт виден', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`fg-on-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'привет как дела здоровье', importance: 5, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'старый факт про здоровье', importance: 5, source: 'v2-episodic', invalidAt: new Date(Date.now() - 1000) } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'активный факт про здоровье', importance: 5, source: 'v2-episodic' } });
    const rows = await getRelevantMemories(u, 'здоровье', 20);
    const contents = rows.map((r) => r.content);
    expect(contents.some((c) => c.includes('активный факт'))).toBe(true);
    expect(rows.some((r) => r.type === 'message')).toBe(false);
    expect(contents.some((c) => c.includes('старый факт'))).toBe(false); // invalidAt honored
  });
  it('flag OFF: байт-идентично — message И invalidAt-запись возвращаются (invalidAt игнорится)', async () => {
    delete process.env[KEY];
    const u = await mkUser(`fg-off-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'сообщение про спорт', importance: 5, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'инвалид факт про спорт', importance: 5, source: 'v2-episodic', invalidAt: new Date(Date.now() - 1000) } });
    const rows = await getRelevantMemories(u, 'спорт', 20);
    expect(rows.some((r) => r.type === 'message')).toBe(true);
    expect(rows.some((r) => r.content.includes('инвалид факт'))).toBe(true);
  });
});
```
- [ ] **Step 2: Run → fail** (ON-кейс: message/invalid сейчас возвращаются). `npx vitest run --project integration src/services/forget-triad.it.test.ts`.
- [ ] **Step 3: Implement** — `memory-service.ts`. Импорт: `import { isV2ForgetEnabled } from '../lib/feature-flags.js';` (+ `import { Prisma } from '@prisma/client';` если нет). В начале `getRelevantMemories` после `const now = new Date();`:
```typescript
  const forget = isV2ForgetEnabled(userId);
  const forgetSql = forget
    ? `AND m.type <> 'message' AND (m."invalidAt" IS NULL OR m."invalidAt" > NOW())`
    : '';
```
**(a) findMany (no-query, `:130`):** замени литерал-where на собранный:
```typescript
    const where: Prisma.MemoryWhereInput = { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    if (forget) {
      where.type = { not: 'message' };
      where.AND = [{ OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] }];
    }
    const rows = await prisma.memory.findMany({ where, orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }], take: limit, select: { type: true, content: true, importance: true } });
```
**(b) hybrid (`$queryRawUnsafe`, `:149`):** в SQL после строки `AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())` добавь `\n          ${forgetSql}`.
**(c) fallback (`$queryRaw` tagged, `:185`):** конвертируй в `$queryRawUnsafe` (параметры $1 userId, $2 query, $3 limit), вставь `${forgetSql}` после expiresAt-WHERE:
```typescript
    const result = await prisma.$queryRawUnsafe<MemoryRow[]>(
      `SELECT m.type, m.content, m.importance
       FROM "Memory" m
       WHERE m."userId" = $1
         AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
         ${forgetSql}
       ORDER BY (
         ts_rank(to_tsvector('russian', coalesce(m.content,'') || ' ' || coalesce(m.details,'') || ' ' || coalesce(array_to_string(m.tags,' '),'')), plainto_tsquery('russian', $2)) * 5.0
         + (m.importance::float / 10.0)
         + exp(- extract(epoch from (NOW() - m."createdAt")) / (86400.0 * 30.0))
       ) DESC, m.importance DESC, m."createdAt" DESC
       LIMIT $3;`,
      userId, query, limit,
    );
    return result;
```
- [ ] **Step 4: Run → pass** (ON: исключает message+invalid; OFF: возвращает оба).
- [ ] **Step 5: tsc + commit** (`feat(forget): ридер исключает message + чтит invalidAt за флагом (F1+F3, Task2)`).

---

## Task 3: F5 — писатель не сбрасывает `createdAt` под флагом

**Files:** Modify `src/services/episodic-memory.ts`; Modify `src/services/forget-triad.it.test.ts`

- [ ] **Step 1: it-тест** — добавь в `forget-triad.it.test.ts`:
```typescript
import { writeMemory } from './episodic-memory.js';
describe('writeMemory — F5 createdAt forget-gate', () => {
  it('flag ON: дедуп-update НЕ сбрасывает createdAt', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`fg-f5on-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'люблю бегать по утрам', importance: 5 });
    const before = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    await new Promise((res) => setTimeout(res, 20));
    await writeMemory(u, { type: 'fact', content: 'люблю бегать по утрам каждый день', importance: 5 }); // дедуп-hit
    const after = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    expect(after?.createdAt.getTime()).toBe(before?.createdAt.getTime());
  });
  it('flag OFF: дедуп-update сбрасывает createdAt (как сейчас)', async () => {
    delete process.env[KEY];
    const u = await mkUser(`fg-f5off-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'пью кофе по утрам', importance: 5 });
    const before = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    await new Promise((res) => setTimeout(res, 20));
    await writeMemory(u, { type: 'fact', content: 'пью кофе по утрам всегда', importance: 5 });
    const after = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    expect(after!.createdAt.getTime()).toBeGreaterThan(before!.createdAt.getTime());
  });
});
```
- [ ] **Step 2: Run → fail** (ON-кейс: createdAt сейчас сбрасывается).
- [ ] **Step 3: Implement** — `episodic-memory.ts`. Импорт `import { isV2ForgetEnabled } from '../lib/feature-flags.js';` (если нет). В дедуп-update (`:206-215`) замени блок `data:` на собранный:
```typescript
        const updateData: Prisma.MemoryUpdateInput = {
          content: newContent,
          details: merged,
          tags: mergedTags,
          importance: Math.max(existing.importance, importance),
        };
        // F5: при forget НЕ освежаем createdAt (старьё не всплывает в recency);
        // off — освежаем как сегодня (байт-идентично).
        if (!isV2ForgetEnabled(userId)) {
          updateData.createdAt = new Date();
        }
        await prisma.memory.update({ where: { id: existing.id }, data: updateData });
```
(`Prisma` уже импортирован в файле; если нет — добавь.)
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: tsc + commit** (`feat(forget): дедуп не сбрасывает createdAt под флагом (F5, Task3)`).

---

## Task 4: Структурный гард + verify + независимое ревью

**Files:** Create `src/services/forget-triad-wiring.test.ts`

- [ ] **Step 1: Структурный тест:**
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const READER = readFileSync(join(__dirname, 'memory-service.ts'), 'utf8');
const WRITER = readFileSync(join(__dirname, 'episodic-memory.ts'), 'utf8');
describe('forget-triad wiring (гард)', () => {
  it('ридер флаг-гейтит message + invalidAt', () => {
    expect(READER).toContain('isV2ForgetEnabled');
    expect(READER).toContain("m.type <> 'message'");
    expect(READER).toContain('invalidAt');
  });
  it('писатель гейтит createdAt под флагом', () => {
    expect(WRITER).toContain('isV2ForgetEnabled');
    expect(WRITER).toMatch(/if \(!isV2ForgetEnabled\(userId\)\)/);
  });
});
```
- [ ] **Step 2: Run → pass.**
- [ ] **Step 3: Полный verify** `npx tsc --noEmit && npx vitest run` (~2707+ зелёные) + `npx vitest run --project integration` (+ forget-triad.it зелёные).
- [ ] **Step 4: commit** (`test(forget): структурный гард + verify (Task4)`).
- [ ] **Step 5: Независимое ревью** (`pr-review-toolkit:code-reviewer`) на дифф. Фокус:
  - **off=байт-идентично:** forget off → `forgetSql=''`, findMany-where без доп.условий, createdAt сбрасывается — SQL/поведение как сегодня (it-тесты OFF-кейсов).
  - **прод chat-ридер:** 3 пути getRelevantMemories согласованы (findMany + hybrid + fallback все гейтят одинаково); fallback-конверсия в $queryRawUnsafe сохранила параметры/recency.
  - **нет SQL-инъекции:** `forgetSql` — литерал (не из user-данных).
  - **F3 семантика:** `invalidAt IS NULL OR invalidAt > NOW()` (активный); no-op сейчас (0 invalid-записей в проде).
  - 0 блокеров → доклад Berik + предложить push/deploy + флаг (по слову; сразу all, off-safe доказан).

---

## Self-Review (выполнено)
**Spec coverage:** F1 (message-exclude ридер) ✓ Task2; F3 (invalidAt ридер) ✓ Task2; F5 (createdAt писатель) ✓ Task3; флаг ✓ Task1. **off=байт-идентично:** OFF-кейсы it-тестов в Task2+Task3 ✓. **Placeholder scan:** полный код. **Type consistency:** `isV2ForgetEnabled`/`FEATURE_V2_FORGET`/`forgetSql`/`forget` едины во всех задачах; `Prisma.MemoryWhereInput`/`MemoryUpdateInput` корректны.
