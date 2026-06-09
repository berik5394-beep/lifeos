# Memory Graph-Integrity (T5-remainder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Остановить порчу графа за флагом `FEATURE_V2_MEM_GRAPH` (off=байт-идентично): (A) `Entity.attributes` — preserve при фоновой записи / incoming-wins при намеренной; (B) порог ранга в FTS-дедупе памяти.

**Architecture:** Чистый `mergeAttributes` + `opts.deliberate` на `upsertEntity` (инструменты передают `true`, экстракция — нет) + JS-гейт `rankOk` в дедупе `writeMemory`. Всё за одним новым флагом.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest (`npm test` unit / `npm run test:it`), zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Спека:** `docs/superpowers/specs/2026-06-09-mem-graph-integrity-design.md`.

**MAIN worktree:** все команды в `/Users/berikkurmangoliev/Desktop/LifeOS` (ветка `main`; проверка `git -C … rev-parse --abbrev-ref HEAD` → `main`). Коммит локальный; push/deploy/флаг — по слову Berik.

---

## File Structure

| Файл | Изменение | Задача |
|------|-----------|--------|
| `src/lib/feature-flags.ts` (+ `.test.ts`) | `isV2MemGraphEnabled` | 1 |
| `entity-graph/merge-helpers.ts` (+ `.test.ts`) | `mergeAttributes` pure | 2 |
| `entity-graph/types.ts` + `entity-graph/postgres-impl.ts` | `opts?` + флаг-ветка `mergeAttributes` ×2 | 3 |
| `tools/{remember-entity,set-birthday,link-relationship,set-person-type}.ts` | `{ deliberate: true }` | 4 |
| `services/episodic-memory.ts` | FTS rank-порог | 5 |
| `entity-graph/mem-graph-wiring.test.ts` (new) | структурный гард | 3,4,5 |
| `services/mem-graph.it.test.ts` (new) | интеграция | 6 |

---

### Task 1: Flag `isV2MemGraphEnabled`

**Files:** Modify `packages/server/src/lib/feature-flags.ts` + `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Failing test** — добавить в `feature-flags.test.ts` (рядом с `isV2MemQualityEnabled`-тестами):
```ts
import { isV2MemGraphEnabled } from './feature-flags.js';

describe('isV2MemGraphEnabled', () => {
  const KEY = 'FEATURE_V2_MEM_GRAPH';
  const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2MemGraphEnabled('u')).toBe(true); });
  it('unset/none/empty → false', () => {
    delete process.env[KEY]; expect(isV2MemGraphEnabled('u')).toBe(false);
    process.env[KEY] = 'none'; expect(isV2MemGraphEnabled('u')).toBe(false);
    process.env[KEY] = ''; expect(isV2MemGraphEnabled('u')).toBe(false);
  });
  it('csv user-<id>', () => { process.env[KEY] = 'user-abc'; expect(isV2MemGraphEnabled('abc')).toBe(true); expect(isV2MemGraphEnabled('z')).toBe(false); });
});
```
- [ ] **Step 2: Run (FAIL)** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/lib/feature-flags.test.ts`
- [ ] **Step 3: Implement** — в `feature-flags.ts` рядом с `isV2MemQualityEnabled`:
```ts
/**
 * Целостность графа (T5-остаток): guard на Entity.attributes (preserve при
 * фоновой / incoming-wins при намеренной) + порог ранга в FTS-дедупе.
 * OFF → байт-идентично прежнему incoming-wins / без-порога.
 */
export function isV2MemGraphEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEM_GRAPH, userId);
}
```
- [ ] **Step 4: Run (PASS)** же команда + `npx tsc --noEmit`
- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): isV2MemGraphEnabled flag (graph integrity, off=identical)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `mergeAttributes` pure helper

**Files:** Modify `packages/server/src/services/entity-graph/merge-helpers.ts` + `merge-helpers.test.ts`

- [ ] **Step 1: Failing test** — добавить в `merge-helpers.test.ts`:
```ts
import { mergeAttributes } from './merge-helpers.js';

describe('mergeAttributes (T5 graph guard)', () => {
  it('deliberate=true → incoming-wins', () => {
    expect(mergeAttributes({ relation: 'брат' }, { relation: 'знакомый' }, true)).toEqual({ relation: 'знакомый' });
  });
  it('фоновое: непустое существующее НЕ затирается', () => {
    expect(mergeAttributes({ relation: 'брат' }, { relation: 'знакомый' }, false)).toEqual({ relation: 'брат' });
  });
  it('фоновое: пустой/отсутствующий ключ заполняется', () => {
    expect(mergeAttributes({ relation: '' }, { relation: 'брат' }, false)).toEqual({ relation: 'брат' });
    expect(mergeAttributes({}, { role: 'дизайнер' }, false)).toEqual({ role: 'дизайнер' });
  });
  it('фоновое: новые ключи добавляются, старые сохраняются', () => {
    expect(mergeAttributes({ relation: 'брат' }, { city: 'Астана' }, false)).toEqual({ relation: 'брат', city: 'Астана' });
  });
  it('пустой incoming → existing неизменно', () => {
    expect(mergeAttributes({ relation: 'брат' }, {}, false)).toEqual({ relation: 'брат' });
  });
});
```
- [ ] **Step 2: Run (FAIL)** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/merge-helpers.test.ts`
- [ ] **Step 3: Implement** — в `merge-helpers.ts` (рядом с `capAliases`):
```ts
/**
 * Merge атрибутов сущности (T5).
 *  - deliberate=true (инструмент): incoming-wins (как сейчас).
 *  - deliberate=false (фоновая экстракция): не затирать непустое существующее;
 *    заполнять пустые; добавлять новые. → «брат» не сменится «знакомым».
 */
export function mergeAttributes(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  deliberate: boolean,
): Record<string, unknown> {
  if (deliberate) return { ...existing, ...incoming };
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    const cur = out[k];
    if (cur === undefined || cur === null || cur === '') out[k] = v;
  }
  return out;
}
```
- [ ] **Step 4: Run (PASS)** же + `npx tsc --noEmit`
- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/entity-graph/merge-helpers.ts packages/server/src/services/entity-graph/merge-helpers.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): mergeAttributes guard pure helper (T5 graph)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `upsertEntity` opts + флаг-ветка mergeAttributes

**Files:** Modify `entity-graph/types.ts`, `entity-graph/postgres-impl.ts`; Create `entity-graph/mem-graph-wiring.test.ts`

- [ ] **Step 1: Failing test** — создать `entity-graph/mem-graph-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const impl = readFileSync(join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'), 'utf8');

describe('T5 graph — upsertEntity attributes guard за флагом', () => {
  it('upsertEntity принимает opts.deliberate', () => {
    expect(impl).toMatch(/opts\??\s*:\s*\{\s*deliberate\?\s*:\s*boolean/);
  });
  it('обе точки merge имеют флаг-ветку mergeAttributes + OFF spread', () => {
    const on = impl.match(/isV2MemGraphEnabled\(userId\)\s*\n?\s*\?\s*mergeAttributes\(/g) || [];
    expect(on.length).toBe(2);
    const off = impl.match(/\{\s*\.\.\.\([\s\S]*?\.attributes as Record<string, unknown>\),\s*\.\.\.attributes\s*\}/g) || [];
    expect(off.length).toBeGreaterThanOrEqual(2);
  });
});
```
- [ ] **Step 2: Run (FAIL)** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts`
- [ ] **Step 3: Implement**
  3a. `entity-graph/types.ts` — в сигнатуре `upsertEntity` добавить 3-й параметр:
  ```ts
  upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
    opts?: { deliberate?: boolean },
  ): Promise<Entity>;
  ```
  3b. `entity-graph/postgres-impl.ts:86` — то же в impl-сигнатуре (`async upsertEntity(userId, entity, opts?: { deliberate?: boolean }): Promise<Entity> {`).
  3c. Импорты в `postgres-impl.ts`: добавить `mergeAttributes` к импорту из `./merge-helpers.js` (там уже `capAliases`); добавить `import { isV2MemGraphEnabled } from '../../lib/feature-flags.js';`.
  3d. Сразу после `const importance = entity.importance ?? 5;` (≈:101) добавить: `const deliberate = opts?.deliberate ?? false;`
  3e. Строка `:113` — заменить:
  ```ts
  const mergedAttributes = { ...(existing.attributes as Record<string, unknown>), ...attributes };
  ```
  на:
  ```ts
  const mergedAttributes = isV2MemGraphEnabled(userId)
    ? mergeAttributes(existing.attributes as Record<string, unknown>, attributes, deliberate)
    : { ...(existing.attributes as Record<string, unknown>), ...attributes };
  ```
  3f. Строка `:136` — то же, но `resolved.attributes`:
  ```ts
  const mergedAttributes = isV2MemGraphEnabled(userId)
    ? mergeAttributes(resolved.attributes as Record<string, unknown>, attributes, deliberate)
    : { ...(resolved.attributes as Record<string, unknown>), ...attributes };
  ```
- [ ] **Step 4: Run** целевой + полный unit + tsc: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts && npm test && npx tsc --noEmit`
- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/entity-graph/types.ts packages/server/src/services/entity-graph/postgres-impl.ts packages/server/src/services/entity-graph/mem-graph-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): upsertEntity opts.deliberate + attributes guard behind flag (T5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Проброс `deliberate: true` из инструментов

**Files:** Modify `tools/remember-entity.ts`, `tools/set-birthday.ts`, `tools/link-relationship.ts`, `tools/set-person-type.ts`; дополнить `mem-graph-wiring.test.ts`

- [ ] **Step 1: Failing test** — добавить в `mem-graph-wiring.test.ts`:
```ts
describe('T5 graph — инструменты передают deliberate:true', () => {
  const tool = (f: string) => readFileSync(join(process.cwd(), `src/tools/${f}`), 'utf8');
  it('remember-entity', () => { expect(tool('remember-entity.ts')).toMatch(/deliberate:\s*true/); });
  it('set-birthday', () => { expect(tool('set-birthday.ts')).toMatch(/deliberate:\s*true/); });
  it('link-relationship (оба upsert)', () => {
    const f = tool('link-relationship.ts');
    expect((f.match(/deliberate:\s*true/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('set-person-type', () => { expect(tool('set-person-type.ts')).toMatch(/deliberate:\s*true/); });
});
```
- [ ] **Step 2: Run (FAIL)** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts`
- [ ] **Step 3: Implement** — в каждом из 5 вызовов добавить 3-м аргументом `{ deliberate: true }`:
  - `tools/remember-entity.ts:30` — `getEntityGraph().upsertEntity(ctx.userId, { … }, { deliberate: true })`
  - `tools/set-birthday.ts:36` — то же
  - `tools/link-relationship.ts:31` и `:35` — оба вызова `graph.upsertEntity(ctx.userId, { … }, { deliberate: true })`
  - `tools/set-person-type.ts:27` — то же
  
  Прочитай каждый вызов и добавь `, { deliberate: true }` как последний аргумент `upsertEntity(...)`. Больше ничего не меняй. (Фоновые `v2-capture.ts` НЕ трогаем.)
- [ ] **Step 4: Run** целевой + полный unit + tsc: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts && npm test && npx tsc --noEmit`
- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/remember-entity.ts packages/server/src/tools/set-birthday.ts packages/server/src/tools/link-relationship.ts packages/server/src/tools/set-person-type.ts packages/server/src/services/entity-graph/mem-graph-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): entity tools pass deliberate:true (explicit corrections win) (T5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: FTS rank-порог в дедупе памяти

**Files:** Modify `services/episodic-memory.ts`; дополнить `mem-graph-wiring.test.ts`

- [ ] **Step 1: Failing test** — добавить в `mem-graph-wiring.test.ts`:
```ts
describe('T5 graph — FTS rank-порог в дедупе writeMemory', () => {
  const epi = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('константа MEM_DEDUP_MIN_RANK', () => { expect(epi).toMatch(/MEM_DEDUP_MIN_RANK\s*=\s*0\.05/); });
  it('rank в SELECT дедупа', () => { expect(epi).toMatch(/ts_rank\([\s\S]*?\)\s+AS rank/); });
  it('rankOk гейт за флагом', () => {
    expect(epi).toMatch(/isV2MemGraphEnabled\(userId\)/);
    expect(epi).toMatch(/rankOk/);
  });
});
```
- [ ] **Step 2: Run (FAIL)** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts`
- [ ] **Step 3: Implement** в `episodic-memory.ts`:
  3a. Импорт: добавить `isV2MemGraphEnabled` к существующему импорту из `../lib/feature-flags.js` (рядом с `isV2MemQualityEnabled`).
  3b. Константа рядом с `STABLE_TYPES` (≈:114): `const MEM_DEDUP_MIN_RANK = 0.05;`
  3c. В дедуп-`$queryRaw` (≈:176-189): расширить тип результата на `rank: number` и добавить в SELECT столбец ранга. Текущее:
  ```ts
  const dup = await prisma.$queryRaw<
    Array<{ id: string; importance: number; tags: string[]; details: string | null }>
  >`
    SELECT m.id, m.importance, m.tags, m.details
    FROM "Memory" m
    WHERE m."userId" = ${userId}
      AND m.type = ${input.type}
      AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${content})
    ORDER BY ts_rank(
      to_tsvector('russian', coalesce(m.content, '')),
      plainto_tsquery('russian', ${content})
    ) DESC
    LIMIT 1;
  `;
  ```
  заменить на (добавлен `rank` в тип и в SELECT):
  ```ts
  const dup = await prisma.$queryRaw<
    Array<{ id: string; importance: number; tags: string[]; details: string | null; rank: number }>
  >`
    SELECT m.id, m.importance, m.tags, m.details,
      ts_rank(
        to_tsvector('russian', coalesce(m.content, '')),
        plainto_tsquery('russian', ${content})
      ) AS rank
    FROM "Memory" m
    WHERE m."userId" = ${userId}
      AND m.type = ${input.type}
      AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${content})
    ORDER BY ts_rank(
      to_tsvector('russian', coalesce(m.content, '')),
      plainto_tsquery('russian', ${content})
    ) DESC
    LIMIT 1;
  `;
  ```
  3d. Обернуть существующую update-ветку гейтом `rankOk`. Текущее `if (dup.length > 0) { const existing = dup[0]; …update…; return { id: existing.id, action: 'updated' }; }` → добавить:
  ```ts
  if (dup.length > 0) {
    const existing = dup[0];
    const rankOk = !isV2MemGraphEnabled(userId) || (existing.rank ?? 1) > MEM_DEDUP_MIN_RANK;
    if (rankOk) {
      // …существующая update-логика без изменений…
      return { id: existing.id, action: 'updated' };
    }
    // on + слабый матч → проваливаемся в create ниже
  }
  ```
  (Existing update-логика — мерж tags/details/importance + `prisma.memory.update` + `storeMemoryEmbedding` — переносится ВНУТРЬ `if (rankOk)` без правок.)
- [ ] **Step 4: Run** целевой + полный unit + tsc: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project unit src/services/entity-graph/mem-graph-wiring.test.ts && npm test && npx tsc --noEmit`
- [ ] **Step 5: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/episodic-memory.ts packages/server/src/services/entity-graph/mem-graph-wiring.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): FTS dedup rank threshold in writeMemory behind flag (T5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Integration tests

**Files:** Create `services/mem-graph.it.test.ts`

> Образец harness — `memory-tier2.it.test.ts` (own `new PrismaClient()`, `mkUser`, setup.ts resetDb per test). Сверься с ним для точного prisma + полей User/Entity/Memory.

- [ ] **Step 1: Tests** — `npm run test:db:up` затем создать `services/mem-graph.it.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { writeMemory } from './episodic-memory.js';

const prisma = new PrismaClient();
const PREV = process.env.FEATURE_V2_MEM_GRAPH;
afterAll(async () => {
  if (PREV === undefined) delete process.env.FEATURE_V2_MEM_GRAPH; else process.env.FEATURE_V2_MEM_GRAPH = PREV;
  await prisma.$disconnect();
});
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-memgraph-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('T5 attributes — фоновое preserve, намеренное overwrite', () => {
  it('фоновый upsert НЕ затирает «брат» «знакомым»; deliberate затирает', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'all';
    const uid = await mkUser(`attr-${Date.now()}`);
    const g = getEntityGraph();
    await g.upsertEntity(uid, { type: 'person', name: 'Серик', attributes: { relation: 'брат' } });
    await g.upsertEntity(uid, { type: 'person', name: 'Серик', attributes: { relation: 'знакомый' } }); // фоновое
    let e = await prisma.entity.findFirst({ where: { userId: uid, type: 'person', name: 'Серик' } });
    expect((e!.attributes as Record<string, unknown>).relation).toBe('брат'); // preserve

    await g.upsertEntity(uid, { type: 'person', name: 'Серик', attributes: { relation: 'коллега' } }, { deliberate: true });
    e = await prisma.entity.findFirst({ where: { userId: uid, type: 'person', name: 'Серик' } });
    expect((e!.attributes as Record<string, unknown>).relation).toBe('коллега'); // deliberate overwrite
  });
});

describe('T5 FTS-порог — слабый матч не клобберит чужую память', () => {
  it('слабый общий токен → новая запись, не обновление чужой', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'all';
    const uid = await mkUser(`fts-${Date.now()}`);
    await writeMemory(uid, { type: 'fact', content: 'Серик переехал в Астану в новую квартиру', importance: 6 });
    await writeMemory(uid, { type: 'fact', content: 'Купил новую машину', importance: 6 }); // слабый общий токен «новую»
    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'fact' } });
    expect(rows.length).toBe(2); // НЕ слилось по слабому матчу
  });
});
```
> Если поля Entity/Memory в схеме требуют большего (NOT NULL) — добавь минимально, сверяясь со `schema.prisma`. Имена/токены при необходимости подбери так, чтобы реально дать слабый-но-ненулевой FTS-матч (один общий токен) — проверь по факту.

- [ ] **Step 2: Run** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run --project integration src/services/mem-graph.it.test.ts` — 2 PASS. Красное → Phase-1 systematic-debugging (почини тест/сетап, НЕ прод-логику); инфра-блок → STATUS BLOCKED.
- [ ] **Step 3: Commit**
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/mem-graph.it.test.ts && git commit -m "$(cat <<'EOF'
test(memory): graph-integrity it — attributes preserve/deliberate, FTS threshold

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Полный verify + независимое ревью

- [ ] **Step 1** `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npm test && npx tsc --noEmit` — ~2635+ unit зелёных, tsc clean.
- [ ] **Step 2** `npm run test:it` — зелёно (вкл. новый it).
- [ ] **Step 3: OFF-идентичность** — перечитать diff: 3 точки (attributes ×2, FTS) имеют OFF-ветку == прежний код (`{...,...attributes}`; `rankOk` всегда true без флага).
- [ ] **Step 4: Независимое ревью** (code-reviewer субагент). Фокус: off=байт-идентично ×3; `deliberate` проброшен только в 5 инструментах (не в экстракции); FTS-порог не ломает сильный матч (тот же факт всё ещё дедупится); preserve-логика `mergeAttributes` (пустой fill, непустой preserve); нет `any`/ESM/`vi.mock`.
- [ ] **Step 5: Fix findings + финальный commit** (если есть).
- [ ] **Step 6: СТОП** — доложить Berik. Не пушить. Предложить push+deploy+`FEATURE_V2_MEM_GRAPH=all` по слову.

---

## Self-Review
- **Покрытие спеки:** A attributes (Task 2+3+4), B FTS (Task 5), флаг (Task 1), тесты (Task 6), verify (Task 7). Все юниты покрыты.
- **Заглушки:** код полный; команды точные; 2 «свериться с образцом» (схема в it-тесте; точный текст 5 tool-вызовов) — явная сверка с реальным файлом, не выдуманные символы.
- **Типы:** `mergeAttributes(Record,Record,boolean)→Record`; `opts?:{deliberate?:boolean}` в interface+impl+5 call-site; `rank:number` в dup-типе; `isV2MemGraphEnabled(userId)` везде.
- **Порядок:** чистые (1,2) → врезки за флагом (3,4,5) → интеграция (6) → verify (7). Каждый шаг компилируется/коммитится сам.

## Execution Handoff
Subagent-Driven (как в Tier-2): свежий субагент на задачу, ревью между. push/deploy/флаг — по слову Berik.
