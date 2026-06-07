# Entity Coreference (resolve-then-merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Goal:** Перестать дробить одну реальную сущность на дубли по падежам/вариантам имени — подключить готовый `resolveEntity` в путь записи `upsertEntity` (resolve-then-merge), экстрактор выдаёт алиасы, бэкфилл сливает накопленное.

**Architecture:** READ-then-MERGE на записи. `upsertEntity`: точный матч (как сейчас) → иначе `resolveForMerge` (FTS имя+алиасы принять, эмбеддинг принять только при `dist ≤ MERGE_MAX_COSINE_DIST`) → нашёл: слить + добавить форму имени в `aliases`; не нашёл: создать. За флагом `FEATURE_V2_ENTITY_RESOLVE`, **off=байт-идентично** (incomingAliases форсятся `[]`, resolveForMerge не зовётся). Экстрактор добавляет `aliases` для НЕ-морфологических вариантов. Бэкфилл — новый проход S3 в `dedup-entities`. **Без миграции** (колонка `aliases String[]` уже есть).

**Tech Stack:** Fastify + Prisma6 + Postgres/pgvector, ESM `.js`, TS strict (no any), vitest (zero vi.mock). Baseline ~2666 unit зелёный. Commit-per-step + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push/deploy/флаг/`--apply` — ТОЛЬКО по слову Berik.

**Несущие факты (проверены чтением):** `Entity` @@unique([userId,type,name]); `aliases String[] @default([])`; `embedding vector(512)`. `resolveEntity` (postgres-impl.ts:142) построен, НЕ имеет живых вызовов. `upsertEntity` (postgres-impl.ts:74). `storeEntityEmbedding(id,name,aliases)`, `embeddingsEnabled()`, `toVectorLiteral()`, `embedQuery` (из `../embeddings.js`) уже в файле. Флаг-образец `isV2BirthdayEnabled` (feature-flags.ts:66). Капча-цикл v2-capture.ts:57-72 строит `input` и условно кладёт `attributes` — `aliases` встанет тем же приёмом.

---

## File Structure
| Файл | Действие | Ответственность |
|---|---|---|
| `src/lib/feature-flags.ts` | Modify | `isV2EntityResolveEnabled` (копия birthday). |
| `src/services/entity-graph/merge-helpers.ts` | Create | Чистые: `MERGE_MAX_COSINE_DIST`, `shouldMergeByEmbedding`, `capAliases`. |
| `src/services/entity-graph/merge-helpers.test.ts` | Create | Юнит pure. |
| `src/services/entity-graph/postgres-impl.ts` | Modify | `resolveForMerge` метод + `upsertEntity` resolve-then-merge. |
| `src/services/entity-graph/types.ts` | Modify | `resolveForMerge` в интерфейс. |
| `src/services/entity-graph/postgres-impl.test.ts` | Modify | Структурный гард resolveForMerge + upsertEntity. |
| `src/services/entity-graph/entity-coreference.it.test.ts` | Create | real prisma: resolveForMerge + upsertEntity merge/off. |
| `src/services/entity-extractor.ts` | Modify | `aliases` в типе + промпте + parse + normalize. |
| `src/services/entity-extractor.test.ts` | Modify | Юнит aliases. |
| `src/services/v2-capture.ts` | Modify | Проброс `aliases` в upsertEntity. |
| `src/services/entity-coreference-wiring.test.ts` | Create | Структурный гард связки. |
| `scripts/dedup-entities.ts` | Modify | Проход S3 resolve-based (Фаза 2). |
| `src/scripts/dedup-entities.test.ts` | Modify | S3 pair-finder + merge FK (Фаза 2). |

**Скоуп:** ФАЗА 1 = Task 1-7 (going-forward, флаг). ФАЗА 2 = Task 8-9 (бэкфилл, `--apply` по слову Berik).

---

## ФАЗА 1

## Task 1: Флаг `isV2EntityResolveEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Failing test** — в `feature-flags.test.ts` добавь:

```typescript
import { isV2EntityResolveEnabled } from './feature-flags.js';

describe('isV2EntityResolveEnabled', () => {
  const KEY = 'FEATURE_V2_ENTITY_RESOLVE';
  const orig = process.env[KEY];
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
  it('unset → false', () => { delete process.env[KEY]; expect(isV2EntityResolveEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2EntityResolveEnabled('u1')).toBe(true); });
  it('none/false/empty → false', () => {
    for (const v of ['none', 'false', '']) { process.env[KEY] = v; expect(isV2EntityResolveEnabled('u1')).toBe(false); }
  });
  it('csv matches only listed user', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2EntityResolveEnabled('u1')).toBe(true);
    expect(isV2EntityResolveEnabled('u3')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail.** `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t "isV2EntityResolveEnabled"`. Expected: FAIL (not exported).

- [ ] **Step 3: Implement** — в `feature-flags.ts` рядом с `isV2BirthdayEnabled`:

```typescript
/**
 * Entity coreference resolve-then-merge (T1, память-качество №1).
 * Same shape as isV2BirthdayEnabled.
 */
export function isV2EntityResolveEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENTITY_RESOLVE;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(entity-coreference): флаг isV2EntityResolveEnabled (T1, Task1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Чистые хелперы `merge-helpers.ts`

**Files:** Create `src/services/entity-graph/merge-helpers.ts`, `merge-helpers.test.ts`

- [ ] **Step 1: Failing test** — `merge-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldMergeByEmbedding, capAliases, MERGE_MAX_COSINE_DIST } from './merge-helpers.js';

describe('shouldMergeByEmbedding', () => {
  it('dist ниже порога → true', () => { expect(shouldMergeByEmbedding(0.05, 0.12)).toBe(true); });
  it('dist равно порогу → true', () => { expect(shouldMergeByEmbedding(0.12, 0.12)).toBe(true); });
  it('dist выше порога → false', () => { expect(shouldMergeByEmbedding(0.13, 0.12)).toBe(false); });
  it('NaN/Infinity → false', () => {
    expect(shouldMergeByEmbedding(NaN, 0.12)).toBe(false);
    expect(shouldMergeByEmbedding(Infinity, 0.12)).toBe(false);
  });
  it('дефолтный порог из MERGE_MAX_COSINE_DIST', () => {
    expect(shouldMergeByEmbedding(MERGE_MAX_COSINE_DIST)).toBe(true);
    expect(shouldMergeByEmbedding(MERGE_MAX_COSINE_DIST + 0.001)).toBe(false);
  });
});

describe('capAliases', () => {
  it('дедуп case-insensitive, сохраняет первую форму', () => {
    expect(capAliases(['Серик', 'серик', 'Сериком'])).toEqual(['Серик', 'Сериком']);
  });
  it('тримит, дропает пустые', () => {
    expect(capAliases(['  Роза  ', '', '   '])).toEqual(['Роза']);
  });
  it('кап по количеству (max=2)', () => {
    expect(capAliases(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
  it('кап по длине (maxLen=3)', () => {
    expect(capAliases(['абвгд'], 20, 3)).toEqual(['абв']);
  });
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run src/services/entity-graph/merge-helpers.test.ts`.

- [ ] **Step 3: Implement** — `merge-helpers.ts`:

```typescript
/**
 * Чистые хелперы склейки сущностей (T1). Без I/O.
 */

function readMaxDist(): number {
  const raw = process.env.ENTITY_MERGE_MAX_COSINE_DIST;
  if (raw === undefined) return 0.12;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.12;
}

/** Порог cosine-distance для merge по эмбеддингу (env ENTITY_MERGE_MAX_COSINE_DIST, дефолт 0.12 ≈ sim 0.88). */
export const MERGE_MAX_COSINE_DIST = readMaxDist();

/** Принять merge по эмбеддингу ТОЛЬКО если дистанция конечна и ≤ порога. */
export function shouldMergeByEmbedding(dist: number, maxDist: number = MERGE_MAX_COSINE_DIST): boolean {
  return Number.isFinite(dist) && dist <= maxDist;
}

/** Нормализовать список алиасов: трим, дроп пустых, case-insensitive дедуп (первая форма), кап кол-ва и длины. */
export function capAliases(aliases: string[], max = 20, maxLen = 255): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    const v = (a ?? '').trim().slice(0, maxLen);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: tsc + commit** (`feat(entity-coreference): чистые хелперы shouldMergeByEmbedding + capAliases (Task2)`).

---

## Task 3: `resolveForMerge` метод

**Files:** Modify `src/services/entity-graph/postgres-impl.ts`, `types.ts`, `postgres-impl.test.ts`; Create `entity-coreference.it.test.ts`

- [ ] **Step 1: Структурный failing test** — в `postgres-impl.test.ts` добавь:

```typescript
describe('postgres-impl.ts structural — resolveForMerge (T1)', () => {
  it('resolveForMerge экспортирован как async метод', () => {
    expect(SRC).toMatch(/async resolveForMerge\s*\(/);
  });
  it('Tier3 эмбеддинг за порогом shouldMergeByEmbedding + SELECT dist', () => {
    const start = SRC.indexOf('async resolveForMerge');
    const body = SRC.slice(start, start + 1600);
    expect(body).toContain('shouldMergeByEmbedding');
    expect(body).toContain('AS dist');
  });
});
```
(`SRC = readFileSync(join(__dirname, 'postgres-impl.ts'), 'utf8')` уже есть в шапке файла.)

- [ ] **Step 2: Run → fail.** `npx vitest run src/services/entity-graph/postgres-impl.test.ts -t resolveForMerge`.

- [ ] **Step 3a: import** — в шапке `postgres-impl.ts` добавь:

```typescript
import { shouldMergeByEmbedding } from './merge-helpers.js';
```

- [ ] **Step 3b: метод** — в классе `PostgresEntityGraph`, сразу ПОСЛЕ `resolveEntity` (после строки `return null; }` его тела, ~:200):

```typescript
  // -------------------------------------------------------------------------
  // resolveForMerge — как resolveEntity, но эмбеддинг-тир за ПОРОГОМ (для записи).
  // Tier1/2 (FTS имя/алиасы) высокоточные — принять; Tier3 — только dist ≤ порог.
  // type обязателен (склеиваем только однотипные). Best-effort → null.
  // -------------------------------------------------------------------------
  async resolveForMerge(userId: string, mention: string, type: string): Promise<Entity | null> {
    const mentionClean = mention.trim().slice(0, 255);
    if (!mentionClean) return null;
    const typeFilter = `AND e.type = '${type.replace(/'/g, "''")}'`;
    try {
      // Tier 1: FTS по имени (russian-стеммер ловит склонения).
      const nameFts = await prisma.$queryRawUnsafe<Entity[]>(
        `SELECT e.*
         FROM "Entity" e
         WHERE e."userId" = $1
           AND to_tsvector('russian', e.name) @@ plainto_tsquery('russian', $2)
           ${typeFilter}
         ORDER BY ts_rank(to_tsvector('russian', e.name), plainto_tsquery('russian', $2)) DESC
         LIMIT 1`,
        userId,
        mentionClean,
      );
      if (nameFts.length > 0) return nameFts[0];

      // Tier 2: FTS по алиасам.
      const aliasFts = await prisma.$queryRawUnsafe<Entity[]>(
        `SELECT DISTINCT e.*
         FROM "Entity" e, unnest(e.aliases) AS alias_val
         WHERE e."userId" = $1
           AND to_tsvector('russian', alias_val) @@ plainto_tsquery('russian', $2)
           ${typeFilter}
         ORDER BY e.importance DESC
         LIMIT 1`,
        userId,
        mentionClean,
      );
      if (aliasFts.length > 0) return aliasFts[0];

      // Tier 3: эмбеддинг — принять ТОЛЬКО при dist ≤ порога.
      if (embeddingsEnabled()) {
        const { embedQuery } = await import('../embeddings.js');
        const qvec = await embedQuery(mentionClean);
        if (qvec) {
          const vecLit = toVectorLiteral(qvec);
          const rows = await prisma.$queryRawUnsafe<Array<Entity & { dist: number }>>(
            `SELECT e.*, (e.embedding <=> $2::vector) AS dist
             FROM "Entity" e
             WHERE e."userId" = $1 AND e.embedding IS NOT NULL ${typeFilter}
             ORDER BY e.embedding <=> $2::vector
             LIMIT 1`,
            userId,
            vecLit,
          );
          if (rows.length > 0 && shouldMergeByEmbedding(Number(rows[0].dist))) {
            const { dist: _dist, ...ent } = rows[0];
            return ent as Entity;
          }
        }
      }
      return null;
    } catch (err) {
      console.warn('[entity-graph] resolveForMerge failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
```

- [ ] **Step 3c: интерфейс** — в `types.ts` рядом с `resolveEntity(...)`:

```typescript
  resolveForMerge(userId: string, mention: string, type: string): Promise<Entity | null>;
```

- [ ] **Step 4: it-тест** — `entity-coreference.it.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from './postgres-impl.js';

const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
afterAll(() => prisma.$disconnect());

const KEY = 'FEATURE_V2_ENTITY_RESOLVE';
const orig = process.env[KEY];
afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'EC', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('resolveForMerge — real prisma', () => {
  it('Tier2: вариант в алиасах находит сущность', async () => {
    const u = await mkUser(`ec-r2-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', aliases: ['Серый'] } });
    const hit = await graph.resolveForMerge(u, 'Серый', 'person');
    expect(hit?.name).toBe('Серик');
  });
  it('нет совпадения → null', async () => {
    const u = await mkUser(`ec-null-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик' } });
    expect(await graph.resolveForMerge(u, 'Айбек', 'person')).toBeNull();
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser(`ec-iso-a-${Date.now()}@a.test`);
    const b = await mkUser(`ec-iso-b-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Бекзат', aliases: ['Бека'] } });
    expect(await graph.resolveForMerge(b, 'Бека', 'person')).toBeNull();
  });
  it('type-filtered: другой тип не матчит', async () => {
    const u = await mkUser(`ec-type-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'organization', name: 'Каспи', aliases: ['Kaspi'] } });
    expect(await graph.resolveForMerge(u, 'Kaspi', 'person')).toBeNull();
  });
});
```
Note: Tier1 (russian-стеммер на склонениях) проверяется поведенчески в Task 4 через upsertEntity; здесь детерминированно тестируем Tier2/null/изоляцию/type. Если в окружении `embeddingsEnabled()` ложно — Tier3 пропускается (ожидаемо).

- [ ] **Step 5: Run → pass.** `npx vitest run src/services/entity-graph/postgres-impl.test.ts` + `npx vitest run --project integration src/services/entity-graph/entity-coreference.it.test.ts`.

- [ ] **Step 6: tsc + commit** (`feat(entity-coreference): resolveForMerge — FTS+эмбеддинг-с-порогом (Task3)`).

---

## Task 4: `upsertEntity` resolve-then-merge (CRITICAL — hot-path капчи)

**Files:** Modify `src/services/entity-graph/postgres-impl.ts`; Modify `entity-coreference.it.test.ts`

- [ ] **Step 1: it-тест (поведенческий)** — добавь в `entity-coreference.it.test.ts`:

```typescript
describe('upsertEntity resolve-then-merge', () => {
  it('ФЛАГ ON: вариант мёржится в существующую (одна строка + alias)', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`ec-on-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик', aliases: ['Серый'] });
    await graph.upsertEntity(u, { type: 'person', name: 'Серый' }); // нет точного матча → Tier2 → merge
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Серик');
    expect(rows[0].aliases).toContain('Серый');
  });
  it('ФЛАГ ON: разные люди НЕ мёржатся', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`ec-diff-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик' });
    await graph.upsertEntity(u, { type: 'person', name: 'Айбек' });
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' } });
    expect(rows.length).toBe(2);
  });
  it('ФЛАГ OFF: байт-идентично — вариант создаёт ДУБЛЬ, aliases пусты', async () => {
    delete process.env[KEY];
    const u = await mkUser(`ec-off-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик', aliases: ['Серый'] });
    await graph.upsertEntity(u, { type: 'person', name: 'Серый' });
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' }, orderBy: { name: 'asc' } });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.aliases.length === 0)).toBe(true); // off игнорит incomingAliases
  });
});
```

- [ ] **Step 2: Run → fail** (ON-кейсы: сейчас «Серый» создаёт дубль; OFF-кейс зелёный уже).

- [ ] **Step 3: Implement** — замени тело `upsertEntity` (postgres-impl.ts:74-130). Добавь import в шапку:

```typescript
import { capAliases } from './merge-helpers.js';
import { isV2EntityResolveEnabled } from '../../lib/feature-flags.js';
```
Новое тело:

```typescript
  async upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
  ): Promise<Entity> {
    const name = entity.name.trim().slice(0, 255);
    const type = entity.type.trim().slice(0, 64);
    const resolveOn = isV2EntityResolveEnabled(userId);
    // off=байт-идентично: при выключенном флаге игнорим входящие алиасы
    // (исторически их не было) → alias-мёрж no-op, эмбеддинги те же.
    const incomingAliases: string[] = resolveOn
      ? ((entity.aliases as string[] | undefined) ?? [])
      : [];
    const attributes = (entity.attributes as Record<string, unknown> | undefined) ?? {};
    const importance = entity.importance ?? 5;

    // Точный матч по (userId, type, name) — приоритет, как сейчас.
    const existing = await prisma.entity.findUnique({
      where: { userId_type_name: { userId, type, name } },
    });
    if (existing) {
      const mergedAliases = capAliases([...(existing.aliases as string[]), ...incomingAliases]);
      const mergedAttributes = { ...(existing.attributes as Record<string, unknown>), ...attributes };
      const updated = await prisma.entity.update({
        where: { id: existing.id },
        data: {
          aliases: mergedAliases,
          attributes: mergedAttributes as Prisma.InputJsonValue,
          importance: Math.max(existing.importance, importance),
          lastSeenAt: new Date(),
        },
      });
      await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
      return updated;
    }

    // Нет точного матча. Resolve-then-merge ТОЛЬКО при флаге.
    if (resolveOn) {
      const resolved = await this.resolveForMerge(userId, name, type);
      if (resolved) {
        const mergedAliases = capAliases([
          ...(resolved.aliases as string[]),
          name, // новая форма имени → в алиасы
          ...incomingAliases,
        ]);
        const mergedAttributes = { ...(resolved.attributes as Record<string, unknown>), ...attributes };
        const updated = await prisma.entity.update({
          where: { id: resolved.id },
          data: {
            aliases: mergedAliases,
            attributes: mergedAttributes as Prisma.InputJsonValue,
            importance: Math.max(resolved.importance, importance),
            lastSeenAt: new Date(),
          },
        });
        await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
        return updated;
      }
    }

    // Создать новую (OFF: incomingAliases=[] → как сейчас).
    const created = await prisma.entity.create({
      data: {
        userId,
        type,
        name,
        aliases: incomingAliases,
        attributes: attributes as Prisma.InputJsonValue,
        importance,
        lastSeenAt: new Date(),
      },
    });
    await storeEntityEmbedding(created.id, created.name, created.aliases as string[]);
    return created;
  }
```

- [ ] **Step 4: Run → pass.** it-тесты все зелёные. Note: ON-merge «Серый»→«Серик» идёт через Tier2 alias-FTS (детерминированно).

- [ ] **Step 5: tsc + commit** (`feat(entity-coreference): upsertEntity resolve-then-merge за флагом, off-safe (Task4)`).

---

## Task 5: Экстрактор выдаёт `aliases`

**Files:** Modify `src/services/entity-extractor.ts`, `entity-extractor.test.ts`

- [ ] **Step 1: Failing unit** — в `entity-extractor.test.ts` добавь:

```typescript
describe('parseExtractorResponse — aliases', () => {
  it('пробрасывает массив aliases', () => {
    const r = parseExtractorResponse('{"entities":[{"name":"Сергей","type":"person","aliases":["Серёга"]}],"relationships":[]}');
    expect(r.entities[0].aliases).toEqual(['Серёга']);
  });
  it('без aliases — поле undefined, не падает', () => {
    const r = parseExtractorResponse('{"entities":[{"name":"Роза","type":"person"}],"relationships":[]}');
    expect(r.entities[0].aliases).toBeUndefined();
  });
});
```
(Импорт `parseExtractorResponse` уже есть в файле теста.)

- [ ] **Step 2: Run → fail/pass-trivially.** parseExtractorResponse уже кастит `as ExtractedEntityInput[]`, так что aliases пройдёт как есть — тест #1 может пройти сразу (поле копируется JSON.parse). Тогда красный придёт на типе (TS): `aliases` не в `ExtractedEntityInput`. Запусти `npx tsc --noEmit` → ошибка типа.

- [ ] **Step 3a: тип** — `entity-extractor.ts:24` `ExtractedEntityInput` добавь:

```typescript
  /** Известные НЕ-морфологические варианты имени (Серёга↔Сергей, Kaspi↔Каспи). Стеммер морфологию ловит сам. */
  aliases?: string[];
```

- [ ] **Step 3b: промпт** — в `SYSTEM_PROMPT` shape entities (`:150-155`) добавь поле и правило. Замени блок entities-объекта на:

```typescript
  "entities": [
    {
      "name": "каноническое имя (именительный падеж, полное имя если известно)",
      "type": "person|place|concept|goal|organization",
      "aliases": ["известный вариант: кличка, краткое/полное, латиница"],
      "attributes": { "ключ": "значение" },
      "importance": 5
    }
  ],
```
И в «Правила» добавь пункт (после правила 3):

```
3a. aliases — ТОЛЬКО НЕ-морфологические варианты (кличка «Серёга» для «Сергей», латиница «Kaspi» для «Каспи», краткое↔полное). Склонения/падежи НЕ добавляй — система их сводит сама. Нет вариантов → не добавляй поле.
```

- [ ] **Step 3c: нормализация** — в `extractEntities` (`:212-215`) замени map на:

```typescript
    const normalizedEntities: ExtractedEntityInput[] = parsed.entities
      .map((e) => {
        const out: ExtractedEntityInput = { ...e, name: normalizeEntityName(e.name) };
        if (Array.isArray(e.aliases)) {
          out.aliases = e.aliases
            .map((a) => normalizeEntityName(String(a)))
            .filter((a) => a && !isSelfReference(a, userName));
        }
        return out;
      })
      .filter((e) => !isSelfReference(e.name, userName));
```

- [ ] **Step 4: unit** — добавь в `entity-extractor.test.ts` (для нормализации — extractEntities требует Claude; тестируем чисто через parse + ручную нормализацию, либо структурно). Добавь:

```typescript
describe('SYSTEM_PROMPT — aliases присутствует', () => {
  it('промпт просит aliases', () => {
    const src = readFileSync(join(__dirname, 'entity-extractor.ts'), 'utf8');
    expect(src).toContain('"aliases"');
    expect(src).toMatch(/aliases.*НЕ-морфологические/);
  });
});
```
(Добавь импорты `readFileSync`/`join` если их нет в шапке теста.)

- [ ] **Step 5: Run → pass** + `tsc`.

- [ ] **Step 6: commit** (`feat(entity-coreference): экстрактор выдаёт aliases (НЕ-морфо варианты) (Task5)`).

---

## Task 6: v2-capture пробрасывает `aliases`

**Files:** Modify `src/services/v2-capture.ts`; Create `src/services/entity-coreference-wiring.test.ts`

- [ ] **Step 1: Структурный тест** — `entity-coreference-wiring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAPTURE = readFileSync(join(__dirname, 'v2-capture.ts'), 'utf8');
const UPSERT = readFileSync(join(__dirname, 'entity-graph', 'postgres-impl.ts'), 'utf8');

describe('entity-coreference wiring (гард)', () => {
  it('v2-capture пробрасывает aliases в upsertEntity', () => {
    expect(CAPTURE).toContain('input.aliases');
  });
  it('upsertEntity зовёт resolveForMerge за флагом + off-гейт incomingAliases', () => {
    expect(UPSERT).toContain('this.resolveForMerge(');
    expect(UPSERT).toContain('isV2EntityResolveEnabled');
    expect(UPSERT).toContain('resolveOn');
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — в `v2-capture.ts` upsert-цикл (`:64-66`), сразу после блока attributes:

```typescript
        if (ent.aliases?.length) {
          input.aliases = ent.aliases;
        }
```

- [ ] **Step 4: Run → pass** + `tsc`.

- [ ] **Step 5: commit** (`feat(entity-coreference): v2-capture пробрасывает aliases + структурный гард (Task6)`).

---

## Task 7: Фаза 1 verify + независимое ревью

- [ ] **Step 1: Полный verify.** `cd packages/server && npx tsc --noEmit && npx vitest run` (unit зелёные, baseline ~2666 + новые) + `npx vitest run --project integration` (+ entity-coreference.it зелёные).

- [ ] **Step 2: commit** если что-то осталось.

- [ ] **Step 3: Независимое ревью** (`pr-review-toolkit:code-reviewer`) на дифф Фазы 1. Фокус:
  - **off=байт-идентично:** при `!isV2EntityResolveEnabled` → incomingAliases=[], resolveForMerge НЕ зовётся, точный матч и create — как до фичи; эмбеддинги из (name, []) те же. it-тест off-кейса.
  - **ложные склейки:** type-filtered; FTS Tier1/2 принимаются (высокоточные для proper nouns); Tier3 эмбеддинг ТОЛЬКО при dist≤порог (shouldMergeByEmbedding); порог env-тюнится.
  - **ничего не теряем:** при мёрже форма имени уходит в aliases; attributes мёржатся; importance max.
  - **hot-path:** upsertEntity best-effort (resolveForMerge→null при сбое→create, безопасный дефолт дубль, не ложная склейка/потеря); +1-2 FTS запроса на ФОНОВОЙ капче.
  - **type-consistency:** resolveForMerge/shouldMergeByEmbedding/capAliases/MERGE_MAX_COSINE_DIST/FEATURE_V2_ENTITY_RESOLVE едины.
  - 0 блокеров → доклад Berik + предложить push/deploy + флаг (по слову; флаг сразу `all`).

---

## ФАЗА 2 (бэкфилл — `--apply` ТОЛЬКО по слову Berik, после Фазы 1 в проде)

## Task 8: `dedup-entities` проход S3 (resolve-based)

**Files:** Modify `scripts/dedup-entities.ts`, `src/scripts/dedup-entities.test.ts`

> ПЕРЕД стартом: прочитать `scripts/dedup-entities.ts` целиком — переиспользовать существующий merge-примитив S1/S2 (перенос `entityRelationship.updateMany` на выжившего + `mergeAliases` + удаление absorbed). S3 добавляет поиск пар по resolve-логике (FTS имя/алиасы; эмбеддинг опционально).

- [ ] **Step 1: Чистый pair-finder тест** — в `dedup-entities.test.ts` добавь (импорт `findResolvePairs` из скрипта):

```typescript
describe('findResolvePairs (S3) — pure', () => {
  it('группирует по type, не пересекает типы, исключает self', () => {
    const es = [
      { id: '1', type: 'person', name: 'Серик', aliases: ['Серый'], importance: 6 },
      { id: '2', type: 'person', name: 'Серый', aliases: [], importance: 5 },
      { id: '3', type: 'organization', name: 'Серый', aliases: [], importance: 5 },
    ];
    const pairs = findResolvePairs(es as never);
    // '2' (Серый/person) поглощается '1' (alias Серый), '3' (org) не трогаем
    expect(pairs.length).toBe(1);
    expect(pairs[0].canonical.id).toBe('1');
    expect(pairs[0].absorbed.id).toBe('2');
  });
});
```
(`findResolvePairs` — чистая функция над списком: для каждой сущности ищет в ТОМ ЖЕ type другую, чья `name`∈ aliases/похожа, выживший = больший importance, затем больший aliases-len, затем меньший id. Детерминированно, без БД/эмбеддинга — эмбеддинг-тир делается в --apply через resolveForMerge на живой БД.)

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — добавь в `scripts/dedup-entities.ts` экспорт `findResolvePairs` (чистый, нормализованный alias-набор: имя absorbed входит в canonical.aliases ИЛИ canonical.name входит в absorbed.aliases, case-insensitive). Затем в main-проходе после S2 добавь S3: собрать `findResolvePairs(allUserEntities)` + для каждой пары вызвать СУЩЕСТВУЮЩИЙ merge-примитив (тот же, что S1/S2): `entityRelationship.updateMany({where:{OR:[{fromId:absorbed.id},{toId:absorbed.id}]}, data:{...перенос на canonical.id}})` (раздельно from/to), `obligation.updateMany({where:{personEntityId:absorbed.id}, data:{personEntityId:canonical.id}})`, `entity.update(canonical, {aliases: mergeAliases(canonical.aliases, [...absorbed.aliases, absorbed.name])})`, `entity.delete(absorbed.id)` — всё в `tx`, только при `!dryRun`.

```typescript
export function findResolvePairs(
  entities: Array<{ id: string; type: string; name: string; aliases: string[]; importance: number }>,
): Array<{ canonical: typeof entities[number]; absorbed: typeof entities[number] }> {
  const norm = (s: string) => s.trim().toLowerCase();
  const byType = new Map<string, typeof entities>();
  for (const e of entities) { (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e); }
  const pairs: Array<{ canonical: typeof entities[number]; absorbed: typeof entities[number] }> = [];
  const taken = new Set<string>();
  for (const group of byType.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const a = group[i], b = group[j];
        if (taken.has(a.id) || taken.has(b.id)) continue;
        const aForms = new Set([norm(a.name), ...a.aliases.map(norm)]);
        const match = aForms.has(norm(b.name)) || b.aliases.some((al) => aForms.has(norm(al)));
        if (!match) continue;
        // выживший: больший importance → больше aliases → меньший id
        const [canonical, absorbed] =
          a.importance !== b.importance ? (a.importance > b.importance ? [a, b] : [b, a])
          : a.aliases.length !== b.aliases.length ? (a.aliases.length > b.aliases.length ? [a, b] : [b, a])
          : (a.id < b.id ? [a, b] : [b, a]);
        pairs.push({ canonical, absorbed });
        taken.add(absorbed.id);
      }
    }
  }
  return pairs;
}
```

- [ ] **Step 4: merge-FK тест (real prisma)** — добавь it-тест: создать canonical+absorbed+relationship+obligation на absorbed → запустить merge-функцию (не dry-run) → relationship.fromId/toId и obligation.personEntityId переехали на canonical, absorbed удалён, alias absorbed.name в canonical.aliases. (Зеркаль существующий merge it-тест S1/S2 если есть.)

- [ ] **Step 5: Run → pass** + `tsc`.

- [ ] **Step 6: commit** (`feat(entity-coreference): бэкфилл S3 resolve-based в dedup-entities (Task8)`).

---

## Task 9: Фаза 2 verify + dry-run инструкция

- [ ] **Step 1: Полный verify** tsc + suite + integration.
- [ ] **Step 2: Инструкция** (в конце плана / в коммите): прод-бэкфилл — `RAILWAY...` env → `npx tsx scripts/dedup-entities.ts --user=<prod-id> --dry-run` → ревью пар Berik → `--apply` ТОЛЬКО по явному слову. Сначала Фаза 1 должна быть в проде (флаг all), чтобы новые дубли не плодились параллельно.
- [ ] **Step 3: commit** + доклад Berik.

---

## Self-Review (выполнено)
**Spec coverage:** A (resolveForMerge T3 + upsertEntity T4 + флаг T1 + хелперы T2) ✓; B (экстрактор aliases T5 + capture T6) ✓; C (бэкфилл S3 T8 + verify T9) ✓. **off=байт-идентично:** T4 incomingAliases-гейт + off it-тест ✓. **Placeholder scan:** полный код в каждом шаге (Task8 merge-FK шаг ссылается на «прочитать скрипт» — намеренно, Фаза 2 отдельная, primitive переиспользуется; pure findResolvePairs дан полностью). **Type consistency:** `resolveForMerge(userId,mention,type)`, `shouldMergeByEmbedding(dist,maxDist?)`, `capAliases(arr,max?,maxLen?)`, `MERGE_MAX_COSINE_DIST`, `FEATURE_V2_ENTITY_RESOLVE`/`isV2EntityResolveEnabled`, `findResolvePairs` — едины во всех задачах ✓.
