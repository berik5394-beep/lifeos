# ОДНА ПАМЯТЬ — M2 (Один писатель / single writer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Свести **ДВА писателя** в `Memory` (legacy `captureMemory` + v2 `recordEvent`) в **ОДИН** `writeMemory`, который сохраняет ОБА набора возможностей: legacy (извлечённые факты + дедуп `shouldOverwriteContent` + дубликат-запрос + embedding) И v2 (episodic-поля validAt/invalidAt/entityRefs/mood + теги) И M1 (action-события). За флагом `FEATURE_V2_WRITE` (off ⇒ сегодняшняя двойная запись **байт-в-байт**; on ⇒ legacy `captureMemory` НЕ вызывается, всё идёт через `writeMemory`). **ЧТЕНИЕ (`getRelevantMemories`) НЕ трогаем — оно уже единое** (читает все строки без фильтра по source). M2 НЕ добавляет ни одного вызова Claude (embedding — существующий путь `embeddings.ts`/Voyage). Удаление функции `captureMemory` — **follow-up** (после доказательства флага), НЕ в этом плане; код должен компилироваться с обоими путями.

**Architecture (single writer, flag-gated):**
- **Новый `writeMemory(userId, input)`** живёт в `src/services/episodic-memory.ts` **рядом с `recordEvent`**. Обоснование выбора места (а не нового `memory-writer.ts`): `episodic-memory.ts` уже импортирует `prisma`, тип `Memory`, и содержит pure-хелперы `validateEventInput`/`clampMood`, которые `writeMemory` переиспользует напрямую. Это даёт минимум новых импортов и держит весь episodic-write в одном файле (как `recordEvent`/`invalidateEvent`). Дедуп-хелпер `shouldOverwriteContent` и `computeExpiresAt` импортируются из `memory-service.js` (уже экспортированы); embedding-примитивы (`embedDocument`/`embeddingsEnabled`/`toVectorLiteral`) — из `embeddings.js` (уже экспортированы). `storeEmbedding` в `memory-service.ts` — **приватная** функция (не экспортирована), поэтому её тело **портируется** в embed-шаг `writeMemory` дословно.
- **`recordEvent`** при `isV2WriteEnabled(userId)` делегирует в `writeMemory` (маппинг входа; `embed` по типу: `type:'message'` → true, иначе false); при off — текущий plain `prisma.memory.create` (байт-в-байт). Значит `captureV2InBackground` (`recordEvent type:'message'`) и `captureActivity` (action-события через `recordEvent`) авто-апгрейдятся под флагом, **без правки этих вызывающих файлов**. Action-события получают `embed:false` через единое правило «message → embed, иначе нет» внутри `recordEvent`-делегации — это cleaner-путь (одно правило, без списка типов в `captureActivity`).
- **Оркестратор:** `jarvis-orchestrator.ts:182` (цикл по `extracted.memories`) и `:666` (preference-write) при `isV2WriteEnabled(userId)` → `writeMemory(userId, {…, tags})`; при off → текущий `captureMemory(...)`. Импорт `captureMemory` ОСТАЁТСЯ (off-путь его зовёт; удаление — follow-up).
- **Флаг off везде = сегодняшняя двойная запись, байт-в-байт** (мгновенный откат).

**Tech Stack:** packages/server, Fastify, Prisma, TypeScript strict, ESM NodeNext (`.js` в импортах), vitest. **Zero `vi.mock`.** Тесты: pure unit для чистых хелперов + структурные через `readFileSync(join(...), 'utf8')`+regex `toMatch` (зеркало `src/services/episodic-memory.test.ts` и `src/services/memory-service.test.ts`, которые используют `join(process.cwd(), 'src/services/<file>.ts')`; для tools-теста зеркало `src/tools/registry-capture.test.ts` с `join(__dirname, 'index.ts')`). Commit-per-step, heredoc с `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `createAnthropic()` only — M2 НЕ добавляет Claude. Все команды — из `packages/server`. **Baseline (на 2026-06-01): `npx vitest run` → 1913 passed (173 files); `npx tsc --noEmit` → clean.**

---

## File Structure

- **Modify** `packages/server/src/lib/feature-flags.ts` — добавить `isV2WriteEnabled` (форма как `isV2InlineNudgeEnabled`/`isV2MemoryEnabled`).
- **Modify** `packages/server/src/lib/feature-flags.test.ts` — unit для `isV2WriteEnabled` (зеркало блока `isV2MemoryEnabled`).
- **Modify** `packages/server/src/services/episodic-memory.ts` — новый `writeMemory(userId, input)` + pure-хелпер `shouldEmbed(input)` + делегация в `recordEvent` под флагом.
- **Modify** `packages/server/src/services/episodic-memory.test.ts` — pure unit для `shouldEmbed` + структурные для `writeMemory` (дедуп/условный embed/never-throws) + структурный для `recordEvent` (флаг-ветка + off-путь plain create).
- **Modify** `packages/server/src/services/tool-activity-summary.ts` — комментарий-инвариант, что action-события идут через `recordEvent` → (под флагом) `writeMemory` с `embed:false`. (Опц.: код не меняется — embed:false выводится в `recordEvent`; см. Task 4 — структурный тест на `episodic-memory.ts`.)
- **Create** `packages/server/src/services/tool-activity-capture-embed.test.ts` — структурный: action-источник эмбед НЕ требует (правило в `recordEvent`).
- **Modify** `packages/server/src/services/jarvis-orchestrator.ts` — флаг-ветки на `:182` и `:666` (writeMemory vs captureMemory).
- **Create** `packages/server/src/services/jarvis-orchestrator-m2-write.test.ts` — структурный для обеих веток оркестратора.

---

## Task 1: `isV2WriteEnabled` флаг + unit-тест

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify (test): `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test** — в `packages/server/src/lib/feature-flags.test.ts` (a) добавить `isV2WriteEnabled` в импорт сверху:

```ts
import {
  isV2MemoryEnabled,
  isV2ProactivityEnabled,
  isV2AxesEnabled,
  isV2CronEnabled,
  isV2IdentityEnabled,
  isV2WriteEnabled,
} from './feature-flags.js';
```

(b) добавить блок в конец файла (зеркало `isV2MemoryEnabled`, флаг `FEATURE_V2_WRITE`):

```ts
describe('isV2WriteEnabled', () => {
  const ORIG = process.env.FEATURE_V2_WRITE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_WRITE;
    else process.env.FEATURE_V2_WRITE = ORIG;
  });

  it('returns false when env unset', () => {
    delete process.env.FEATURE_V2_WRITE;
    expect(isV2WriteEnabled('user1')).toBe(false);
  });

  it.each(['', 'none', 'false'])('returns false when env = %s', (v) => {
    process.env.FEATURE_V2_WRITE = v;
    expect(isV2WriteEnabled('user1')).toBe(false);
  });

  it('returns true for all users when env = "all"', () => {
    process.env.FEATURE_V2_WRITE = 'all';
    expect(isV2WriteEnabled('user1')).toBe(true);
    expect(isV2WriteEnabled('user-zzz')).toBe(true);
  });

  it('returns true only for listed userIds (comma-separated)', () => {
    process.env.FEATURE_V2_WRITE = 'user-berikId,user-aydanaId';
    expect(isV2WriteEnabled('berikId')).toBe(true);
    expect(isV2WriteEnabled('aydanaId')).toBe(true);
    expect(isV2WriteEnabled('otherId')).toBe(false);
  });

  it('handles whitespace around entries', () => {
    process.env.FEATURE_V2_WRITE = ' user-a , user-b ';
    expect(isV2WriteEnabled('a')).toBe(true);
    expect(isV2WriteEnabled('b')).toBe(true);
  });

  it('ignores trailing/leading whitespace in flag itself', () => {
    process.env.FEATURE_V2_WRITE = '  all  ';
    expect(isV2WriteEnabled('x')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/lib/feature-flags.test.ts`
Expected: FAIL (`isV2WriteEnabled` не экспортирован → import error / not a function).

- [ ] **Step 3: Implement** — в `packages/server/src/lib/feature-flags.ts` добавить в конец файла (использует существующий `isEnabledForUser`, ровно как `isV2InlineNudgeEnabled`):

```ts
/**
 * ОДНА ПАМЯТЬ M2 — Per-user gate для единого писателя (single writer).
 * off → сегодняшняя двойная запись (captureMemory + recordEvent), байт-в-байт.
 * on → ОДИН writeMemory; legacy captureMemory НЕ вызывается.
 * Env FEATURE_V2_WRITE в форме "all" / "none"/"false"/unset / "user-X,user-Y".
 */
export function isV2WriteEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_WRITE, userId);
}
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/lib/feature-flags.test.ts`
Expected: PASS (все кейсы, включая существующие).

- [ ] **Step 5: tsc** — `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(M2): isV2WriteEnabled flag — gate для единого писателя памяти (ОДНА ПАМЯТЬ M2 Task 1)

Per-user флаг FEATURE_V2_WRITE через существующий isEnabledForUser (форма
как isV2InlineNudgeEnabled). off → двойная запись байт-в-байт; on → один
writeMemory. Юнит-тесты зеркалят isV2MemoryEnabled.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `writeMemory` — единый писатель (дедуп + create/update + условный embed)

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts`
- Modify (test): `packages/server/src/services/episodic-memory.test.ts`

Здесь рождается единый писатель. Он вбирает смарты legacy `captureMemory` (дедуп `shouldOverwriteContent` + дубликат-`$queryRaw` + update-in-place с `importance=max` ИЛИ create) и v2-поля (`validAt/invalidAt/entityRefs/mood/source/tags`), плюс **условный** embedding (порт `storeEmbedding`). Чистая часть решения «эмбедить ли вход» выносится как pure-хелпер `shouldEmbed(input)` для unit-теста. `writeMemory` best-effort: **никогда не бросает** (top-level try/catch; на сбое возвращает результат без краха).

- [ ] **Step 1: Write the failing test** — в `packages/server/src/services/episodic-memory.test.ts` (a) добавить в импорт сверху `writeMemory` и `shouldEmbed`:

```ts
import {
  validateEventInput,
  clampMood,
  shouldEmbed,
  writeMemory,
} from './episodic-memory.js';
```

(b) добавить pure-unit для `shouldEmbed` (после блока `validateEventInput`, перед `const SRC = ...`):

```ts
describe('shouldEmbed — условный embedding по типу/knob (pure)', () => {
  it('explicit embed:false → false (даже для message)', () => {
    expect(shouldEmbed({ type: 'message', content: 'x', embed: false })).toBe(false);
  });

  it('explicit embed:true → true (даже для action-типа)', () => {
    expect(shouldEmbed({ type: 'task_created', content: 'x', embed: true })).toBe(true);
  });

  it('default (no embed knob): message → true (recall-ценный чат-факт)', () => {
    expect(shouldEmbed({ type: 'message', content: 'x' })).toBe(true);
  });

  it('default (no embed knob): fact → true (стабильный recall-ценный)', () => {
    expect(shouldEmbed({ type: 'fact', content: 'x' })).toBe(true);
  });

  it.each(['task_created', 'expense_added', 'habit_logged', 'journal_logged'])(
    'default: высокочастотный action-тип %s → false (FTS хватает, бюджет)',
    (type) => {
      expect(shouldEmbed({ type, content: 'x' })).toBe(false);
    },
  );
});
```

(c) добавить структурные для `writeMemory` (после существующего `SRC`-блока — он уже читает `src/services/episodic-memory.ts` через `process.cwd()`):

```ts
describe('episodic-memory.ts structural — writeMemory (единый писатель)', () => {
  it('writeMemory экспортирован как async function', () => {
    expect(SRC).toMatch(/export async function writeMemory\s*\(/);
  });

  it('дедуп: STABLE_TYPES + дубликат-$queryRaw по русскому FTS', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('STABLE_TYPES.has(');
    expect(body).toContain('$queryRaw');
    expect(body).toMatch(/to_tsvector\('russian'/);
    expect(body).toMatch(/plainto_tsquery\('russian'/);
  });

  it('update-ветка зовёт shouldOverwriteContent и берёт importance = max', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('shouldOverwriteContent(');
    expect(body).toMatch(/Math\.max\(/);
    expect(body).toContain('prisma.memory.update');
  });

  it('create-ветка пишет episodic-поля (validAt/entityRefs/mood) + tags', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.memory.create');
    expect(body).toContain('validAt');
    expect(body).toContain('entityRefs');
    expect(body).toContain('mood');
    expect(body).toContain('tags');
  });

  it('условный embedding: shouldEmbed + embeddingsEnabled + UPDATE embedding', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('shouldEmbed(');
    expect(body).toContain('embeddingsEnabled()');
    expect(body).toMatch(/UPDATE "Memory" SET embedding/);
    expect(body).toContain('embedDocument(');
  });

  it('never-throws: тело обёрнуто в try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toMatch(/catch\s*\(/);
    expect(body).toMatch(/console\.warn\(\s*['`]\[memory\]/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/episodic-memory.test.ts`
Expected: FAIL (`shouldEmbed`/`writeMemory` не существуют → import error).

- [ ] **Step 3: Implement** — в `packages/server/src/services/episodic-memory.ts`:

(a) Заменить верх файла. **Было** (строки 1-4):

```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { prisma } from '../lib/prisma.js'; // будет использовано в C2
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Memory } from '@prisma/client'; // будет использовано в C2
```

**Стало** (prisma/Memory теперь реально используются ⇒ убираем eslint-disable; добавляем импорты дедупа, embedding, флага):

```ts
import { prisma } from '../lib/prisma.js';
import type { Memory } from '@prisma/client';
import { shouldOverwriteContent, computeExpiresAt } from './memory-service.js';
import { embedDocument, embeddingsEnabled, toVectorLiteral } from './embeddings.js';
import { isV2WriteEnabled } from '../lib/feature-flags.js';
```

(b) Добавить тип входа `WriteMemoryInput`, pure-хелперы `STABLE_TYPES`/`shouldEmbed`, и `writeMemory`. Вставить **после** блока pure-хелперов (после `validateEventInput`, перед секцией `// --- Async API ---`):

```ts
// ---------------------------------------------------------------------------
// ОДНА ПАМЯТЬ M2 — единый писатель (writeMemory)
// ---------------------------------------------------------------------------

/**
 * Вход единого писателя. Объединяет legacy-факты ({type,content,details,
 * source,tags,importance}) и v2-episodic-поля (entityRefs/mood/validAt/
 * invalidAt) + knob `embed` (стоимость embedding).
 */
export type WriteMemoryInput = {
  type: string;
  content: string;
  details?: string | null;
  source?: string;
  sourceId?: string | null;
  tags?: string[];
  importance?: number;
  entityRefs?: string[];
  mood?: number;
  validAt?: Date;
  invalidAt?: Date;
  /** Условный embedding. undefined → по типу (см. shouldEmbed). */
  embed?: boolean;
};

/**
 * Стабильные типы сворачиваем дедупом (как legacy captureMemory).
 * Эпизодические (event/emotion/place/message/action-типы) — нет: это
 * разные события во времени.
 */
const STABLE_TYPES = new Set(['fact', 'preference', 'person', 'decision']);

/**
 * recall-ценные типы, которые эмбедим по умолчанию (semantic retrieval
 * окупается). Высокочастотные дешёвые action-события (`task_created`,
 * `expense_added`, …) сюда НЕ входят — им хватает FTS, embedding-бюджет
 * не тратим. `message` — сырой чат-факт, recall-ценный.
 */
const EMBED_DEFAULT_TYPES = new Set([
  'message',
  'fact',
  'preference',
  'person',
  'decision',
  'event',
]);

/**
 * Pure decision (тест без БД): эмбедить ли вход?
 *  - явный knob input.embed имеет приоритет;
 *  - иначе по типу: recall-ценные (EMBED_DEFAULT_TYPES) → true,
 *    высокочастотные action-события → false.
 */
export function shouldEmbed(input: { type: string; embed?: boolean }): boolean {
  if (input.embed !== undefined) return input.embed;
  return EMBED_DEFAULT_TYPES.has(input.type);
}

/**
 * ОДНА ПАМЯТЬ M2 — ЕДИНЫЙ писатель в `Memory`.
 *
 * Вбирает лучшее из обоих legacy/v2:
 *  1. ДЕДУП (портирован из memory-service.captureMemory): для STABLE_TYPES
 *     ищем похожую запись того же типа русским FTS; если нашли —
 *     update-in-place (importance=max, merge tags/details, sparse-overwrite
 *     guard через shouldOverwriteContent, освежаем createdAt).
 *  2. CREATE с episodic-полями (validAt/invalidAt/entityRefs/mood/source/
 *     tags) + TTL default (computeExpiresAt) — как recordEvent + legacy.
 *  3. УСЛОВНЫЙ EMBEDDING (порт storeEmbedding): если shouldEmbed(input) и
 *     embeddingsEnabled() — UPDATE "Memory" SET embedding.
 *
 * Best-effort: НИКОГДА не бросает (top-level try/catch). На сбое возвращает
 * { id: '', action: 'skipped' } — горячий путь не падает (как сегодня
 * recordEvent/captureActivity/captureMemory best-effort).
 */
export async function writeMemory(
  userId: string,
  input: WriteMemoryInput,
): Promise<{ id: string; action: 'created' | 'updated' | 'skipped' }> {
  try {
    const content = input.content.slice(0, 500);
    const details = input.details?.slice(0, 2000) ?? null;
    const tags = (input.tags || []).slice(0, 10).map((t) => t.slice(0, 32));
    const importance = input.importance ?? 5;
    const source = input.source ?? 'v2-episodic';

    // --- 1. Дедуп (порт из captureMemory) для стабильных типов ---
    if (STABLE_TYPES.has(input.type)) {
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

      if (dup.length > 0) {
        const existing = dup[0];
        const mergedTags = Array.from(new Set([...(existing.tags || []), ...tags])).slice(0, 10);
        const merged = details ?? existing.details;
        const ex = await prisma.memory.findUnique({
          where: { id: existing.id },
          select: { content: true },
        });
        const oldContent = ex?.content ?? '';
        const allowContentReplace = shouldOverwriteContent(oldContent, content);
        const newContent = allowContentReplace ? content : oldContent;
        console.warn(
          `[memory] UPDATE type=${input.type} id=${existing.id} ` +
            `oldLen=${oldContent.length} newLen=${content.length} ` +
            `contentReplaced=${allowContentReplace} (user=${userId})`,
        );
        await prisma.memory.update({
          where: { id: existing.id },
          data: {
            content: newContent,
            details: merged,
            tags: mergedTags,
            importance: Math.max(existing.importance, importance),
            createdAt: new Date(),
          },
        });
        await storeMemoryEmbedding(existing.id, newContent, merged, input);
        return { id: existing.id, action: 'updated' };
      }
    }

    // --- 2. Create с episodic-полями + TTL default ---
    const validAt = input.validAt ?? new Date();
    const mood = clampMood(input.mood);
    const expiresAt = computeExpiresAt(input.type);
    const created = await prisma.memory.create({
      data: {
        userId,
        type: input.type,
        content,
        details,
        source,
        sourceId: input.sourceId ?? null,
        tags,
        importance,
        expiresAt,
        validAt,
        invalidAt: input.invalidAt ?? null,
        entityRefs: input.entityRefs ?? [],
        mood: mood ?? null,
      },
      select: { id: true },
    });
    await storeMemoryEmbedding(created.id, content, details, input);
    return { id: created.id, action: 'created' };
  } catch (err) {
    console.warn(
      '[memory] writeMemory failed:',
      err instanceof Error ? err.message : err,
    );
    return { id: '', action: 'skipped' };
  }
}

/**
 * Условный embedding (порт приватного storeEmbedding из memory-service.ts).
 * Эмбедим только если shouldEmbed(input) (knob/тип) И embeddingsEnabled().
 * Best-effort: сбой Voyage не валит запись (семантика опциональна).
 */
async function storeMemoryEmbedding(
  id: string,
  content: string,
  details: string | null,
  input: WriteMemoryInput,
): Promise<void> {
  if (!id) return;
  if (!shouldEmbed(input)) return;
  if (!embeddingsEnabled()) return;
  try {
    const vec = await embedDocument(details ? `${content}. ${details}` : content);
    if (!vec) return;
    await prisma.$executeRawUnsafe(
      'UPDATE "Memory" SET embedding = $1::vector WHERE id = $2',
      toVectorLiteral(vec),
      id,
    );
  } catch (err) {
    console.warn('[memory] embed store failed:', err instanceof Error ? err.message : err);
  }
}
```

> **Примечание по дедуп-запросу:** он переносится **дословно** из `captureMemory` (`memory-service.ts:136-147`) — параметризованный `$queryRaw` (теговый template, без string concat), безопасен и портируется без изменений. Различие лишь в имени переменной входа (`m.` → `input.`). `$executeRawUnsafe` для embedding — тоже дословный порт (`memory-service.ts:22-26`), параметризован позиционно (`$1`,`$2`), безопасен.

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/episodic-memory.test.ts`
Expected: PASS (pure `shouldEmbed` + структурные `writeMemory` + существующие `recordEvent`/`invalidateEvent`/query-методы).

- [ ] **Step 5: tsc** — `npx tsc --noEmit` → clean. (Проверка: `prisma`/`Memory` теперь используются — eslint-disable убраны; новые импорты `shouldOverwriteContent`/`computeExpiresAt`/`embed*`/`isV2WriteEnabled` валидны. `isV2WriteEnabled` пока импортирован, но используется в Task 3 — на этом шаге он ещё не задействован; чтобы tsc/`noUnusedLocals` не ругался, импорт `isV2WriteEnabled` добавляем в (a) этого шага ВМЕСТЕ с его первым использованием в Task 3. **Уточнение:** если проект включает `noUnusedLocals`, перенести строку `import { isV2WriteEnabled } ...` в Task 3 Step 3(a); иначе оставить здесь. По умолчанию — добавить в Task 3, чтобы каждый коммит был tsc-clean.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/episodic-memory.ts packages/server/src/services/episodic-memory.test.ts
git commit -F - <<'EOF'
feat(M2): writeMemory — единый писатель (дедуп + episodic create/update + условный embed) (ОДНА ПАМЯТЬ M2 Task 2)

Новый writeMemory вбирает legacy-смарты (shouldOverwriteContent дедуп +
дубликат-$queryRaw + importance=max) и v2-episodic-поля (validAt/invalidAt/
entityRefs/mood/tags). Условный embedding (порт storeEmbedding) по pure-
хелперу shouldEmbed: recall-ценные типы эмбедим, высокочастотные action —
нет (FTS хватает). Best-effort: никогда не бросает.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `recordEvent` — флаг-делегация в `writeMemory`

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts`
- Modify (test): `packages/server/src/services/episodic-memory.test.ts`

`recordEvent` под флагом делегирует в `writeMemory` (маппинг входа; `embed` по типу через `shouldEmbed` внутри `writeMemory` — `recordEvent` НЕ передаёт `embed`, чтобы action-типы автоматически получили `false`, а `message` — `true`). При off — текущий plain `prisma.memory.create` **байт-в-байт**. Так `captureV2InBackground` (`type:'message'`) и `captureActivity` (action-типы) авто-апгрейдятся без правки их файлов.

- [ ] **Step 1: Write the failing test** — в `packages/server/src/services/episodic-memory.test.ts` добавить структурный блок (после блока `writeMemory` из Task 2):

```ts
describe('episodic-memory.ts structural — recordEvent M2 флаг-делегация', () => {
  it('recordEvent проверяет isV2WriteEnabled', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toContain('isV2WriteEnabled(');
  });

  it('ON-ветка делегирует в writeMemory с маппингом входа', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toMatch(/writeMemory\(\s*userId/);
  });

  it('OFF-ветка сохраняет plain prisma.memory.create (байт-в-байт)', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toContain('prisma.memory.create');
    // off-путь по-прежнему пишет source 'v2-episodic' и не эмбедит
    expect(body).toMatch(/source:\s*['"]v2-episodic['"]/);
  });

  it('recordEvent всё ещё валидирует и клампит до записи', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    const validateIdx = body.indexOf('validateEventInput(');
    const branchIdx = body.indexOf('isV2WriteEnabled(');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(branchIdx);
    expect(body).toContain('clampMood(');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/episodic-memory.test.ts`
Expected: FAIL (нет `isV2WriteEnabled`/`writeMemory` внутри `recordEvent`).

- [ ] **Step 3: Implement** — в `packages/server/src/services/episodic-memory.ts`:

(a) Если на Task 2 Step 5 импорт `isV2WriteEnabled` НЕ добавлен (из-за `noUnusedLocals`) — добавить его сейчас в шапку (вместе с уже добавленными в Task 2):

```ts
import { isV2WriteEnabled } from '../lib/feature-flags.js';
```

(b) Заменить тело `recordEvent`. **Было** (строки 94-121):

```ts
export async function recordEvent(
  userId: string,
  input: RecordEventInput,
): Promise<{ id: string }> {
  validateEventInput(input);
  const validAt = input.validAt ?? new Date();
  const mood = clampMood(input.mood);

  const created = await prisma.memory.create({
    data: {
      userId,
      type: input.type,
      content: input.content.slice(0, 500),
      details: input.details?.slice(0, 2000) ?? null,
      source: 'v2-episodic',
      sourceId: null,
      tags: [],
      importance: input.importance ?? 5,
      validAt,
      invalidAt: input.invalidAt ?? null,
      entityRefs: input.entityRefs ?? [],
      mood: mood ?? null,
    },
    select: { id: true },
  });

  return { id: created.id };
}
```

**Стало** (validate/clamp раньше ветки; ON → writeMemory; OFF → тот же plain create, байт-в-байт):

```ts
export async function recordEvent(
  userId: string,
  input: RecordEventInput,
): Promise<{ id: string }> {
  validateEventInput(input);
  const validAt = input.validAt ?? new Date();
  const mood = clampMood(input.mood);

  // ОДНА ПАМЯТЬ M2: под флагом — ЕДИНЫЙ писатель (дедуп + условный embed).
  // `embed` НЕ передаём → writeMemory.shouldEmbed решает по типу: 'message'
  // (сырой чат-факт) эмбедится, высокочастотные action-типы (task_created,
  // expense_added, …) — нет. Тем самым captureV2 и captureActivity авто-
  // апгрейдятся под флагом без правки их файлов.
  if (isV2WriteEnabled(userId)) {
    const res = await writeMemory(userId, {
      type: input.type,
      content: input.content,
      details: input.details ?? null,
      source: 'v2-episodic',
      importance: input.importance,
      entityRefs: input.entityRefs,
      mood: input.mood,
      validAt: input.validAt,
      invalidAt: input.invalidAt,
    });
    return { id: res.id };
  }

  // OFF — байт-в-байт сегодняшнее поведение (plain create, без дедупа/embed).
  const created = await prisma.memory.create({
    data: {
      userId,
      type: input.type,
      content: input.content.slice(0, 500),
      details: input.details?.slice(0, 2000) ?? null,
      source: 'v2-episodic',
      sourceId: null,
      tags: [],
      importance: input.importance ?? 5,
      validAt,
      invalidAt: input.invalidAt ?? null,
      entityRefs: input.entityRefs ?? [],
      mood: mood ?? null,
    },
    select: { id: true },
  });

  return { id: created.id };
}
```

> **Замечание (честность):** off-путь читает `validAt`/`mood` (как раньше). ON-путь передаёт сырые `input.validAt`/`input.mood` в `writeMemory` (тот сам делает `?? new Date()` и `clampMood`) — поведение эквивалентно. Локальные `validAt`/`mood` всё ещё используются off-веткой, так что `noUnusedLocals` не сработает.

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/episodic-memory.test.ts`
Expected: PASS (новый блок + существующий `recordEvent`-структурный, который проверяет validate-before-create и `source:'v2-episodic'` — обе ветки сохраняют их).

- [ ] **Step 5: tsc** — `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/episodic-memory.ts packages/server/src/services/episodic-memory.test.ts
git commit -F - <<'EOF'
feat(M2): recordEvent делегирует в writeMemory под флагом (ОДНА ПАМЯТЬ M2 Task 3)

ON (isV2WriteEnabled) → единый writeMemory (дедуп + условный embed по типу:
message эмбедится, action — нет); OFF → plain prisma.memory.create байт-в-
байт. captureV2InBackground и captureActivity авто-апгрейдятся под флагом
без правки их файлов.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: captureActivity (tool-activity-summary) — action-события получают `embed:false`

**Files:**
- Modify (комментарий-инвариант): `packages/server/src/services/tool-activity-summary.ts`
- Create (test): `packages/server/src/services/tool-activity-capture-embed.test.ts`

**Решение (cleaner path):** `captureActivity` код **НЕ меняется** — он уже зовёт `recordEvent(userId, {type, content, importance})`. Под флагом `recordEvent` делегирует в `writeMemory` **без** `embed`, и `shouldEmbed` по типу даёт `false` для action-типов (`task_created`/`expense_added`/`habit_logged`/`journal_logged`/`event_created`/…), потому что их нет в `EMBED_DEFAULT_TYPES`. Это чище варианта «captureActivity напрямую зовёт writeMemory с embed:false»: один источник правды о стоимости (`shouldEmbed` в `episodic-memory.ts`), а `captureActivity` остаётся тонким мостом, как в M1. Тест фиксирует ИНВАРИАНТ: (1) `captureActivity` по-прежнему идёт через `recordEvent` (а не через `captureMemory`/прямой `writeMemory`); (2) `shouldEmbed`/`EMBED_DEFAULT_TYPES` в `episodic-memory.ts` НЕ включает action-типы.

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/services/tool-activity-capture-embed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldEmbed } from './episodic-memory.js';

const ACTIVITY_SRC = readFileSync(
  join(process.cwd(), 'src/services/tool-activity-summary.ts'),
  'utf-8',
);
const EPISODIC_SRC = readFileSync(
  join(process.cwd(), 'src/services/episodic-memory.ts'),
  'utf-8',
);

describe('M2 — action-события эмбед НЕ требуют (бюджет)', () => {
  it('captureActivity по-прежнему мост через recordEvent (не captureMemory/writeMemory напрямую)', () => {
    expect(ACTIVITY_SRC).toMatch(/void recordEvent\(/);
    expect(ACTIVITY_SRC).not.toMatch(/captureMemory\(/);
    expect(ACTIVITY_SRC).not.toMatch(/writeMemory\(/);
  });

  it('shouldEmbed(action-тип) === false (FTS хватает) — runtime', () => {
    for (const type of [
      'task_created',
      'task_completed',
      'expense_added',
      'income_added',
      'habit_logged',
      'journal_logged',
      'event_created',
    ]) {
      expect(shouldEmbed({ type, content: 'x' })).toBe(false);
    }
  });

  it('EMBED_DEFAULT_TYPES НЕ содержит action-типов (структурно)', () => {
    const start = EPISODIC_SRC.indexOf('const EMBED_DEFAULT_TYPES');
    const block = EPISODIC_SRC.slice(start, start + 400);
    expect(block).not.toContain('task_created');
    expect(block).not.toContain('expense_added');
    expect(block).not.toContain('habit_logged');
  });

  it("'message' эмбедится (recall-ценный чат-факт)", () => {
    expect(shouldEmbed({ type: 'message', content: 'x' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/tool-activity-capture-embed.test.ts`
Expected: PASS немедленно для runtime-кейсов `shouldEmbed` (Task 2 уже добавил их), но FAIL на кейсе про `captureActivity` ТОЛЬКО если кто-то нарушил мост. **Если все кейсы зелёные сразу** — это допустимо (Task 4 фиксирует уже-достигнутый инвариант поверх Task 2/3); тогда Step 3 — добавить лишь комментарий-инвариант. Чтобы соблюсти TDD-ритм, сначала временно добавь к тесту строку, проверяющую несуществующий маркер-комментарий, убедись в FAIL, реализуй комментарий (Step 3), затем верни тест к финальному виду. (Простой путь: принять, что этот тест — guard-тест; зафиксировать инвариант комментарием и оставить тест как regression-страховку.)

- [ ] **Step 3: Implement** — в `packages/server/src/services/tool-activity-summary.ts` добавить к docstring `captureActivity` (после строки `* Сбой захвата НИКОГДА не ломает действие/ответ юзеру.`) явный инвариант:

```ts
 * ОДНА ПАМЯТЬ M2: под флагом isV2WriteEnabled recordEvent делегирует в
 * writeMemory БЕЗ knob `embed` → shouldEmbed по типу даёт false для
 * высокочастотных action-событий (task_created/expense_added/…). Так
 * action-факты НЕ эмбедятся (FTS достаточно, embedding-бюджет цел), а
 * captureActivity остаётся тонким мостом — стоимость решает writeMemory.
```

(Тело `captureActivity` НЕ меняется — мост через `recordEvent` сохранён.)

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/tool-activity-capture-embed.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/tools/registry-capture.test.ts src/services/tool-activity-summary.test.ts` (M1-тесты моста зелёные — мост не тронут), затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/tool-activity-summary.ts packages/server/src/services/tool-activity-capture-embed.test.ts
git commit -F - <<'EOF'
feat(M2): action-события идут через recordEvent → writeMemory с embed=false (ОДНА ПАМЯТЬ M2 Task 4)

captureActivity не меняется (тонкий мост через recordEvent). Под флагом
recordEvent делегирует в writeMemory без knob embed → shouldEmbed даёт
false для action-типов (FTS хватает, embedding-бюджет цел). Guard-тест
фиксирует инвариант: мост через recordEvent + action-типы вне
EMBED_DEFAULT_TYPES.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: orchestrator:182 — цикл по `extracted.memories` (флаг-ветка writeMemory vs captureMemory)

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Create (test): `packages/server/src/services/jarvis-orchestrator-m2-write.test.ts`

Цикл извлечённых чат-фактов под флагом пишет через `writeMemory` (те же `{type,content,details,tags,importance}`, `source:'chat'`); при off — текущий `captureMemory`. `captureMemory`-импорт ОСТАЁТСЯ (off-путь его зовёт).

- [ ] **Step 1: Write the failing test** — создать `packages/server/src/services/jarvis-orchestrator-m2-write.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — M2 единый писатель за флагом (chat-факты :182)', () => {
  it('импортирует writeMemory и isV2WriteEnabled', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*writeMemory[^}]*\}\s*from\s*'\.\/episodic-memory\.js'/);
    expect(SRC).toMatch(/import\s*\{[^}]*isV2WriteEnabled[^}]*\}\s*from\s*'\.\.\/lib\/feature-flags\.js'/);
  });

  it('импорт captureMemory СОХРАНЁН (off-путь его зовёт; удаление — follow-up)', () => {
    expect(SRC).toMatch(/import\s*\{\s*captureMemory\s*\}\s*from\s*'\.\/memory-service\.js'/);
  });

  it('цикл extracted.memories: ветка isV2WriteEnabled → writeMemory, иначе captureMemory', () => {
    const loopIdx = SRC.indexOf('for (const m of extracted.memories)');
    expect(loopIdx).toBeGreaterThan(-1);
    const body = SRC.slice(loopIdx, loopIdx + 900);
    expect(body).toContain('isV2WriteEnabled(userId)');
    expect(body).toContain('writeMemory(userId');
    expect(body).toContain('captureMemory(userId');
    // факт-поля сохранены в обеих ветках
    expect(body).toContain('tags: m.tags');
    expect(body).toMatch(/source:\s*['"]chat['"]/);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/jarvis-orchestrator-m2-write.test.ts`
Expected: FAIL (нет `writeMemory`/`isV2WriteEnabled` импорта и ветки в цикле).

- [ ] **Step 3: Implement** — в `packages/server/src/services/jarvis-orchestrator.ts`:

(a) Добавить `writeMemory` к существующему импорту `captureMemory`. **Было** (строка 22):

```ts
import { captureMemory } from './memory-service.js';
```

**Стало** (импорт `captureMemory` сохранён; добавлен `writeMemory` отдельной строкой рядом):

```ts
import { captureMemory } from './memory-service.js';
import { writeMemory } from './episodic-memory.js';
```

(b) Добавить `isV2WriteEnabled` к флаг-импортам. **Было** (строка 33):

```ts
import { isV2MemoryEnabled } from '../lib/feature-flags.js';
```

**Стало:**

```ts
import { isV2MemoryEnabled, isV2WriteEnabled } from '../lib/feature-flags.js';
```

(c) Заменить тело цикла. **Было** (строки 181-191):

```ts
    for (const m of extracted.memories) {
      await captureMemory(userId, {
        type: m.type,
        content: m.content,
        details: m.details ?? null,
        source: 'chat',
        tags: m.tags,
        importance: m.importance,
      });
      memories++;
    }
```

**Стало** (ON → единый writeMemory; OFF → текущий captureMemory байт-в-байт; те же поля + `source:'chat'`):

```ts
    for (const m of extracted.memories) {
      // ОДНА ПАМЯТЬ M2: под флагом — ЕДИНЫЙ писатель (дедуп+embedding+
      // episodic-поля). Без флага — legacy captureMemory (байт-в-байт).
      if (isV2WriteEnabled(userId)) {
        await writeMemory(userId, {
          type: m.type,
          content: m.content,
          details: m.details ?? null,
          source: 'chat',
          tags: m.tags,
          importance: m.importance,
        });
      } else {
        await captureMemory(userId, {
          type: m.type,
          content: m.content,
          details: m.details ?? null,
          source: 'chat',
          tags: m.tags,
          importance: m.importance,
        });
      }
      memories++;
    }
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/jarvis-orchestrator-m2-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/services/jarvis-orchestrator` (существующие orchestrator-тесты зелёные — внешнее поведение не тронуто), затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/jarvis-orchestrator-m2-write.test.ts
git commit -F - <<'EOF'
feat(M2): orchestrator chat-факты (:182) → writeMemory под флагом (ОДНА ПАМЯТЬ M2 Task 5)

Цикл extracted.memories: ON (isV2WriteEnabled) → единый writeMemory
(дедуп+embedding+episodic); OFF → legacy captureMemory байт-в-байт. Импорт
captureMemory сохранён (off-путь зовёт; удаление — follow-up).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: orchestrator:666 — preference-write (флаг-ветка)

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Modify (test): `packages/server/src/services/jarvis-orchestrator-m2-write.test.ts`

Единственный `void captureMemory(...)` (preference «покупка ручная объяснена») под флагом → `void writeMemory(...)`; off → текущий `captureMemory`. Сохраняем fire-and-forget `void … .catch(() => {})`.

- [ ] **Step 1: Write the failing test** — добавить в `packages/server/src/services/jarvis-orchestrator-m2-write.test.ts` блок:

```ts
describe('jarvis-orchestrator — M2 preference-write за флагом (:666)', () => {
  it('purchase_explained: ветка isV2WriteEnabled → writeMemory, иначе captureMemory, оба fire-and-forget', () => {
    const idx = SRC.indexOf("'purchase_explained'");
    expect(idx).toBeGreaterThan(-1);
    // окно вокруг блока purchaseFlag (берём с запасом назад и вперёд)
    const start = SRC.lastIndexOf('if (!purchaseFlag)', idx);
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, idx + 200);
    expect(body).toContain('isV2WriteEnabled(userId)');
    expect(body).toMatch(/void writeMemory\(userId/);
    expect(body).toMatch(/void captureMemory\(userId/);
    expect(body).toContain("type: 'preference'");
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/services/jarvis-orchestrator-m2-write.test.ts`
Expected: FAIL (preference-блок ещё без ветки).

- [ ] **Step 3: Implement** — в `packages/server/src/services/jarvis-orchestrator.ts` заменить блок. **Было** (строки 665-673):

```ts
    if (!purchaseFlag) {
      void captureMemory(userId, {
        type: 'preference',
        content: 'Юзеру объяснено: покупка билетов ручная (диплинк, не авто)',
        source: 'chat',
        tags: ['purchase_explained'],
        importance: 4,
      }).catch(() => {});
    }
```

**Стало** (ветка по флагу; обе fire-and-forget; те же поля/теги):

```ts
    if (!purchaseFlag) {
      // ОДНА ПАМЯТЬ M2: под флагом — единый writeMemory; иначе legacy.
      // Оба fire-and-forget (.catch) — горячий путь не блокируем.
      if (isV2WriteEnabled(userId)) {
        void writeMemory(userId, {
          type: 'preference',
          content: 'Юзеру объяснено: покупка билетов ручная (диплинк, не авто)',
          source: 'chat',
          tags: ['purchase_explained'],
          importance: 4,
        }).catch(() => {});
      } else {
        void captureMemory(userId, {
          type: 'preference',
          content: 'Юзеру объяснено: покупка билетов ручная (диплинк, не авто)',
          source: 'chat',
          tags: ['purchase_explained'],
          importance: 4,
        }).catch(() => {});
      }
    }
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/services/jarvis-orchestrator-m2-write.test.ts`
Expected: PASS (оба блока — Task 5 + Task 6).

- [ ] **Step 5: Regression + tsc** — `npx vitest run src/services/jarvis-orchestrator`, затем `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/jarvis-orchestrator-m2-write.test.ts
git commit -F - <<'EOF'
feat(M2): orchestrator preference-write (:666) → writeMemory под флагом (ОДНА ПАМЯТЬ M2 Task 6)

purchase_explained preference: ON → void writeMemory; OFF → void
captureMemory. Обе fire-and-forget (.catch). Поля/теги/importance неизменны.
Это последний captureMemory call-site под флаг; импорт остаётся (off-путь).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Финальная верификация + rollout-нота

**Files:** нет правок кода — только прогон сюиты и заметка.

- [ ] **Step 1: Полная сюита** — `npx vitest run`
Expected: **≥ 1913 + новые** (baseline 1913 + Task1 ~6 + Task2 ~11 + Task3 ~4 + Task4 ~4 + Task5 ~4 + Task6 ~1 ≈ **1943+**), 0 fail. Money-safety, audit/honesty, M1 capture-сюиты зелёные (контракты роутов и tool-возвраты не тронуты; orchestrator внешнее поведение не тронуто).

- [ ] **Step 2: Типы** — `npx tsc --noEmit` → clean (0 ошибок). Особое внимание: `episodic-memory.ts` больше не имеет «висящих» импортов (`prisma`/`Memory`/`shouldOverwriteContent`/`computeExpiresAt`/`embed*`/`isV2WriteEnabled` все используются); `jarvis-orchestrator.ts` сохранил импорт `captureMemory` (off-путь его зовёт) — `noUnusedLocals` не сработает.

- [ ] **Step 3 (опц.): lint** — `npm run lint` (если настроен) → clean. Проверить, что убранные `eslint-disable @typescript-eslint/no-unused-vars` в `episodic-memory.ts` не оставили «unused directive» (директивы удалены вместе с тем, что они подавляли).

- [ ] **Step 4: Rollout-нота (БЕЗ действий без явного слова Berik):**
  - Всё — **локальные коммиты**. Push/deploy/флаг — ТОЛЬКО по явному «пушь/деплой/флаг» от Berik (правило honest-state: не заявлять prod-verified для непушнутой ветки).
  - Дефолт: `FEATURE_V2_WRITE` **off** (втёмную) → поведение байт-в-байт сегодняшнее (двойная запись `captureMemory` + `recordEvent`).
  - Последовательность по слову Berik: (1) push → deploy с флагом OFF; (2) `FEATURE_V2_WRITE=user-{berikId}`;
  - **SMOKE (по факту БД, после флипа на berik):**
    1. Написать боту факт («Серик переехал в Астану») → в `Memory` ОДНА строка (не дубль) **с embedding** (тип `fact`/`person` ∈ EMBED_DEFAULT_TYPES → эмбедится при `embeddingsEnabled()`).
    2. Повторить тот же факт → **update-in-place**, НЕ вторая строка (дедуп `shouldOverwriteContent` + `$queryRaw`).
    3. Создать задачу **кнопкой mobile / через бота** → action-строка (`task_created`, source `v2-episodic`) **без embedding** (action ∉ EMBED_DEFAULT_TYPES).
    4. Спросить бота «что я знаешь про Серика / что я сегодня делал» → бот находит (чтение уже единое).
  - Если SMOKE зелёный → `FEATURE_V2_WRITE=all`.
  - **Follow-up (отдельный план, после подтверждения флага):** удалить функцию `captureMemory` + приватный `storeEmbedding` из `memory-service.ts` + убрать `else`-ветки (captureMemory) в оркестраторе и упростить `recordEvent` (всегда `writeMemory`). **В этом плане НЕ делаем** — `captureMemory` и off-ветки остаются рабочими и tsc-clean.

---

## Self-review / spec coverage

| Spec § | Требование | Задача(и) |
|--------|-----------|-----------|
| §2 | ОДИН write-путь с лучшим из обоих (episodic-поля + дедуп + embedding); все источники через него; legacy потом отключаем; ЧТЕНИЕ не трогаем | Task 2 (writeMemory) + Tasks 3-6 (источники) + (read не тронут — подтверждено) |
| §3 (флаг) | `isV2WriteEnabled(userId)` (env `FEATURE_V2_WRITE`, форма как сиблинги); off → двойная запись байт-в-байт | Task 1 |
| §3.1 | `writeMemory` в `episodic-memory.ts` рядом с recordEvent: episodic-поля + дедуп (порт `shouldOverwriteContent` + дубликат-запрос → update importance=max/create) + условный embedding (порт `storeEmbedding`, knob `embed` по типу; «ценные» эмбедим, дешёвые action — нет); best-effort never-throws | Task 2 |
| §3.2 (чат-факты) | `orchestrator:182` цикл → writeMemory (те же {type,content,details,tags,importance}); `:666` preference → writeMemory | Task 5 (:182), Task 6 (:666) |
| §3.2 (episodic) | `v2-capture:104` recordEvent → уже единый писатель (recordEvent зовёт writeMemory под флагом) | Task 3 (делегация; v2-capture файл не правится — авто-апгрейд) |
| §3.2 (action M1) | `captureActivity`→recordEvent → дедуп + опц. embedding; всё за флагом; on → captureMemory не зовётся | Task 3 (делегация) + Task 4 (embed:false для action) |
| §3.3 (не трогаем) | Чтение `getRelevantMemories`; извлечение фактов (intent-parser); enrichment/entity-граф/mood/axes captureV2 | Подтверждено: ни одна задача их не правит |
| §4 | Деградация: writeMemory best-effort (не крэш); флаг off = мгновенный откат; перенос ПРОВЕРЕННОЙ legacy-логики | Task 2 (never-throws) + Task 1 (флаг) |
| §5 | Тесты: `shouldOverwriteContent` уже покрыт (переиспуем); pure-часть writeMemory (update-vs-create / embed-knob) unit; structural orchestrator:182/:666 + captureV2/captureActivity через единый писатель + off=legacy; base ~1913 зелёная; zero vi.mock; createAnthropic only | Task 2 (pure shouldEmbed + structural), Task 3 (recordEvent off=legacy), Task 4 (action embed), Tasks 5-6 (orchestrator structural), Task 7 (full suite) |
| §6 | Rollout: локальные коммиты per-step, tsc+vitest зелёные, off втёмную → push/deploy → флаг user-berik → SMOKE по факту БД (одна строка с embedding; повтор=update; action-строка; бот вспоминает) → all; follow-up удалить captureMemory | Task 7 |

**Не замапленные требования спеки:** нет. §0/§1 (нарратив «почему переписана» + «два писателя») отражены в **Goal/Architecture**. §7 (Non-Goals: не менять чтение/извлечение/таблицу/поведение/миграцию) соблюдены by-construction — ни одна задача их не касается.

**Подтверждение follow-up:** функция `captureMemory` (`memory-service.ts:117`) в этом плане **НЕ удаляется** — она остаётся рабочей, её зовёт off-ветка оркестратора (Tasks 5-6), импорт сохранён (Task 5 Step 3a). Приватный `storeEmbedding` в `memory-service.ts` тоже остаётся (его всё ещё зовёт `captureMemory`); в `writeMemory` он **портирован** (новая локальная `storeMemoryEmbedding`), а не вызван. **Чтение (`getRelevantMemories`, `memory-service.ts:207`) НЕ тронуто** ни в одной задаче. Удаление legacy — отдельный follow-up после доказательства флага `FEATURE_V2_WRITE`.
